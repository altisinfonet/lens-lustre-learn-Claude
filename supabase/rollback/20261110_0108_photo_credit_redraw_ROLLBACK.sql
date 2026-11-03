-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0108 — drop the redraw functions and the credit_version
-- column. No post and no file is touched. (A credited copy already redrawn
-- stays at the geometry it was drawn with; it can be redrawn again at any time
-- from its clean copy — it is a derived file.)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regprocedure('public.photo_credit_redraw_queue(integer)') IS NULL THEN
    RAISE EXCEPTION 'RX-0108-RB-PRE-001: 20261110_0108 is not applied on this lane — nothing to roll back';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.photo_credit_redraw_record(uuid, integer, integer);
DROP FUNCTION public.photo_credit_redraw_target(uuid, integer);
DROP FUNCTION public.photo_credit_redraw_queue(integer);
ALTER TABLE public.photo_l4_rectify DROP COLUMN credit_version;

DO $done$ BEGIN RAISE NOTICE 'RX-0108 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
