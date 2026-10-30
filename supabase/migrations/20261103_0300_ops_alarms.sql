-- ═══════════════════════════════════════════════════════════════════════════
-- 20261103_0300 · Foundation fix unit 3 · ALARMS THAT DO NOT DEPEND ON GITHUB CRON
--
-- PROBLEM (foundation audit #622, area 7, measured 2026-10-30): in 48 h GitHub
-- ran health.yml 7/24 times, gov-health 8/24, d2-synthetic ~6/113 (gaps up to
-- 8.5 h). Nothing alarms when the site is down between runs, and nothing at all
-- alarms when a monitor silently stops running.
--
-- WHAT THIS ADDS (inside the database, driven by pg_cron, not GitHub):
--   * ops_monitor_tick(), every 5 minutes (pg_cron 'ops-monitor-tick'):
--       (b) UPTIME — GETs every URL in ops_alarm_settings.uptime_targets
--           (www + apex) through pg_net; two failed checks in a row for a URL
--           open an alarm, one good check closes it.
--       (a) DEAD-MAN — every 30 minutes reads GitHub's PUBLIC API (no token)
--           for the last SUCCESSFUL run of each workflow in
--           monitored_workflows (health.yml); no success for dead_man_hours
--           (3 h) opens an alarm. If the API itself cannot be read for that
--           long, a "blind" alarm opens instead — never silence.
--   * ops_alarms — one open row per alarm key; the source of truth.
--   * (c) DELIVERY — ops_alarm_settings.destination is THE one setting.
--           'github_issue' (default): .github/workflows/alarm-relay.yml reads
--           open alarms (read-only) and opens / closes an issue labelled ALARM
--           (GitHub e-mails the repo owner). Admin → Health shows a banner of
--           open alarms whatever the destination. An e-mail/phone destination
--           is an Owner item: set this column, then add that delivery path.
--
-- SHAPE RULES MET: the cron command calls ONE public function (P9: no net.http_*
-- / vault / credential in the command); 5-minute cadence (P5); every table has
-- a primary key and RLS (P35); no runtime DDL (P7). The function holds no
-- credential: the GitHub API read is anonymous, the URLs are public.
-- Security: SECURITY DEFINER, search_path pinned, EXECUTE revoked from PUBLIC,
-- anon and authenticated (only postgres / pg_cron run it).
--
-- No feature switch is turned on. Both lanes get the same objects; alarms carry
-- the lane in their summary. Rollback: supabase/rollback/20261103_0300_ops_alarms_ROLLBACK.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %)',
      coalesce(current_setting('p32.lane', true), '(unset)') USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

-- ── the one setting row ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_alarm_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lane                text NOT NULL,
  destination         text NOT NULL DEFAULT 'github_issue',
  uptime_targets      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(uptime_targets) <= 5),
  monitored_workflows text[] NOT NULL DEFAULT '{}' CHECK (cardinality(monitored_workflows) <= 5),
  github_repo         text NOT NULL DEFAULT 'altisinfonet/lens-lustre-learn-Claude',
  dead_man_hours      integer NOT NULL DEFAULT 3 CHECK (dead_man_hours BETWEEN 1 AND 48),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.ops_alarm_settings.destination IS
  'Where alarms go. github_issue = alarm-relay.yml opens an ALARM issue. Owner contact (e-mail/phone) goes here later.';
-- Staging starts with nothing to watch (no duplicate pings / GitHub API reads);
-- the staging alarm test switches targets on and off by its own migrations.
INSERT INTO public.ops_alarm_settings (id, lane, uptime_targets, monitored_workflows)
SELECT 1, current_setting('p32.lane'),
       CASE WHEN current_setting('p32.lane') = 'production' THEN ARRAY['https://www.50mmretina.com/', 'https://50mmretina.com/'] ELSE '{}'::text[] END,
       CASE WHEN current_setting('p32.lane') = 'production' THEN ARRAY['health.yml'] ELSE '{}'::text[] END
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ops_alarm_settings ENABLE ROW LEVEL SECURITY;

