-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0101 photo-set backfill (photo plan U5).
-- Drops exactly what the migration created, in reverse: the three worker
-- functions, the three helpers, photo_set_swap, photo_set_backfill.
-- REFUSES while any post is swapped (photo_set_swap has rows): run
-- supabase/rollback/20261110_0102_photo_set_swap_ROLLBACK.sql first, so no
-- post is left pointing at copies whose record this would drop.
-- The copies in the photo bucket are NOT touched (this file cannot reach R2);
-- the backfill record rows are dropped with their table (counted first).
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

DO $pre$
DECLARE _n bigint;
BEGIN
  IF to_regclass('public.photo_set_backfill') IS NULL AND to_regclass('public.photo_set_swap') IS NULL
     AND to_regprocedure('public.photo_set_backfill_queue(integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'U5-0101-RB-PRE-001: 20261110_0101 is not applied on this lane — nothing to roll back';
  END IF;
  IF to_regclass('public.photo_set_swap') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.photo_set_swap' INTO _n;
    IF _n > 0 THEN
      RAISE EXCEPTION 'U5-0101-RB-PRE-002: % post(s) are swapped to the new copies — roll back 20261110_0102 first', _n;
    END IF;
  END IF;
  IF to_regclass('public.photo_set_backfill') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.photo_set_backfill' INTO _n;
    RAISE NOTICE 'U5-0101 rollback: dropping % backfill record row(s) (the copies stay in the bucket)', _n;
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.photo_set_backfill_record(uuid, integer, text);
DROP FUNCTION IF EXISTS public.photo_set_backfill_target(uuid, integer);
DROP FUNCTION IF EXISTS public.photo_set_backfill_queue(integer, uuid);
DROP FUNCTION IF EXISTS public.photo_set_backfill_new_url(text, text);
DROP FUNCTION IF EXISTS public.photo_set_backfill_source_key(text);
DROP FUNCTION IF EXISTS public.photo_set_backfill_cdn();
DROP TABLE IF EXISTS public.photo_set_swap;
DROP TABLE IF EXISTS public.photo_set_backfill;

DO $done$ BEGIN RAISE NOTICE 'U5-0101 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
