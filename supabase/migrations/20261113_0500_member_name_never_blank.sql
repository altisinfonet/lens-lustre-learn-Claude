-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113_0500 · EVERY MEMBER HAS A NAME — the database guarantees it
--
-- Owner 13 Nov 2026: "always name will show, not Photographer anymore, like
-- META … strong backend". Measured on production (PROBE 0400, run
-- 43388804457): 148 members, 1 with no name; profiles.full_name is nullable
-- with no rule, and handle_new_user stores NULL when the sign-in gives no name.
--
-- Like Instagram (a member without a name shows by their username):
--   • trigger trg_profiles_zzz_name_never_blank (BEFORE INSERT OR UPDATE; named
--     to run AFTER trg_profiles_zz_assign_custom_url, so the handle exists):
--     a blank name becomes the member's handle; with no handle either (the
--     handle step failed), "member" + the first 6 of the id — a signup never
--     fails over a name
--   • the one nameless member today gets their handle
--   • CHECK profiles_full_name_not_blank: no row can be saved without a name
--
-- Rollback: supabase/rollback/20261113_0500_member_name_never_blank_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261113_0500_member_name_never_blank.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE FUNCTION public.tg_profiles_name_never_blank()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $fn$
BEGIN
  IF NEW.full_name IS NULL OR btrim(NEW.full_name) = '' THEN
    NEW.full_name := coalesce(nullif(btrim(NEW.custom_url), ''), 'member' || left(replace(NEW.id::text, '-', ''), 6));
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_profiles_name_never_blank() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_profiles_zzz_name_never_blank
  BEFORE INSERT OR UPDATE OF full_name, custom_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_name_never_blank();

-- the members who have no name today (1 on production)
UPDATE public.profiles
   SET full_name = coalesce(nullif(btrim(custom_url), ''), 'member' || left(replace(id::text, '-', ''), 6))
 WHERE full_name IS NULL OR btrim(full_name) = '';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_not_blank CHECK (full_name IS NOT NULL AND btrim(full_name) <> '') NOT VALID;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_full_name_not_blank;

COMMIT;
