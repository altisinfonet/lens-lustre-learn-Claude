-- Production's two auth.users trigger functions, VERBATIM (pg_get_functiondef text)
-- from the read-only collector run of 2026-10-13 06:51Z
-- (_control/forensic/supabase-20261013-121953/live/db/function_defs.json, not in this repo).
-- Fixture for rehearse-0002.mjs only. Never dispatch: this directory is not an apply path.
-- md5(prosrc): handle_new_user ca4a770bff3c438515f6edf9b977efbb,
--              sync_oauth_on_login 6c157691677358931ff05084c7fefee4 (asserted by the harness).

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _oauth_name text; _is_first_admin boolean;
BEGIN
  _oauth_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL);
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO _is_first_admin;
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id,
    CASE WHEN _is_first_admin THEN '50mm Retina World' ELSE _oauth_name END,
    '/avatars/fallback/m' || ((abs(hashtext(NEW.id::text)) % 5) + 1)::text || '.svg');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_oauth_on_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _oauth_name text;
  _is_admin boolean;
BEGIN
  IF OLD.last_sign_in_at IS NOT DISTINCT FROM NEW.last_sign_in_at THEN
    RETURN NEW;
  END IF;

  _oauth_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NULL
  );

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'admin'
  ) INTO _is_admin;

  -- Avatar sync removed on purpose: it was the path that kept restoring
  -- hotlinked pictures after they were blanked. Names still sync.
  IF _is_admin THEN
    UPDATE public.profiles
    SET full_name = '50mm Retina World',
        updated_at = now()
    WHERE id = NEW.id
      AND full_name IS DISTINCT FROM '50mm Retina World';
  ELSE
    IF _oauth_name IS NOT NULL THEN
      UPDATE public.profiles
      SET full_name = COALESCE(full_name, _oauth_name),
          updated_at = now()
      WHERE id = NEW.id
        AND full_name IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
