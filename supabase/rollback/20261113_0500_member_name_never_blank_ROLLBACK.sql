-- ROLLBACK of 20261113_0500. The names already written stay (a member keeps the
-- handle-name they were given — it is a real, chosen-by-system name, not data loss).
BEGIN;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_full_name_not_blank;
DROP TRIGGER IF EXISTS trg_profiles_zzz_name_never_blank ON public.profiles;
DROP FUNCTION IF EXISTS public.tg_profiles_name_never_blank();
COMMIT;
