-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0111 — drop the new photos' credit record and its worker
-- functions, and put back photo_l4_rectify's default. No post is touched (0111
-- never repointed one). The credited copies the worker stored stay in the
-- bucket: they are `-r2048c` siblings the web finds by name. New uploads then
-- get no credited copy until the code that follows this file is rolled back too
-- (the browser canvas is in the commit before #U3's).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb$
BEGIN
  IF to_regclass('public.photo_set_credit') IS NULL THEN
    RAISE EXCEPTION 'SC-0111-RB-PRE-001: 20261110_0111 is not applied on this lane — nothing to roll back';
  END IF;
END
$rb$;

ALTER TABLE public.photo_l4_rectify ALTER COLUMN credit_version SET DEFAULT 3;
DROP FUNCTION public.photo_old_credit_record(uuid, integer, text, integer);
DROP FUNCTION public.photo_set_credit_record(text, integer, boolean, text);
DROP FUNCTION public.photo_set_credit_target(text);
DROP FUNCTION public.photo_set_credit_queue(integer, text);
DROP FUNCTION public.photo_set_credit_named();
DROP TABLE public.photo_set_credit;

DO $done$ BEGIN RAISE NOTICE 'SC-0111 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
