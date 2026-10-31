-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation fix unit 3 · 0301 · alarm self-test. Changes nothing:
-- every write happens inside one transaction that ends in ROLLBACK.
--
-- Simulates, against the real ops_evaluate_alarms() on the lane:
--   T1 a DOWN site (2 failed checks in a row)          → uptime alarm OPENS
--   T2 a single failed check (blip)                    → NO alarm
--   T3 the site comes back (1 good check)              → uptime alarm CLOSES
--   T4 a STOPPED monitor (last success 4 h ago, 3 h)   → dead-man alarm OPENS
--   T5 the monitor succeeds again (1 h ago)            → dead-man alarm CLOSES
--   T6 GitHub API unreadable for 4 h                   → "blind" alarm OPENS
-- Any expectation not met raises an exception → the run goes RED.
-- Before 20261103_0300 is applied this file fails (no alarm machinery exists):
-- that is the fail-first proof that nothing alarmed.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '60s';

DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;

DO $t$
DECLARE
  _down constant text := 'https://down.invalid/selftest';
  _blip constant text := 'https://blip.invalid/selftest';
  _wf   constant text := 'selftest-monitor.yml';
  _wfb  constant text := 'selftest-blind.yml';
  _n int;
BEGIN
  UPDATE public.ops_alarm_settings
     SET uptime_targets = ARRAY[_down, _blip], monitored_workflows = ARRAY[_wf, _wfb], dead_man_hours = 3
   WHERE id = 1;

  -- T1: two failed checks in a row for _down; T2: only one failure for _blip
  INSERT INTO public.ops_probe_requests (kind, target, requested_at, resolved_at, ok, status_code, error) VALUES
    ('uptime', _down, now() - interval '10 min', now(), false, NULL, 'Could not resolve host'),
    ('uptime', _down, now() - interval '5 min',  now(), false, 503, NULL),
    ('uptime', _blip, now() - interval '10 min', now(), true, 200, NULL),
    ('uptime', _blip, now() - interval '5 min',  now(), false, 503, NULL);
  -- T4: monitor read fine, but its last success was 4 h ago
  INSERT INTO public.ops_probe_requests (kind, target, requested_at, resolved_at, ok, status_code, detail) VALUES
    ('gh_runs', _wf, now() - interval '2 min', now(), true, 200,
     jsonb_build_object('last_success_at', now() - interval '4 hours'));
  -- T6: GitHub API never readable for this workflow, first attempt 4 h ago
  INSERT INTO public.ops_probe_requests (kind, target, requested_at, resolved_at, ok, status_code, error) VALUES
    ('gh_runs', _wfb, now() - interval '4 hours', now(), false, 403, 'rate limited'),
    ('gh_runs', _wfb, now() - interval '5 min',   now(), false, 403, 'rate limited');

  PERFORM public.ops_evaluate_alarms(now());

  SELECT count(*) INTO _n FROM public.ops_alarms WHERE alarm_key = 'uptime:' || _down AND closed_at IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'T1 FAIL: down site raised % open alarms, expected 1', _n; END IF;
  RAISE NOTICE 'SELFTEST T1 PASS: down site -> uptime alarm open';

  SELECT count(*) INTO _n FROM public.ops_alarms WHERE alarm_key = 'uptime:' || _blip;
  IF _n <> 0 THEN RAISE EXCEPTION 'T2 FAIL: a single failed check raised an alarm'; END IF;
  RAISE NOTICE 'SELFTEST T2 PASS: single blip -> no alarm';

  SELECT count(*) INTO _n FROM public.ops_alarms WHERE alarm_key = 'deadman:' || _wf AND closed_at IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'T4 FAIL: stopped monitor raised % open alarms, expected 1', _n; END IF;
  RAISE NOTICE 'SELFTEST T4 PASS: stopped monitor -> dead-man alarm open';

  SELECT count(*) INTO _n FROM public.ops_alarms WHERE alarm_key = 'deadman-blind:' || _wfb AND closed_at IS NULL;
  IF _n <> 1 THEN RAISE EXCEPTION 'T6 FAIL: blind API raised % open alarms, expected 1', _n; END IF;
  RAISE NOTICE 'SELFTEST T6 PASS: unreadable GitHub API -> blind alarm open';

  -- T3 + T5: recovery
  INSERT INTO public.ops_probe_requests (kind, target, requested_at, resolved_at, ok, status_code) VALUES
    ('uptime', _down, now() - interval '1 min', now(), true, 200);
  INSERT INTO public.ops_probe_requests (kind, target, requested_at, resolved_at, ok, status_code, detail) VALUES
    ('gh_runs', _wf, now() - interval '1 min', now(), true, 200,
     jsonb_build_object('last_success_at', now() - interval '1 hour'));
  PERFORM public.ops_evaluate_alarms(now());

  SELECT count(*) INTO _n FROM public.ops_alarms WHERE alarm_key = 'uptime:' || _down AND closed_at IS NULL;
  IF _n <> 0 THEN RAISE EXCEPTION 'T3 FAIL: uptime alarm still open after recovery'; END IF;
  RAISE NOTICE 'SELFTEST T3 PASS: site back -> uptime alarm closed';

  SELECT count(*) INTO _n FROM public.ops_alarms WHERE alarm_key = 'deadman:' || _wf AND closed_at IS NULL;
  IF _n <> 0 THEN RAISE EXCEPTION 'T5 FAIL: dead-man alarm still open after a fresh success'; END IF;
  RAISE NOTICE 'SELFTEST T5 PASS: monitor succeeded -> dead-man alarm closed';

  RAISE NOTICE 'OPS0301_SELFTEST: ALL 6 PASS on lane %', current_setting('p32.lane');
END
$t$;

ROLLBACK;
