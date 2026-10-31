-- Push notification device tokens (Capacitor / FCM). One row per device token.
-- FK to auth.users CASCADE so it never blocks account deletion.

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  platform   text NOT NULL CHECK (platform IN ('ios','android','web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens(user_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own push tokens" ON public.push_tokens;
CREATE POLICY "read own push tokens" ON public.push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "delete own push tokens" ON public.push_tokens;
CREATE POLICY "delete own push tokens" ON public.push_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, DELETE ON public.push_tokens TO authenticated;

-- Register (or move) a device token to the current user. SECURITY DEFINER so a
-- token previously registered to another account (shared device) is reassigned
-- cleanly rather than blocked by RLS.
CREATE OR REPLACE FUNCTION public.register_push_token(_token text, _platform text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _token IS NULL OR length(_token) = 0 THEN
    RAISE EXCEPTION 'token required';
  END IF;
  IF _platform NOT IN ('ios','android','web') THEN
    RAISE EXCEPTION 'invalid platform: %', _platform;
  END IF;

  INSERT INTO public.push_tokens (user_id, token, platform)
  VALUES (auth.uid(), _token, _platform)
  ON CONFLICT (token) DO UPDATE
    SET user_id = auth.uid(), platform = EXCLUDED.platform, updated_at = now();
END;
$function$;

-- Remove a token (call on logout / when permission revoked).
CREATE OR REPLACE FUNCTION public.unregister_push_token(_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.push_tokens WHERE token = _token AND user_id = auth.uid();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated;
