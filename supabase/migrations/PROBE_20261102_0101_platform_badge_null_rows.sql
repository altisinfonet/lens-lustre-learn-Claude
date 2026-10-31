-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · Unit A, second measurement — WHERE EACH NULL-PLATFORM ROW CAME FROM.
-- READ ONLY, ROLLBACK. COUNTS ONLY — never an id, e-mail or name.
--
-- PROBE_20261102_0100 (production run 40994307608, 2026-10-30 02:54 UTC):
-- 39 of 139 members have last_platform NULL; 36 of them were last seen before
-- 2026-09-20; 1 of 25 members active in the last 7 days is NULL.
--
-- Not measured there, and needed before naming a cause:
--   public.profiles.last_active_at is declared DEFAULT now()
--   (20260330142754:3), so EVERY sign-up row starts with a "last seen" and no
--   platform. A stored value equal to the sign-up instant is that default —
--   nothing was ever recorded after it.
--
--   A  the column default on this lane (catalog)
--   B  every NULL-platform member, by which writer the stored value fits:
--        B1 = sign-up default (within 5 s of auth.users.created_at)
--        B2 = minute-shaped (backfill_last_seen copied a heartbeat minute)
--        B3 = other, and in which era: before 2026-08-05 (platform not yet
--             recorded by any writer), 2026-08-05..P1, after P1
--   C  for B1 members: heartbeat minutes in the 40-day window — none, or all
--      within 10 minutes of sign-up (backfill_last_seen never moves those)
--   D  members who signed up since 2026-10-04 (P1 client on main): platform
--      split, and NULLs among them that were active > 60 s after sign-up
--   E  real recorded per-member platform evidence for each NULL group:
--      push_tokens (android/ios/web) and client_errors (app/web)
-- FAILS only if profiles, auth.users, push_tokens or client_errors is missing.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE
  r record;
  line text := '';
  has_mam boolean := to_regclass('public.member_activity_minutes') IS NOT NULL;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('auth.users') IS NULL
     OR to_regclass('public.push_tokens') IS NULL OR to_regclass('public.client_errors') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: profiles, auth.users, push_tokens or client_errors missing (both lanes have all four, measured by PROBE_20261102_0100)';
  END IF;

  RAISE NOTICE 'UNIT-A NULL ROWS · lane % · measured % UTC',
    current_setting('p32.lane'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');

  -- A ──────────────────────────────────────────────────────────────────────
  SELECT coalesce(column_default, '(none)') AS d INTO r FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'last_active_at';
  RAISE NOTICE 'A profiles.last_active_at DEFAULT = %', r.d;
  SELECT coalesce(column_default, '(none)') AS d INTO r FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'last_platform';
  RAISE NOTICE 'A profiles.last_platform  DEFAULT = %', r.d;

  -- B ──────────────────────────────────────────────────────────────────────
  FOR r IN
    WITH n AS (
      SELECT p.id, p.last_active_at AS la, u.created_at AS su
        FROM public.profiles p JOIN auth.users u ON u.id = p.id
       WHERE p.last_platform IS NULL
    )
    SELECT CASE
             WHEN la IS NULL THEN 'B0 never written'
             WHEN abs(extract(epoch FROM la - su)) <= 5 THEN 'B1 = sign-up default'
             WHEN la = date_trunc('minute', la) THEN 'B2 minute-shaped (backfill)'
             WHEN la < timestamptz '2026-08-05' THEN 'B3a other, before 2026-08-05'
             WHEN la < timestamptz '2026-10-04' THEN 'B3b other, 2026-08-05..2026-10-03'
             ELSE 'B3c other, since 2026-10-04'
           END AS g,
           count(*) AS n,
           count(*) FILTER (WHERE su < timestamptz '2026-08-05') AS su_before_0805,
           count(*) FILTER (WHERE su >= timestamptz '2026-10-04') AS su_since_1004,
           count(*) FILTER (WHERE la >= now() - interval '7 days') AS seen_7d,
           count(*) FILTER (WHERE la >= now() - interval '30 days') AS seen_30d
      FROM n GROUP BY 1 ORDER BY 1
  LOOP
    line := line || format(E'\n    %-36s n=%s · signed up before 2026-08-05=%s · signed up since 2026-10-04=%s · last seen <7d=%s <30d=%s',
                           r.g, r.n, r.su_before_0805, r.su_since_1004, r.seen_7d, r.seen_30d);
  END LOOP;
  RAISE NOTICE E'B NULL-PLATFORM MEMBERS BY WRITER:%', line;

  -- C ──────────────────────────────────────────────────────────────────────
  IF has_mam THEN
    SELECT count(*) AS b1,
           count(*) FILTER (WHERE m.n IS NULL) AS no_minutes,
           count(*) FILTER (WHERE m.n IS NOT NULL AND m.newest <= u.created_at + interval '10 minutes') AS within_10m,
           count(*) FILTER (WHERE m.n IS NOT NULL AND m.newest >  u.created_at + interval '10 minutes') AS later
      INTO r
      FROM public.profiles p JOIN auth.users u ON u.id = p.id
      LEFT JOIN (SELECT user_id, count(*) AS n, max(minute_bucket) AS newest
                   FROM public.member_activity_minutes GROUP BY user_id) m ON m.user_id = p.id
     WHERE p.last_platform IS NULL AND abs(extract(epoch FROM p.last_active_at - u.created_at)) <= 5;
    RAISE NOTICE 'C B1 members=% · heartbeat minutes in the 40-day window: none=% · all within 10 min of sign-up=% · later=%',
      r.b1, r.no_minutes, r.within_10m, r.later;
  ELSE
    RAISE NOTICE 'C member_activity_minutes ABSENT';
  END IF;

  -- D ──────────────────────────────────────────────────────────────────────
  SELECT count(*) AS n,
         count(*) FILTER (WHERE p.last_platform = 'app') AS app,
         count(*) FILTER (WHERE p.last_platform = 'web') AS web,
         count(*) FILTER (WHERE p.last_platform IS NULL) AS nul
    INTO r
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.created_at >= timestamptz '2026-10-04';
  RAISE NOTICE 'D signed up since 2026-10-04: % · app=% web=% NULL=%', r.n, r.app, r.web, r.nul;
  IF has_mam THEN
    SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.member_activity_minutes m
                                           WHERE m.user_id = p.id AND m.minute_bucket > u.created_at + interval '1 minute')) AS active_after_60s,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.member_activity_minutes m
                                           WHERE m.user_id = p.id AND m.minute_bucket > u.created_at + interval '1 day')) AS active_next_day
      INTO r
      FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE u.created_at >= timestamptz '2026-10-04' AND p.last_platform IS NULL;
    RAISE NOTICE 'D of those NULL: heartbeat later than sign-up + 1 min=% · on a later day=%', r.active_after_60s, r.active_next_day;
  END IF;

  -- E ──────────────────────────────────────────────────────────────────────
  line := '';
  FOR r IN
    WITH n AS (
      SELECT p.id, p.last_active_at AS la, u.created_at AS su
        FROM public.profiles p JOIN auth.users u ON u.id = p.id
       WHERE p.last_platform IS NULL
    )
    SELECT CASE WHEN abs(extract(epoch FROM la - su)) <= 5 THEN 'B1' WHEN la = date_trunc('minute', la) THEN 'B2' ELSE 'B3' END AS g,
           count(*) AS n,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.user_id = n.id AND t.platform IN ('android', 'ios'))) AS app_token,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.push_tokens t WHERE t.user_id = n.id AND t.platform = 'web')) AS web_token,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.client_errors c WHERE c.user_id = n.id AND c.platform IN ('app', 'web'))) AS ce
      FROM n GROUP BY 1 ORDER BY 1
  LOOP
    line := line || format(E'\n    %s n=%s · with an app push token=%s · with a web push token=%s · with a client_errors app/web row=%s',
                           r.g, r.n, r.app_token, r.web_token, r.ce);
  END LOOP;
  RAISE NOTICE E'E REAL RECORDED PLATFORM EVIDENCE FOR NULL ROWS:%', line;

  RAISE NOTICE 'PROBE COMPLETE (report only, changed nothing)';
END
$p$;

ROLLBACK;
