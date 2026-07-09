
CREATE OR REPLACE FUNCTION public.change_custom_url(_new_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID;
  _cleaned TEXT;
  _old_url TEXT;
  _last_changed TIMESTAMPTZ;
  _existing RECORD;
  _reserved TEXT[] := ARRAY[
    'login','signup','forgot-password','reset-password','dashboard','edit-profile',
    'profile','friends','feed','discover','competitions','admin','judge','journal',
    'courses','certificates','verify','winners','wallet','featured-artist','referrals',
    'help-support','page','hashtag','not-found','photos','unsubscribe','cookie-policy',
    'post','entry','certificate',
    'root','system','api','support','help','contact','about','settings',
    'user','users','www','mail','ftp','cdn','static','assets','media'
  ];
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _cleaned := lower(trim(_new_url));

  IF length(_cleaned) < 3 OR length(_cleaned) > 50 THEN
    RAISE EXCEPTION 'Custom URL must be between 3 and 50 characters';
  END IF;

  IF _cleaned !~ '^[a-z0-9._\-]+$' THEN
    RAISE EXCEPTION 'Only lowercase letters, numbers, dots, hyphens, and underscores allowed';
  END IF;

  IF _cleaned = ANY(_reserved) THEN
    RAISE EXCEPTION 'This URL is reserved';
  END IF;

  SELECT custom_url, custom_url_changed_at INTO _old_url, _last_changed
  FROM public.profiles WHERE id = _user_id;

  IF lower(COALESCE(_old_url, '')) = _cleaned THEN
    RETURN jsonb_build_object('success', true, 'message', 'URL unchanged');
  END IF;

  IF _last_changed IS NOT NULL AND now() - _last_changed < interval '90 days' THEN
    RAISE EXCEPTION 'You can only change your custom URL once every 90 days. Next change available: %',
      (_last_changed + interval '90 days')::date;
  END IF;

  SELECT id, user_id, is_current, released_at INTO _existing
  FROM public.custom_url_history
  WHERE lower(custom_url) = _cleaned
  ORDER BY created_at DESC
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    IF _existing.user_id = _user_id THEN
      NULL;
    ELSIF _existing.is_current THEN
      RAISE EXCEPTION 'This custom URL is already taken';
    ELSIF _existing.released_at IS NOT NULL AND _existing.released_at > now() - interval '30 days' THEN
      RAISE EXCEPTION 'This URL was recently released. Available after %',
        (_existing.released_at + interval '30 days')::date;
    END IF;
  END IF;

  UPDATE public.custom_url_history
  SET is_current = false, released_at = now()
  WHERE user_id = _user_id AND is_current = true;

  IF _existing IS NOT NULL AND _existing.user_id = _user_id THEN
    UPDATE public.custom_url_history
    SET is_current = true, released_at = NULL
    WHERE id = _existing.id;
  ELSE
    IF _existing IS NOT NULL AND _existing.user_id != _user_id THEN
      DELETE FROM public.custom_url_history WHERE id = _existing.id;
    END IF;
    INSERT INTO public.custom_url_history (user_id, custom_url, is_current)
    VALUES (_user_id, _cleaned, true);
  END IF;

  PERFORM set_config('app.allow_custom_url_update', 'true', true);

  UPDATE public.profiles
  SET custom_url = _cleaned, custom_url_changed_at = now()
  WHERE id = _user_id;

  RETURN jsonb_build_object(
    'success', true,
    'custom_url', _cleaned,
    'next_change_available', (now() + interval '90 days')::date
  );
END;
$$;
