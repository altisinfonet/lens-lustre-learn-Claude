
CREATE OR REPLACE FUNCTION public.clear_custom_url()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.custom_url_history
  SET is_current = false, released_at = now()
  WHERE user_id = auth.uid() AND is_current = true;

  UPDATE public.profiles
  SET custom_url = NULL, custom_url_changed_at = now()
  WHERE id = auth.uid();
END;
$$;
