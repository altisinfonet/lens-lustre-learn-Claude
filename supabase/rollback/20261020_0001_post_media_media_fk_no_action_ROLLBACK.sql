-- ROLLBACK of 20261020_0001: restore post_media_media_id_fkey ON DELETE RESTRICT.
-- (Restores the bug: admin Delete user fails again for members with post_media rows.)
BEGIN;
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.post_media'::regclass AND c.conname = 'post_media_media_id_fkey')
     IS DISTINCT FROM 'FOREIGN KEY (media_id) REFERENCES media_objects(id)' THEN
    RAISE EXCEPTION 'PMFK-0001-RB-PRE: constraint is not the NO ACTION form — 20261020_0001 not applied?' USING ERRCODE = 'raise_exception';
  END IF;
END
$pre$;
ALTER TABLE public.post_media DROP CONSTRAINT post_media_media_id_fkey;
ALTER TABLE public.post_media ADD CONSTRAINT post_media_media_id_fkey
  FOREIGN KEY (media_id) REFERENCES public.media_objects (id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.post_media VALIDATE CONSTRAINT post_media_media_id_fkey;
COMMIT;
