
CREATE OR REPLACE FUNCTION public.validate_profile_full_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.full_name IS NOT NULL AND btrim(NEW.full_name) = '' THEN
    RAISE EXCEPTION 'profiles.full_name must not be empty or whitespace-only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_profile_full_name ON public.profiles;
CREATE TRIGGER trg_validate_profile_full_name
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_full_name();
