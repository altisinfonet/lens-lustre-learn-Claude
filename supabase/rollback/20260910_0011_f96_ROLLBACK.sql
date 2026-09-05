-- F-96 / F-96b ROLLBACK.
--
-- ⚠ THIS RESTORES A KNOWN DEFECT. Running it re-opens both holes:
--   * the 12-month window becomes bypassable in two calls
--     (clear_custom_url then change_custom_url), because the guards go back to
--     testing the CURRENT value instead of history;
--   * claim_username stops consulting custom_url_available(), so a name
--     released by one member can be claimed by another and every link ever
--     shared to that address starts resolving to the wrong person.
--
-- Roll back only to unblock something worse, and re-apply immediately.
-- The anon revokes are NOT restored: re-granting EXECUTE on a mutating
-- profile RPC to unauthenticated callers is not something a rollback should
-- do silently. Restore them by hand if they are genuinely wanted.

CREATE OR REPLACE FUNCTION public.forbid_custom_url_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _window   constant interval := interval '12 months';
  _next     timestamptz;
  _jwt_role text;
BEGIN
  IF OLD.custom_url IS NULL THEN RETURN NEW; END IF;
  IF NEW.custom_url IS NOT DISTINCT FROM OLD.custom_url THEN RETURN NEW; END IF;
  BEGIN
    _jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN others THEN _jwt_role := NULL; END;
  IF _jwt_role = 'service_role'
     OR session_user IN ('postgres','supabase_admin')
     OR coalesce(current_setting('app.custom_url_admin_override', true),'') = 'true'
  THEN RETURN NEW; END IF;
  IF OLD.custom_url_changed_at IS NOT NULL
     AND now() - OLD.custom_url_changed_at < _window THEN
    _next := OLD.custom_url_changed_at + _window;
    RAISE EXCEPTION 'You can change your profile URL once every 12 months. Your next change is available on %.',
      to_char(_next AT TIME ZONE 'utc','FMDD Mon YYYY') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.custom_url_ever_held(uuid);
