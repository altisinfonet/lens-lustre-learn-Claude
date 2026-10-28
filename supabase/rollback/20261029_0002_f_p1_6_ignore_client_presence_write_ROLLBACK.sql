-- ROLLBACK for 20261029_0002 (F-P1-6). Removes the trigger and its function.
-- Effect: old app builds' 5-minute timer UPDATEs write profiles again.
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

DROP TRIGGER IF EXISTS trg_profiles_aa_ignore_client_presence_write ON public.profiles;
DROP FUNCTION IF EXISTS public.tg_profiles_ignore_client_presence_write();

COMMIT;
