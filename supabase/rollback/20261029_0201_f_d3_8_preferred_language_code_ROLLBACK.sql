-- ROLLBACK for 20261029_0201_f_d3_8_preferred_language_code.sql
-- Restores the old shape: no CHECK, NOT NULL DEFAULT 'English'. Rows the
-- forward step set to NULL (and rows written NULL since) get 'English' — the
-- old default; the client ignores it either way. Not byte-exact: a row that
-- held another label before the forward step comes back as 'English'.
-- Same trigger suppression as the forward step, same reason.
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_preferred_language_code_chk;
ALTER TABLE public.profiles ALTER COLUMN preferred_language SET DEFAULT 'English';

SET LOCAL session_replication_role = replica;

UPDATE public.profiles SET preferred_language = 'English' WHERE preferred_language IS NULL;

DO $copy$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'profiles_public_data'
                AND column_name = 'preferred_language') THEN
    UPDATE public.profiles_public_data SET preferred_language = 'English' WHERE preferred_language IS NULL;
  END IF;
END
$copy$;

SET LOCAL session_replication_role = origin;

ALTER TABLE public.profiles ALTER COLUMN preferred_language SET NOT NULL;

COMMIT;
