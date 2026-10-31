-- S8 / F-P1-6 · old app builds still send the 5-minute timer UPDATE.
--
-- P1 (docs/gates/P1-interface.md §5) removed the client timer: current builds
-- never write profiles.last_active_at / last_platform; the server owns them
-- (record_session_end, backfill_last_seen — both SECURITY DEFINER, so inside
-- them current_user is the owner, not an API role). Installed app builds from
-- before 2-D2-03 still PATCH /profiles?id=eq.<me> {last_active_at, last_platform}
-- every five minutes. Each one is a profiles row version (dead tuple, the P1
-- autovacuum problem) plus a fan-out through the AFTER UPDATE mirror trigger.
--
-- THE TOLERANCE: a BEFORE UPDATE trigger that, ONLY for a direct API-role write
-- (current_user is authenticated or anon), puts last_active_at and
-- last_platform back to their stored values. If nothing else in the row
-- changed, it returns NULL: the UPDATE succeeds for the client (0 rows, no
-- error, so no crash or retry loop in the old build) and writes nothing.
-- Any other column in the same UPDATE is kept. Server-side writers are
-- untouched. The function is SECURITY INVOKER (so current_user is the caller)
-- and touches only NEW/OLD — no table read, nothing to grant.
--
-- Rollback: supabase/rollback/20261029_0002_f_p1_6_ignore_client_presence_write_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_s8_f_p1_6_client_presence_write.sql
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  -- PRE-001 · the two columns exist with the types this file assumes
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('last_active_at', 'last_platform')) <> 2 THEN
    RAISE EXCEPTION 'F-P1-6-PRE-001: public.profiles.last_active_at / last_platform not both present — refusing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · the sanctioned writers are SECURITY DEFINER (else this trigger would block them)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('record_session_end', 'backfill_last_seen')
                AND NOT p.prosecdef) THEN
    RAISE EXCEPTION 'F-P1-6-PRE-002: record_session_end / backfill_last_seen is not SECURITY DEFINER on this lane — refusing'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.tg_profiles_ignore_client_presence_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  NEW.last_active_at := OLD.last_active_at;
  NEW.last_platform  := OLD.last_platform;
  IF NEW::text = OLD::text THEN   -- text form: works for every column type (json has no =)
    RETURN NULL;   -- the old-build timer write: nothing to store
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_profiles_ignore_client_presence_write() IS
  'S8 F-P1-6. Old app builds still PATCH profiles.last_active_at/last_platform every 5 min. For a direct API-role write the two columns are restored from OLD; a row left unchanged is skipped (RETURN NULL), so the client sees success and nothing is written. Server writers (SECURITY DEFINER) are untouched.';

REVOKE ALL ON FUNCTION public.tg_profiles_ignore_client_presence_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_aa_ignore_client_presence_write ON public.profiles;
CREATE TRIGGER trg_profiles_aa_ignore_client_presence_write
  BEFORE UPDATE OF last_active_at, last_platform ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_profiles_ignore_client_presence_write();

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.profiles'::regclass
                    AND tgname = 'trg_profiles_aa_ignore_client_presence_write'
                    AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'F-P1-6-POST-001: trigger not installed/enabled' USING ERRCODE = 'raise_exception';
  END IF;
END
$post$;

COMMIT;
