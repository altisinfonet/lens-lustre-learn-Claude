-- ═══════════════════════════════════════════════════════════════════════════
-- 20261020_0001 · LIVE FIX: admin "Delete user" fails for any member with a
-- post stored through media_objects/post_media.
--
-- MEASURED (production, PROBE_diag_20261020_admin_delete_suspend.sql, run
-- 39378598771, 2026-10-20): admin_delete_auth_user → DELETE FROM auth.users →
--   23503 update or delete on table "media_objects" violates foreign key
--   constraint "post_media_media_id_fkey" on table "post_media".
-- CAUSE: post_media.media_id REFERENCES media_objects ON DELETE RESTRICT
-- (20260814084711_media_objects.sql:114). RESTRICT is checked IMMEDIATELY, in the
-- middle of the account cascade: media_objects (owner_id → auth.users CASCADE)
-- goes before the member's posts → post_media (post_id → posts CASCADE) rows do.
--
-- FIX: the same rule as NO ACTION. Postgres checks NO ACTION at the END of the
-- statement, after the cascade has also removed the posts and their post_media
-- rows. The protection is unchanged: a media object that a surviving post still
-- uses can still NOT be deleted (the end-of-statement check refuses it).
-- No data changes. ROLLBACK file restores RESTRICT.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE _def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.post_media'::regclass AND c.conname = 'post_media_media_id_fkey';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'PMFK-0001-PRE: post_media_media_id_fkey not found' USING ERRCODE = 'raise_exception';
  END IF;
  IF _def <> 'FOREIGN KEY (media_id) REFERENCES media_objects(id) ON DELETE RESTRICT' THEN
    RAISE EXCEPTION 'PMFK-0001-PRE: post_media_media_id_fkey is not the expected RESTRICT form (found: %) — already applied?', _def
      USING ERRCODE = 'raise_exception';
  END IF;
END
$pre$;

-- NOT VALID + VALIDATE: the new constraint is added without a full-table lock,
-- then validated (every existing row already satisfies it — it is the same rule).
ALTER TABLE public.post_media DROP CONSTRAINT post_media_media_id_fkey;
ALTER TABLE public.post_media ADD CONSTRAINT post_media_media_id_fkey
  FOREIGN KEY (media_id) REFERENCES public.media_objects (id) ON DELETE NO ACTION NOT VALID;
ALTER TABLE public.post_media VALIDATE CONSTRAINT post_media_media_id_fkey;

DO $post$
BEGIN
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.post_media'::regclass AND c.conname = 'post_media_media_id_fkey')
     <> 'FOREIGN KEY (media_id) REFERENCES media_objects(id)' THEN
    RAISE EXCEPTION 'PMFK-0001-POST: constraint not in NO ACTION form' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'PMFK-0001: post_media_media_id_fkey RESTRICT -> NO ACTION (checked at end of statement); account delete cascade no longer blocked';
END
$post$;

COMMIT;