-- ── every outbound check and its result ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_probe_requests (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('uptime', 'gh_runs')),
  target       text NOT NULL,
  request_id   bigint,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  status_code  integer,
  ok           boolean,
  error        text,
  detail       jsonb
);
-- P28: ops_probe_requests · 0 rows at launch, ~1,100/day, 14-day cap ≈ 16 k · the tick reads the last 2 checks per target every 5 min
CREATE INDEX IF NOT EXISTS ops_probe_requests_kind_target_idx
  ON public.ops_probe_requests (kind, target, requested_at DESC);
-- P28: ops_probe_requests · partial, only unresolved rows (≤ a handful) · the tick resolves pending checks every 5 min
CREATE INDEX IF NOT EXISTS ops_probe_requests_pending_idx
  ON public.ops_probe_requests (requested_at) WHERE resolved_at IS NULL;
ALTER TABLE public.ops_probe_requests ENABLE ROW LEVEL SECURITY;

-- ── alarms ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_alarms (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alarm_key    text NOT NULL,
  summary      text NOT NULL,
  detail       jsonb,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
-- P28: ops_alarms · 0 rows at launch, a few per incident · enforces one open alarm per key (ON CONFLICT target)
CREATE UNIQUE INDEX IF NOT EXISTS ops_alarms_one_open_per_key
  ON public.ops_alarms (alarm_key) WHERE closed_at IS NULL;
ALTER TABLE public.ops_alarms ENABLE ROW LEVEL SECURITY;

-- Admins read (Admin → Health banner). Nobody writes through the API.
DO $pol$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ops_alarms' AND policyname = 'admins read ops_alarms') THEN
    CREATE POLICY "admins read ops_alarms" ON public.ops_alarms FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ops_alarm_settings' AND policyname = 'admins read ops_alarm_settings') THEN
    CREATE POLICY "admins read ops_alarm_settings" ON public.ops_alarm_settings FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ops_probe_requests' AND policyname = 'admins read ops_probe_requests') THEN
    CREATE POLICY "admins read ops_probe_requests" ON public.ops_probe_requests FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END
$pol$;

-- Supabase's default table privileges give anon/authenticated ALL on new tables;
-- RLS does not cover TRUNCATE/REFERENCES/TRIGGER, so strip everything and grant
-- back read only. Settings change by migration only (no member-facing write path).
REVOKE ALL ON public.ops_alarm_settings, public.ops_probe_requests, public.ops_alarms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_alarms, public.ops_alarm_settings, public.ops_probe_requests TO authenticated;

-- ── open / close one alarm ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_alarm_set(_key text, _firing boolean, _summary text, _detail jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF _firing THEN
    INSERT INTO public.ops_alarms (alarm_key, summary, detail)
    VALUES (_key, _summary, _detail)
    ON CONFLICT (alarm_key) WHERE closed_at IS NULL
    DO UPDATE SET last_seen_at = now(), detail = EXCLUDED.detail, summary = EXCLUDED.summary;
  ELSE
    UPDATE public.ops_alarms SET closed_at = now(), last_seen_at = now()
     WHERE alarm_key = _key AND closed_at IS NULL;
  END IF;
END
$fn$;

-- ── evaluate alarms from recorded results (pure: reads tables, no HTTP) ────
CREATE OR REPLACE FUNCTION public.ops_evaluate_alarms(_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  s public.ops_alarm_settings;
  t text;
  w text;
  _last2 boolean[];
  _last_ok_read timestamptz;
  _first_read timestamptz;
  _last_success timestamptz;
  _open integer;
BEGIN
  SELECT * INTO s FROM public.ops_alarm_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- (b) uptime: the last two RESOLVED checks of a URL both failed → alarm.
  FOREACH t IN ARRAY s.uptime_targets LOOP
    SELECT array_agg(ok ORDER BY requested_at DESC) INTO _last2 FROM (
      SELECT ok, requested_at FROM public.ops_probe_requests
       WHERE kind = 'uptime' AND target = t AND resolved_at IS NOT NULL
       ORDER BY requested_at DESC LIMIT 2) x;
    IF _last2 IS NOT NULL AND cardinality(_last2) = 2 AND NOT _last2[1] AND NOT _last2[2] THEN
      PERFORM public.ops_alarm_set('uptime:' || t, true,
        format('[%s] %s is DOWN — 2 checks in a row failed', s.lane, t),
        (SELECT jsonb_build_object('status_code', status_code, 'error', error, 'checked_at', requested_at)
           FROM public.ops_probe_requests WHERE kind = 'uptime' AND target = t AND resolved_at IS NOT NULL
          ORDER BY requested_at DESC LIMIT 1));
    ELSIF _last2 IS NOT NULL AND _last2[1] THEN
      PERFORM public.ops_alarm_set('uptime:' || t, false, NULL, NULL);
    END IF;
  END LOOP;

  -- (a) dead-man: no SUCCESSFUL run of a monitored workflow for dead_man_hours.
  FOREACH w IN ARRAY s.monitored_workflows LOOP
    SELECT max(requested_at), max((detail ->> 'last_success_at')::timestamptz)
      INTO _last_ok_read, _last_success
      FROM public.ops_probe_requests WHERE kind = 'gh_runs' AND target = w AND ok;
    SELECT min(requested_at) INTO _first_read
      FROM public.ops_probe_requests WHERE kind = 'gh_runs' AND target = w;

    IF _last_ok_read IS NOT NULL THEN
      PERFORM public.ops_alarm_set('deadman:' || w,
        _last_success IS NULL OR _last_success < _now - make_interval(hours => s.dead_man_hours),
        format('[%s] monitor %s has not succeeded for over %s h (last success: %s)',
               s.lane, w, s.dead_man_hours, coalesce(_last_success::text, 'never')),
        jsonb_build_object('last_success_at', _last_success, 'read_at', _last_ok_read));
    END IF;

    -- blind: GitHub's API could not be read for dead_man_hours → say so, never stay silent.
    PERFORM public.ops_alarm_set('deadman-blind:' || w,
      _first_read IS NOT NULL AND _first_read < _now - make_interval(hours => s.dead_man_hours)
        AND (_last_ok_read IS NULL OR _last_ok_read < _now - make_interval(hours => s.dead_man_hours)),
      format('[%s] cannot read GitHub run history for %s for over %s h — the dead-man check is blind', s.lane, w, s.dead_man_hours),
      jsonb_build_object('last_ok_read', _last_ok_read));
  END LOOP;

  -- alarms for URLs / workflows no longer configured are closed.
  UPDATE public.ops_alarms SET closed_at = _now
   WHERE closed_at IS NULL
     AND ((alarm_key LIKE 'uptime:%' AND substr(alarm_key, 8) <> ALL (s.uptime_targets))
       OR (alarm_key LIKE 'deadman:%' AND substr(alarm_key, 9) <> ALL (s.monitored_workflows))
       OR (alarm_key LIKE 'deadman-blind:%' AND substr(alarm_key, 15) <> ALL (s.monitored_workflows)));

  SELECT count(*) INTO _open FROM public.ops_alarms WHERE closed_at IS NULL;
  RETURN _open;
END
$fn$;

-- ── the tick: resolve answers, evaluate, send the next checks ──────────────
CREATE OR REPLACE FUNCTION public.ops_monitor_tick()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  s public.ops_alarm_settings;
  r record;
  t text;
  w text;
  _rid bigint;
  _body jsonb;
  _open integer;
BEGIN
  SELECT * INTO s FROM public.ops_alarm_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- 1 · resolve: copy pg_net's answers onto our rows (pg_net keeps them ~6 h).
  FOR r IN
    SELECT q.id, q.kind, h.status_code, h.timed_out, h.error_msg, h.content
      FROM public.ops_probe_requests q
      JOIN net._http_response h ON h.id = q.request_id
     WHERE q.resolved_at IS NULL
  LOOP
    _body := NULL;
    IF r.kind = 'gh_runs' AND r.status_code = 200 THEN
      BEGIN
        _body := jsonb_build_object(
          'last_success_at', (r.content::jsonb -> 'workflow_runs' -> 0 ->> 'updated_at'),
          'run_id', (r.content::jsonb -> 'workflow_runs' -> 0 ->> 'id'));
      EXCEPTION WHEN OTHERS THEN _body := jsonb_build_object('parse_error', SQLSTATE);
      END;
    END IF;
    UPDATE public.ops_probe_requests
       SET resolved_at = now(), status_code = r.status_code,
           ok = coalesce(coalesce(r.timed_out, false) = false AND r.error_msg IS NULL
                 AND r.status_code BETWEEN 200 AND 399
                 AND (r.kind <> 'gh_runs' OR (_body ? 'last_success_at')), false),
           error = left(coalesce(r.error_msg, CASE WHEN r.timed_out THEN 'timed out' END), 300),
           detail = _body
     WHERE id = r.id;
  END LOOP;
  -- no answer within 3 minutes counts as a failed check
  UPDATE public.ops_probe_requests
     SET resolved_at = now(), ok = false, error = 'no response within 3 minutes'
   WHERE resolved_at IS NULL AND requested_at < now() - interval '3 minutes';

  -- 2 · evaluate
  _open := public.ops_evaluate_alarms(now());

  -- 3 · send the next checks
  FOREACH t IN ARRAY s.uptime_targets LOOP
    _rid := net.http_get(url := t, timeout_milliseconds := 15000,
                         headers := jsonb_build_object('User-Agent', '50mmretina-ops-monitor'));
    INSERT INTO public.ops_probe_requests (kind, target, request_id) VALUES ('uptime', t, _rid);
  END LOOP;
  FOREACH w IN ARRAY s.monitored_workflows LOOP
    IF NOT EXISTS (SELECT 1 FROM public.ops_probe_requests
                    WHERE kind = 'gh_runs' AND target = w AND requested_at > now() - interval '29 minutes') THEN
      _rid := net.http_get(
        url := format('https://api.github.com/repos/%s/actions/workflows/%s/runs?status=success&per_page=1', s.github_repo, w),
        timeout_milliseconds := 15000,
        headers := jsonb_build_object('User-Agent', '50mmretina-ops-monitor', 'Accept', 'application/vnd.github+json'));
      INSERT INTO public.ops_probe_requests (kind, target, request_id) VALUES ('gh_runs', w, _rid);
    END IF;
  END LOOP;

  -- 4 · keep 14 days of checks, bounded per tick
  DELETE FROM public.ops_probe_requests
   WHERE id IN (SELECT id FROM public.ops_probe_requests
                 WHERE requested_at < now() - interval '14 days' ORDER BY id LIMIT 5000);
  RETURN _open;
END
$fn$;

REVOKE ALL ON FUNCTION public.ops_alarm_set(text, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_evaluate_alarms(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ops_monitor_tick() FROM PUBLIC, anon, authenticated;

-- ── schedule (pg_cron upserts by job name) ─────────────────────────────────
SELECT cron.schedule('ops-monitor-tick', '*/5 * * * *', 'SELECT public.ops_monitor_tick()');

DO $post$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'ops-monitor-tick' AND schedule = '*/5 * * * *') <> 1 THEN
    RAISE EXCEPTION 'OPS-0300-POST: cron job ops-monitor-tick not scheduled';
  END IF;
  IF has_function_privilege('anon', 'public.ops_monitor_tick()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ops_monitor_tick()', 'EXECUTE') THEN
    RAISE EXCEPTION 'OPS-0300-POST: ops_monitor_tick must not be callable by anon/authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.ops_alarms', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('authenticated', 'public.ops_alarm_settings', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('authenticated', 'public.ops_probe_requests', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('anon', 'public.ops_alarms', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('anon', 'public.ops_alarm_settings', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('anon', 'public.ops_probe_requests', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
    RAISE EXCEPTION 'OPS-0300-POST: anon/authenticated hold a write privilege on an ops_* table';
  END IF;
  IF (SELECT count(*) FROM public.ops_alarm_settings) <> 1 THEN
    RAISE EXCEPTION 'OPS-0300-POST: exactly one settings row expected';
  END IF;
  RAISE NOTICE 'OPS-0300: alarms installed on lane %', current_setting('p32.lane');
END
$post$;

COMMIT;
