-- F-93 · unit 3 of 5 — unlock the column, on a 12-month window.
--
-- WHAT WAS WRONG. forbid_custom_url_change() raised unconditionally whenever
-- OLD.custom_url IS NOT NULL, with no escape hatch of any kind:
--     RAISE EXCEPTION 'custom_url is permanent and cannot be changed'
-- Measured on staging inside a rolled-back block: NULL->value ALLOWED,
-- value->value REFUSED with SQLSTATE 23514. So a custom_url, once set, could
-- never be changed by anyone — member, admin or migration.
--
-- THAT MADE A SHIPPED FEATURE DEAD CODE. change_custom_url() sets
-- app.allow_custom_url_update, rewrites custom_url_history, and updates the
-- row — and this trigger killed the update every time. Its careful rename
-- logic has never once been reachable for any member holding a URL.
--
-- AND IT CONTRADICTED THE SCHEMA. profiles.custom_url_changed_at records WHEN
-- a URL changed; custom_url_history.released_at records when one was given up.
-- Both are dead machinery if a URL can never change. A schema that records a
-- change alongside a trigger forbidding it is a contradiction, and it was the
-- trigger that was wrong.
--
-- THE INTERVAL IS 12 MONTHS, by the Owner's own words ("limited mean Once a
-- year"). Note this OVERRIDES the 90 days that change_custom_url() has always
-- promised in its error text and its next_change_available return value. That
-- promise was never reachable, so no member has ever relied on it, but both
-- are aligned here so the RPC and the trigger cannot tell a member two
-- different dates.
--
-- ⚠ A BACKFILLED URL DOES NOT SPEND THE MEMBER'S CHANGE. NULL -> value is
-- always permitted and deliberately does NOT stamp custom_url_changed_at.
-- Somebody who never chose a URL must not discover they have already used
-- their one change on a name we picked for them.

CREATE OR REPLACE FUNCTION public.forbid_custom_url_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _window   constant interval := interval '12 months';
  _next     timestamptz;
  _jwt_role text;
BEGIN
  -- Assigning a URL to someone who has none is not a "change". It is always
  -- allowed, and it must not start the clock.
  IF OLD.custom_url IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.custom_url IS NOT DISTINCT FROM OLD.custom_url THEN
    RETURN NEW;
  END IF;

  -- Privileged path, not subject to the window: a member whose URL is abusive,
  -- defamatory or simply wrong should be helped today, not in a year.
  BEGIN
    _jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN others THEN
    _jwt_role := NULL;                        -- no JWT in scope (migration, cron, psql)
  END;

  IF _jwt_role = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin')
     OR coalesce(current_setting('app.custom_url_admin_override', true), '') = 'true'
  THEN
    RETURN NEW;
  END IF;

  IF OLD.custom_url_changed_at IS NOT NULL
     AND now() - OLD.custom_url_changed_at < _window
  THEN
    _next := OLD.custom_url_changed_at + _window;
    RAISE EXCEPTION
      'You can change your profile URL once every 12 months. Your next change is available on %.',
      to_char(_next AT TIME ZONE 'utc', 'FMDD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.forbid_custom_url_change() IS
  'F-93. Permits a custom_url change once every 12 months, keyed on profiles.custom_url_changed_at. NULL -> value is always allowed and does not start the clock. service_role, superusers and app.custom_url_admin_override bypass the window so an abusive URL can be corrected immediately. Replaced a version that refused every change unconditionally, which made change_custom_url() unreachable.';

-- ---------------------------------------------------------------------------
-- username_available(): stop disagreeing with the claim path.
--
-- It checked format and public.profiles ONLY — not the reserved namespace and
-- not custom_url_history. So the signup form could tell a member a name was
-- free when claiming it would be refused as reserved, or when it was a
-- released URL whose old links still point at its former holder. One predicate
-- now answers for every caller.
CREATE OR REPLACE FUNCTION public.username_available(candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.custom_url_available(lower(btrim(candidate)), auth.uid());
$$;

COMMENT ON FUNCTION public.username_available(text) IS
  'F-93. Delegates to custom_url_available() so the answer shown in the UI is the same rule the claim path enforces. Previously checked profiles only, and so reported reserved names and released URLs as available.';

-- ---------------------------------------------------------------------------
-- change_custom_url(): three defects, fixed together.
--
--  (1) IT DELETED OTHER MEMBERS' HISTORY ROWS.
--        IF _existing.user_id != _user_id THEN DELETE FROM custom_url_history ...
--      Claiming a URL released by someone else destroyed that person's history
--      row, so every link ever shared for them began resolving to the new
--      holder — silently. That is the exact failure this table exists to
--      prevent. Released URLs are now never reissued and never deleted.
--
--  (2) IT VALIDATED AGAINST RULES THE COLUMN REJECTS. It accepted 3-50
--      characters and the charset [a-z0-9._-]; the column allows 3-30 and has
--      no hyphen. 'jean-luc-picard-photography' passed the RPC and then died
--      on the CHECK constraint.
--
--  (3) IT CARRIED ITS OWN HARDCODED 45-WORD RESERVED LIST which disagreed with
--      App.tsx in both directions — it had api/www/root, and it was missing
--      home, notifications, scheduled-posts and every static path.
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
