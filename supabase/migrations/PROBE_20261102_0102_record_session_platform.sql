-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261102_0102 record_session_platform. READ ONLY, ROLLBACK. Counts only.
-- PASS = the function exists as 0102 creates it (SECURITY DEFINER,
-- search_path '', authenticated + service_role only, writes only on change).
-- Before the apply it FAILS (expected).
-- Reports, never fails on, the Unit A gate numbers: members with a heartbeat
-- minute in the last 7 days / 24 hours whose platform is still NULL. Those
-- fall to 0 as members open the app or site with the fixed client; a member
-- who has not come back since cannot be filled without guessing.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE f oid := to_regprocedure('public.record_session_platform(text)'); r record;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF f IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.record_session_platform(text) missing (0102 not applied)';
  END IF;
  IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'PROBE FAIL: record_session_platform is not SECURITY DEFINER with search_path=""';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) x WHERE p.oid = f AND x.grantee = 0) THEN
    RAISE EXCEPTION 'PROBE FAIL: EXECUTE is not authenticated + service_role only';
  END IF;
  IF position('IS DISTINCT FROM _platform' IN pg_get_functiondef(f)) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: the body does not guard the write with IS DISTINCT FROM (would write every call)';
  END IF;

  IF to_regclass('public.member_activity_minutes') IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE m.newest >= now() - interval '7 days') AS a7,
           count(*) FILTER (WHERE m.newest >= now() - interval '7 days' AND p.last_platform IS NULL) AS n7,
           count(*) FILTER (WHERE m.newest >= now() - interval '24 hours') AS a1,
           count(*) FILTER (WHERE m.newest >= now() - interval '24 hours' AND p.last_platform IS NULL) AS n1
      INTO r
      FROM (SELECT user_id, max(minute_bucket) AS newest FROM public.member_activity_minutes
             WHERE minute_bucket >= now() - interval '7 days' GROUP BY user_id) m
      JOIN public.profiles p ON p.id = m.user_id;
    RAISE NOTICE 'GATE (lane %): active 7 days=% · platform NULL=% | active 24 h=% · platform NULL=%',
      current_setting('p32.lane'), r.a7, r.n7, r.a1, r.n1;
  END IF;
  SELECT count(*) FILTER (WHERE last_platform IS NULL) AS n, count(*) AS t INTO r FROM public.profiles;
  RAISE NOTICE 'all members=% · shown as Unknown (platform NULL)=%', r.t, r.n;
  RAISE NOTICE 'PROBE PASS: 20261102_0102 present as intended';
END
$p$;

ROLLBACK;
