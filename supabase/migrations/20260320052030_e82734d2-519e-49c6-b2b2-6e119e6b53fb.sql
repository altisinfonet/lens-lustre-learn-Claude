
-- When a user is assigned the admin role, auto-set their profile name to the brand name
CREATE OR REPLACE FUNCTION public.enforce_admin_brand_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    UPDATE public.profiles
    SET full_name = '50mm Retina World', updated_at = now()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_admin_brand_name
AFTER INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_admin_brand_name();

-- Prevent admins from changing their full_name
CREATE OR REPLACE FUNCTION public.protect_admin_full_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'admin') THEN
      NEW.full_name := '50mm Retina World';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_admin_name
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_admin_full_name();
