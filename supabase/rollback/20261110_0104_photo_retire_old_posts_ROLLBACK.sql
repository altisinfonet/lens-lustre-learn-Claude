-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0104 old post files queued (photo plan U7).
-- Removes every post_old row that is NOT deleted yet (due or kept), so nothing
-- of them can be deleted any more and the 0102 swap rollback works again for
-- posts with no deleted file. Deleted files cannot come back: their rows stay
-- as the record (counted in a NOTICE). Run this BEFORE the deleter if in doubt —
-- and pause photo-retire.yml first (Actions → Photo retire → Disable) so no run
-- is between "deleted" and "recorded" while this runs.
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
DECLARE _n int; _gone bigint;
BEGIN
  IF to_regclass('public.photo_retire') IS NULL THEN
    RAISE EXCEPTION 'U7-0104-RB-PRE-001: 20261110_0103 is not applied on this lane';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_retire WHERE kind = 'post_old' AND state IN ('due', 'kept')) THEN
    RAISE EXCEPTION 'U7-0104-RB-PRE-002: no queued old post file on this lane — nothing to roll back';
  END IF;
  DELETE FROM public.photo_retire WHERE kind = 'post_old' AND state IN ('due', 'kept');
  GET DIAGNOSTICS _n = ROW_COUNT;
  SELECT count(*) INTO _gone FROM public.photo_retire WHERE kind = 'post_old' AND state = 'deleted';
  RAISE NOTICE 'U7-0104 rolled back on %: % queued row(s) removed · % file(s) already deleted stay recorded', current_setting('p32.lane'), _n, _gone;
END
$rb$;

COMMIT;
