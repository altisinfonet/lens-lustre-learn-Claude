-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0109 — drop the old-photo credit lookup, its writer
-- functions and its table. No post is touched (0109 never repointed one). The
-- web then finds no credited copy for an old photo: right-click saves the
-- original again, exactly as before 0109. The credited copies the writer stored
-- stay in the bucket (no longer referenced; delete only through the held
-- delete path, after detect-orphan-files has been redeployed without the table).
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
  IF to_regclass('public.photo_old_credit') IS NULL THEN
    RAISE EXCEPTION 'OC-0109-RB-PRE-001: 20261110_0109 is not applied on this lane — nothing to roll back';
  END IF;
END
$rb$;

DROP FUNCTION public.post_photo_credit_for(uuid[]);
DROP FUNCTION public.photo_old_credit_record(uuid, integer, text);
DROP FUNCTION public.photo_old_credit_target(uuid, integer);
DROP FUNCTION public.photo_old_credit_queue(integer, uuid);
DROP FUNCTION public.photo_old_credit_key(uuid, uuid, integer, text);
DROP FUNCTION public.photo_old_credit_class(text);
DROP TABLE public.photo_old_credit;

DO $done$ BEGIN RAISE NOTICE 'OC-0109 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
