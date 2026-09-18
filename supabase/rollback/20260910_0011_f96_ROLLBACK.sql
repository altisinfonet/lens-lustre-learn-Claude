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
--
-- ⚠ CORRECTION, 2026-09-17, found during a forensic re-verification pass
-- before dispatch, before this file was ever run: as originally written this
-- file dropped custom_url_ever_held(uuid) without reverting
-- change_custom_url(text), whose post-0011 body still calls
-- custom_url_ever_held(). The DROP would have succeeded — Postgres does not
-- track a hard dependency for a name referenced only inside another
-- function's plpgsql body text — but change_custom_url would then fail at
-- runtime on its very next invocation with "function
-- custom_url_ever_held(uuid) does not exist", against the live,
-- member-facing save path in src/pages/EditProfile.tsx. A repo-wide search
-- (static grep across every migration, and a live query of every function's
-- pg_get_functiondef on staging fpszggreishhuvdpkmdr) found exactly two
-- functions referencing custom_url_ever_held: forbid_custom_url_change()
-- (reverted below, safe) and change_custom_url() (was not reverted — fixed
-- by the block added below, restoring its exact pre-0011 body from
-- 20260910_0008_f93_custom_url_change_window.sql). claim_username(text) and
-- clear_custom_url() were independently confirmed, by source and by live
-- body, not to reference custom_url_ever_held at all — not implicated.
-- Nothing else in this file was changed. Never applied before this
-- correction — confirmed via live ACL read, staging still shows the
-- pre-revoke grant state described in the evidence report this correction
-- accompanies.

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

-- ⚠ ADDED IN THE 2026-09-17 CORRECTION ABOVE. Exact pre-0011 body, verbatim
-- from 20260910_0008_f93_custom_url_change_window.sql — not invented, not
-- simplified. Restored here, BEFORE the DROP below, so that when
-- custom_url_ever_held(uuid) is dropped no surviving function still calls
-- it.
CREATE OR REPLACE FUNCTION public.change_custom_url(_new_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _window  constant interval := interval '12 months';
  _user_id uuid;
  _cleaned text;
  _old_url text;
  _last    timestamptz;
  _mine    uuid;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _cleaned := lower(btrim(_new_url));

  SELECT custom_url, custom_url_changed_at INTO _old_url, _last
    FROM public.profiles WHERE id = _user_id;

  IF lower(coalesce(_old_url, '')) = _cleaned THEN
    RETURN jsonb_build_object('success', true, 'message', 'URL unchanged');
  END IF;

  -- The window applies only to a member who already has a URL. Someone being
  -- given their first one has spent nothing.
  IF _old_url IS NOT NULL AND _last IS NOT NULL AND now() - _last < _window THEN
    RAISE EXCEPTION 'You can change your profile URL once every 12 months. Your next change is available on %.',
      to_char((_last + _window) AT TIME ZONE 'utc', 'FMDD Mon YYYY');
  END IF;

  -- One predicate for format, reserved words, profiles and history.
  IF NOT public.custom_url_available(_cleaned, _user_id) THEN
    IF _cleaned !~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$' OR _cleaned ~ '\.\.' THEN
      RAISE EXCEPTION 'A profile URL must be 3-30 characters using lowercase letters, numbers, dots and underscores, and may not start or end with a dot.';
    ELSIF EXISTS (SELECT 1 FROM public.reserved_custom_urls WHERE value = _cleaned) THEN
      RAISE EXCEPTION 'That URL is reserved by the site and cannot be used.';
    ELSE
      RAISE EXCEPTION 'That URL is already taken.';
    END IF;
  END IF;

  -- Retire the member's current entry. released_at is stamped and the row is
  -- KEPT: it is what makes previously shared links keep resolving.
  UPDATE public.custom_url_history
     SET is_current = false, released_at = now()
   WHERE user_id = _user_id AND is_current = true;

  -- Reclaiming one of their OWN former URLs is fine — the links it serves point
  -- at this same member either way.
  SELECT id INTO _mine
    FROM public.custom_url_history
   WHERE user_id = _user_id AND lower(custom_url) = _cleaned
   ORDER BY created_at DESC LIMIT 1;

  IF _mine IS NOT NULL THEN
    UPDATE public.custom_url_history
       SET is_current = true, released_at = NULL
     WHERE id = _mine;
  ELSE
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
    'next_change_available', ((now() + _window) AT TIME ZONE 'utc')::date
  );
END;
$$;

COMMENT ON FUNCTION public.change_custom_url(text) IS
  'F-93. 12-month window. Never deletes another member''s history row (it previously did, silently redirecting every link shared for the former holder). Validates through custom_url_available() so its rules match the column and the reserved table rather than a hardcoded list.';

DROP FUNCTION IF EXISTS public.custom_url_ever_held(uuid);

-- ⚠ clear_custom_url's EXECUTE grant is NOT restored to authenticated, for the
-- same reason the anon grants are not. Re-granting it would give every member
-- a button that manufactures have_none — the state the Owner's hard rule
-- forbids — and after F-92/F-95 a member in that state has no reachable
-- profile URL at all. If it is genuinely wanted back, that is a decision with
-- its own evidence, not a side effect of rolling back a migration.
