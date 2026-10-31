-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · P2 · 20260920_0002 — REPLICA IDENTITY FULL restored on
-- competition_round_publish
-- Undoes supabase/migrations/20260920_0002_p2_replica_identity_production.sql
-- PRODUCTION LANE ONLY.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES. Sets public.competition_round_publish back to REPLICA IDENTITY
-- FULL — the pre-image the apply found and asserted (its PRE-002/PRE-005).
-- Nothing else: the apply changed only that one relreplident value, so
-- restoring it is the whole inverse. The post-condition checks the published
-- FULL set is back to the three tables of the 2026-09-26 reading.
--
-- LANE GUARD — PRODUCTION ONLY (R-61: "rollback restores FULL ..., with a
-- production-only guard"). On staging this table was never FULL; running this
-- there would create a state staging never had. The invoking session asserts
-- the lane; this file never sets it:
--
--     SET p32.lane = 'production';   -- then run this file in the same session
--
-- apply-migration.yml sets it from its own lane guard (R-13).
--
-- NOT RE-RUNNABLE. RB-PRE-002 refuses when the table is already FULL.
-- LOCKS. As the apply: ACCESS EXCLUSIVE, lock_timeout 5 s.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'production' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as production (read: %). '
      'This rollback restores REPLICA IDENTITY FULL, which only production ever had. '
      'Set it in THIS session before running: SET p32.lane = ''production'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  IF to_regclass('public.competition_round_publish') IS NULL THEN
    RAISE EXCEPTION 'P2-0002-RB-PRE-001: public.competition_round_publish does not exist'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT relreplident FROM pg_class WHERE oid = 'public.competition_round_publish'::regclass) <> 'd' THEN
    RAISE EXCEPTION 'P2-0002-RB-PRE-002: public.competition_round_publish is REPLICA IDENTITY %, not DEFAULT — '
      'nothing to roll back (or something other than 20260920_0002 changed it; re-read first)',
      (SELECT relreplident FROM pg_class WHERE oid = 'public.competition_round_publish'::regclass)
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

ALTER TABLE public.competition_round_publish REPLICA IDENTITY FULL;

DO $postconditions$
DECLARE
  full_set text;
BEGIN
  SELECT string_agg(pt.schemaname || '.' || pt.tablename, ',' ORDER BY pt.tablename) INTO full_set
    FROM pg_publication_tables pt
    JOIN pg_class c ON c.relname = pt.tablename AND c.relnamespace = pt.schemaname::regnamespace
   WHERE pt.pubname = 'supabase_realtime' AND c.relreplident = 'f';
  IF full_set IS DISTINCT FROM 'public.competition_round_publish,public.profiles,public.scheduled_posts' THEN
    RAISE EXCEPTION 'P2-0002-RB-POST-001: published FULL tables are (%), not the three of the '
      '2026-09-26 reading', coalesce(full_set, 'none')
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
