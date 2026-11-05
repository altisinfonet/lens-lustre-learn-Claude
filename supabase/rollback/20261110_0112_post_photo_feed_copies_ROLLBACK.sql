-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0112 — drop the old photos' feed-copy lookup. Nothing
-- else exists to undo (0112 wrote no file and changed no row). The feed then
-- finds no copy for an old photo and loads its original again, as before.
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
  IF to_regprocedure('public.post_photo_feed_copies(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'FC-0112-RB-PRE-001: 20261110_0112 is not applied on this lane — nothing to roll back';
  END IF;
END
$rb$;

DROP FUNCTION public.post_photo_feed_copies(uuid[]);

COMMIT;
