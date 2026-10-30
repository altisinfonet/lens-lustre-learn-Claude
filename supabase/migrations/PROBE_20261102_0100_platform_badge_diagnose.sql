-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · Unit A diagnosis — "Admin → Users: many members show neither App
-- nor Website". READ ONLY, ROLLBACK. COUNTS ONLY — never an id, e-mail or name.
--
-- Admin → Users shows the chip only when profiles.last_platform is not NULL
-- (src/components/admin/AdminUsers.tsx). This measures, on the lane it is
-- dispatched to, WHO has a NULL platform and WHY, so the fix is chosen from
-- evidence, not a guess:
--
--   1  last_platform split (NULL / app / web) among members with a last-seen
--   2  the same by sign-up month (auth.users.created_at, last 12 months)
--   3  the same by last_active_at age
--   4  members ACTIVE in the last 7 days (newest member_activity_minutes
--      bucket) — the gate's denominator — and their platform split
--   5  WHO WROTE last_active_at, read from its shape: backfill_last_seen()
--      copies a minute_bucket (seconds and microseconds exactly 0);
--      record_session_end() writes now() (almost never exactly :00.000000)
--   6  for members active in 7 days: did a session-end write land AFTER their
--      newest heartbeat minute?
--   7  the backfill cron job: schedule, active, runs in the last 48 h
--   8  record_session_end on this lane: exists, carries the 60-second rule
--   9  real recorded per-member platform data that could fill old rows:
--      client_errors.platform and push_tokens.platform (value → count)
--  10  function call counters, if track_functions is on
--  11  triggers on public.profiles (names only)
--
-- It FAILS only if public.profiles or its two columns are missing. Every
-- optional table is checked with to_regclass and reported as absent.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE
  r    record;
  line text;
  has_mam boolean := to_regclass('public.member_activity_minutes') IS NOT NULL;
  has_ce  boolean := to_regclass('public.client_errors') IS NOT NULL;
  has_pt  boolean := to_regclass('public.push_tokens') IS NOT NULL;
  has_cron boolean := to_regclass('cron.job') IS NOT NULL;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('last_active_at', 'last_platform')) <> 2 THEN
    RAISE EXCEPTION 'PROBE FAIL: public.profiles.last_active_at / last_platform missing';
  END IF;

  RAISE NOTICE 'UNIT-A DIAGNOSIS · lane % · measured % UTC',
    current_setting('p32.lane'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');

  -- 1 ──────────────────────────────────────────────────────────────────────
  SELECT count(*) AS total,
         count(*) FILTER (WHERE last_active_at IS NOT NULL) AS seen,
         count(*) FILTER (WHERE last_active_at IS NOT NULL AND last_platform IS NULL) AS seen_null,
         count(*) FILTER (WHERE last_platform = 'app') AS app,
         count(*) FILTER (WHERE last_platform = 'web') AS web,
         count(*) FILTER (WHERE last_platform IS NOT NULL AND last_platform NOT IN ('app','web')) AS other,
         count(*) FILTER (WHERE last_active_at IS NULL AND last_platform IS NOT NULL) AS platform_wo_seen
    INTO r FROM public.profiles;
  RAISE NOTICE E'1 PROFILES total=% · last_active_at set=% · of those platform NULL=% · app=% · web=% · other=% · platform-without-seen=%',
    r.total, r.seen, r.seen_null, r.app, r.web, r.other, r.platform_wo_seen;

  -- 2 ──────────────────────────────────────────────────────────────────────
  line := '';
  FOR r IN
    SELECT to_char(date_trunc('month', u.created_at), 'YYYY-MM') AS m,
           count(*) AS n,
           count(*) FILTER (WHERE p.last_active_at IS NOT NULL) AS seen,
           count(*) FILTER (WHERE p.last_active_at IS NOT NULL AND p.last_platform IS NULL) AS nul,
           count(*) FILTER (WHERE p.last_platform = 'app') AS app,
           count(*) FILTER (WHERE p.last_platform = 'web') AS web
      FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE u.created_at >= date_trunc('month', now()) - interval '11 months'
     GROUP BY 1 ORDER BY 1
  LOOP
    line := line || format(E'\n    %s  members=%s seen=%s NULL=%s app=%s web=%s', r.m, r.n, r.seen, r.nul, r.app, r.web);
  END LOOP;
  RAISE NOTICE E'2 BY SIGN-UP MONTH:%', line;

  -- 3 ──────────────────────────────────────────────────────────────────────
  line := '';
  FOR r IN
    SELECT b, count(*) AS n,
           count(*) FILTER (WHERE last_platform IS NULL) AS nul,
           count(*) FILTER (WHERE last_platform = 'app') AS app,
           count(*) FILTER (WHERE last_platform = 'web') AS web
      FROM (SELECT last_platform,
                   CASE WHEN last_active_at >= now() - interval '1 hour'  THEN '1 <1h'
                        WHEN last_active_at >= now() - interval '1 day'   THEN '2 1h-1d'
                        WHEN last_active_at >= now() - interval '7 days'  THEN '3 1-7d'
                        WHEN last_active_at >= now() - interval '30 days' THEN '4 7-30d'
                        WHEN last_active_at >= timestamptz '2026-09-20'   THEN '5 >30d since 2026-09-20'
                        ELSE '6 before 2026-09-20' END AS b
              FROM public.profiles WHERE last_active_at IS NOT NULL) s
     GROUP BY b ORDER BY b
  LOOP
    line := line || format(E'\n    %-26s n=%s NULL=%s app=%s web=%s', r.b, r.n, r.nul, r.app, r.web);
  END LOOP;
  RAISE NOTICE E'3 BY last_active_at AGE:%', line;

  IF has_mam THEN
    -- 4, 5, 6 ─────────────────────────────────────────────────────────────
    SELECT count(*) AS active7,
           count(*) FILTER (WHERE p.last_platform IS NULL) AS nul,
           count(*) FILTER (WHERE p.last_platform = 'app') AS app,
           count(*) FILTER (WHERE p.last_platform = 'web') AS web,
           -- 5: shape of the stored value
           count(*) FILTER (WHERE p.last_platform IS NULL AND p.last_active_at IS NULL) AS nul_never,
           count(*) FILTER (WHERE p.last_platform IS NULL
                              AND p.last_active_at = date_trunc('minute', p.last_active_at)) AS nul_minute_shape,
           count(*) FILTER (WHERE p.last_platform IS NULL AND p.last_active_at IS NOT NULL
                              AND p.last_active_at <> date_trunc('minute', p.last_active_at)) AS nul_now_shape,
           count(*) FILTER (WHERE p.last_platform IS NOT NULL
                              AND p.last_active_at = date_trunc('minute', p.last_active_at)) AS set_minute_shape,
           count(*) FILTER (WHERE p.last_platform IS NOT NULL
                              AND p.last_active_at <> date_trunc('minute', p.last_active_at)) AS set_now_shape,
           -- 6: a session-end-shaped value at/after the newest heartbeat minute
           count(*) FILTER (WHERE p.last_active_at <> date_trunc('minute', p.last_active_at)
                              AND p.last_active_at >= m.newest) AS end_after_last_minute,
           count(*) FILTER (WHERE m.days >= 2) AS active_on_2plus_days,
           count(*) FILTER (WHERE m.days >= 2 AND p.last_platform IS NULL) AS active_2plus_null
      INTO r
      FROM (SELECT user_id, max(minute_bucket) AS newest,
                   count(DISTINCT (minute_bucket AT TIME ZONE 'UTC')::date) AS days
              FROM public.member_activity_minutes
             WHERE minute_bucket >= now() - interval '7 days'
             GROUP BY user_id) m
      JOIN public.profiles p ON p.id = m.user_id;
    RAISE NOTICE E'4 ACTIVE IN LAST 7 DAYS (heartbeat minutes): %  · platform NULL=% app=% web=%\n    active on 2+ distinct days=% · of those NULL=%',
      r.active7, r.nul, r.app, r.web, r.active_on_2plus_days, r.active_2plus_null;
    RAISE NOTICE E'5 WHO WROTE last_active_at (active-7d members)\n    platform NULL: never written=% · minute-shaped (backfill_last_seen)=% · now()-shaped (session end)=%\n    platform set : minute-shaped=% · now()-shaped=%',
      r.nul_never, r.nul_minute_shape, r.nul_now_shape, r.set_minute_shape, r.set_now_shape;
    RAISE NOTICE '6 SESSION-END WRITE AT/AFTER NEWEST HEARTBEAT MINUTE (active-7d): %', r.end_after_last_minute;

    SELECT count(*) AS rows7, count(DISTINCT user_id) AS members7,
           min(minute_bucket) AS oldest_kept
      INTO r FROM public.member_activity_minutes WHERE minute_bucket >= now() - interval '7 days';
    RAISE NOTICE '4b heartbeat rows in 7 days=% members=%', r.rows7, r.members7;
  ELSE
    RAISE NOTICE '4/5/6 public.member_activity_minutes ABSENT on this lane';
  END IF;

  -- 7 ──────────────────────────────────────────────────────────────────────
  IF has_cron THEN
    line := '';
    FOR r IN
      SELECT j.jobid, j.jobname, j.schedule, j.active,
             (SELECT count(*) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time >= now() - interval '48 hours' AND d.status = 'succeeded') AS ok48,
             (SELECT count(*) FROM cron.job_run_details d
               WHERE d.jobid = j.jobid AND d.start_time >= now() - interval '48 hours' AND d.status <> 'succeeded') AS bad48,
             (SELECT to_char(max(d.start_time) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') FROM cron.job_run_details d
               WHERE d.jobid = j.jobid) AS last_run
        FROM cron.job j
       WHERE j.command ILIKE '%backfill_last_seen%' OR j.command ILIKE '%record_session_end%'
    LOOP
      line := line || format(E'\n    job %s %s schedule=%s active=%s ok48h=%s failed48h=%s last=%s',
                             r.jobid, coalesce(r.jobname, '(unnamed)'), r.schedule, r.active, r.ok48, r.bad48, coalesce(r.last_run, 'never'));
    END LOOP;
    RAISE NOTICE E'7 CRON JOBS TOUCHING last seen:%', CASE WHEN line = '' THEN ' NONE' ELSE line END;
  ELSE
    RAISE NOTICE '7 cron schema ABSENT on this lane';
  END IF;

  -- 8 ──────────────────────────────────────────────────────────────────────
  line := '';
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef,
           position('60 seconds' IN pg_get_functiondef(p.oid)) > 0 AS has_60s,
           position('last_platform' IN pg_get_functiondef(p.oid)) > 0 AS writes_platform,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('record_session_end', 'backfill_last_seen', 'record_activity_minute')
     ORDER BY 1
  LOOP
    line := line || format(E'\n    %s(%s) definer=%s 60s-rule=%s writes last_platform=%s authenticated=%s',
                           r.proname, r.args, r.prosecdef, r.has_60s, r.writes_platform, r.auth_exec);
  END LOOP;
  RAISE NOTICE E'8 WRITERS ON THIS LANE:%', CASE WHEN line = '' THEN ' NONE' ELSE line END;

  -- 9 ──────────────────────────────────────────────────────────────────────
  IF has_ce THEN
    line := '';
    FOR r IN
      SELECT coalesce(platform, '(null)') AS pf, count(*) AS n, count(DISTINCT user_id) AS members,
             to_char(min(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS since
        FROM public.client_errors GROUP BY 1 ORDER BY 2 DESC LIMIT 12
    LOOP
      line := line || format(E'\n    client_errors platform=%s rows=%s members=%s since=%s', r.pf, r.n, r.members, r.since);
    END LOOP;
    SELECT count(*) INTO r FROM public.profiles p
     WHERE p.last_platform IS NULL AND p.last_active_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.client_errors c WHERE c.user_id = p.id AND c.platform IN ('app', 'web'));
    line := line || format(E'\n    seen-but-NULL members with a client_errors app/web row: %s', r.count);
    RAISE NOTICE E'9a REAL PER-MEMBER PLATFORM DATA (client_errors):%', line;
  ELSE
    RAISE NOTICE '9a client_errors ABSENT';
  END IF;
  IF has_pt THEN
    line := '';
    FOR r IN
      SELECT platform AS pf, count(*) AS n, count(DISTINCT user_id) AS members FROM public.push_tokens GROUP BY 1 ORDER BY 1
    LOOP
      line := line || format(E'\n    push_tokens platform=%s tokens=%s members=%s', r.pf, r.n, r.members);
    END LOOP;
    SELECT count(*) INTO r FROM public.profiles p
     WHERE p.last_platform IS NULL AND p.last_active_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.user_id = p.id);
    line := line || format(E'\n    seen-but-NULL members with any push token: %s', r.count);
    RAISE NOTICE E'9b push_tokens:%', line;
  END IF;

  -- 10 ─────────────────────────────────────────────────────────────────────
  line := '';
  FOR r IN
    SELECT funcname, calls FROM pg_stat_user_functions
     WHERE schemaname = 'public' AND funcname IN ('record_session_end', 'backfill_last_seen', 'record_activity_minute')
     ORDER BY 1
  LOOP
    line := line || format(E'\n    %s calls=%s', r.funcname, r.calls);
  END LOOP;
  RAISE NOTICE E'10 FUNCTION CALL COUNTERS (track_functions=%):%', current_setting('track_functions'),
    CASE WHEN line = '' THEN ' none tracked' ELSE line END;

  -- 11 ─────────────────────────────────────────────────────────────────────
  SELECT string_agg(tgname || CASE WHEN tgenabled = 'D' THEN '(disabled)' ELSE '' END, ', ' ORDER BY tgname) AS t
    INTO r FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
  RAISE NOTICE '11 TRIGGERS ON profiles: %', coalesce(r.t, 'none');

  RAISE NOTICE 'PROBE COMPLETE (report only, changed nothing)';
END
$p$;

ROLLBACK;
