-- ============================================================
-- FIX (2026-07-28): claim_username was blocked by the legacy
-- guard trigger block_custom_url_update (20260404185037), which
-- fires on ANY custom_url change — including NULL -> value —
-- unless the session GUC app.allow_custom_url_update is 'true'.
-- claim_username (20260728120000) never set the GUC, so every
-- authenticated claim raised:
--   "Direct custom_url update is not allowed. Use change_custom_url ..."
-- Same fix pattern the legacy change_custom_url / clear_custom_url
-- RPCs use: PERFORM set_config(..., true) (transaction-local).
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_username(candidate text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  updated int;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  candidate := lower(trim(candidate));
  IF NOT (candidate ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$')
     OR candidate ~ '\.\.' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_format');
  END IF;
  -- Legacy guard bypass (block_custom_url_update trigger)
  PERFORM set_config('app.allow_custom_url_update', 'true', true);
  BEGIN
    UPDATE public.profiles
       SET custom_url = candidate,
           custom_url_changed_at = now()
     WHERE id = uid AND custom_url IS NULL;
    GET DIAGNOSTICS updated = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END;
  IF updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_set_or_no_profile');
  END IF;
  INSERT INTO public.custom_url_history (user_id, custom_url, is_current)
  VALUES (uid, candidate, true)
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'username', candidate);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_username(text) TO authenticated;
