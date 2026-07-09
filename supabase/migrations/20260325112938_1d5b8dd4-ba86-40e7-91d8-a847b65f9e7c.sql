-- 1. Enable realtime for profiles table (for suspension monitoring)
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- 2. Enhanced trigger: sync OAuth metadata on user creation (moves syncProfile server-side)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _oauth_name text;
  _oauth_avatar text;
  _is_first_admin boolean;
BEGIN
  _oauth_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NULL
  );
  _oauth_avatar := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture',
    NULL
  );

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO _is_first_admin;

  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    CASE WHEN _is_first_admin THEN '50mm Retina World' ELSE _oauth_name END,
    _oauth_avatar
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  RETURN NEW;
END;
$function$;

-- 3. Trigger to sync OAuth metadata on subsequent logins
CREATE OR REPLACE FUNCTION public.sync_oauth_on_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _oauth_name text;
  _oauth_avatar text;
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
  _oauth_avatar := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture',
    NULL
  );

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'admin'
  ) INTO _is_admin;

  IF _is_admin THEN
    UPDATE public.profiles
    SET full_name = '50mm Retina World',
        avatar_url = COALESCE(avatar_url, _oauth_avatar),
        updated_at = now()
    WHERE id = NEW.id;
  ELSE
    IF _oauth_name IS NOT NULL OR _oauth_avatar IS NOT NULL THEN
      UPDATE public.profiles
      SET full_name = COALESCE(full_name, _oauth_name),
          avatar_url = COALESCE(avatar_url, _oauth_avatar),
          updated_at = now()
      WHERE id = NEW.id
        AND (full_name IS NULL OR avatar_url IS NULL);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_login_sync ON auth.users;
CREATE TRIGGER on_auth_user_login_sync
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_oauth_on_login();