-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0113 — drop the extra-copy hold list and its functions.
-- REFUSES while any file is held (state 'held'): put them back first with
-- photo-hold.yml mode restore, or the record of where they wait is lost.
-- Restored / queued / kept post_extra rows are removed with the checks.
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
DECLARE _held bigint;
BEGIN
  IF to_regprocedure('public.photo_extra_mark()') IS NULL THEN
    RAISE EXCEPTION 'EX-0113-RB-PRE-001: 20261110_0113 is not applied on this lane — nothing to roll back';
  END IF;
  SELECT count(*) INTO _held FROM public.photo_retire WHERE kind = 'post_extra' AND state = 'held';
  IF _held > 0 THEN
    RAISE EXCEPTION 'EX-0113-RB-PRE-002: % file(s) are held in photo-holding/ — restore them first (photo-hold.yml, mode restore)', _held;
  END IF;
END
$rb$;

DROP FUNCTION public.photo_extra_record(text, jsonb);
DROP FUNCTION public.photo_extra_claim(text, integer, bigint);
DROP FUNCTION public.photo_extra_mark();
DROP FUNCTION public.photo_extra_referenced(text[]);
DELETE FROM public.photo_retire WHERE kind = 'post_extra';
DROP INDEX public.photo_retire_extra_idx;
ALTER TABLE public.photo_retire
  DROP CONSTRAINT photo_retire_extra_state_check,
  DROP CONSTRAINT photo_retire_held_key_check,
  DROP COLUMN restored_at,
  DROP COLUMN held_at,
  DROP COLUMN held_key,
  DROP CONSTRAINT photo_retire_state_check,
  ADD CONSTRAINT photo_retire_state_check CHECK (state IN ('due', 'deleted', 'kept')),
  DROP CONSTRAINT photo_retire_kind_check,
  ADD CONSTRAINT photo_retire_kind_check CHECK (kind IN ('comp_full', 'post_old'));

COMMIT;
