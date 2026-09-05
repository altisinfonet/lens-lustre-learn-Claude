-- F-96 / F-96b — two functions writing one column under two different rule
-- sets. That shape IS the defect; one predicate and one window is the fix.
--
-- ═══ F-96b, THE SERIOUS ONE: A RELEASED NAME COULD BE STOLEN ═══
-- Proven on staging as a member, with a real rename rather than a fabricated
-- history row:
--     A's handle           : marlowe.ashgrove
--   1 A renames            : ALLOWED, marlowe.ashgrove is released
--   2 B clears their own   : ALLOWED, B is now NULL
--   3 B claims A's old name: {"ok": true, "username": "marlowe.ashgrove"}
--     resolve_custom_url('marlowe.ashgrove') -> MEMBER B
--
-- custom_url_history keeps a released name pointing at its former holder so
-- links already shared keep working. change_custom_url respects that, because
-- custom_url_available() excludes names sitting in ANOTHER member's history.
-- claim_username never called it — it checked the format regex and leaned on
-- the unique index on profiles.custom_url, which covers CURRENT values only.
-- So the door that change_custom_url locks, claim_username left open.
--
-- NOT LIVE TODAY, and that is luck rather than design: is_current=false rows
-- were 0 because nobody had renamed yet. Unit 3 switched renaming on. Dormant,
-- not absent.
--
-- ═══ F-96, THE WINDOW BYPASS ═══
--     1 change_custom_url : REFUSED, next change available 5 Sep 2027
--     2 clear_custom_url  : ALLOWED, custom_url is now NULL
--     3 change_custom_url : ALLOWED
-- Both the RPC and the trigger opened with a test on the CURRENT value —
-- "_old_url IS NOT NULL", "OLD.custom_url IS NULL" — so emptying the column
-- reset the regime. The intent was right (a member receiving their FIRST URL
-- has spent nothing) but it was keyed on HAS NONE RIGHT NOW instead of on HAS
-- NEVER HAD ONE, and clear_custom_url manufactures the former on demand.
-- custom_url_history already records every URL a member has ever held, so it
-- is the natural key and it is what these functions now use.

-- ---------------------------------------------------------------------------
-- Has this member ever held a URL? The single source for "inside the regime".
CREATE OR REPLACE FUNCTION public.custom_url_ever_held(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.custom_url_history WHERE user_id = _user_id);
$$;

COMMENT ON FUNCTION public.custom_url_ever_held(uuid) IS
  'F-96. Keys the 12-month window on history rather than on the current value, so emptying custom_url no longer resets the regime.';

-- ---------------------------------------------------------------------------
-- THE TRIGGER: same correction, applied to the defence-in-depth layer.
CREATE OR REPLACE FUNCTION public.forbid_custom_url_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _window   constant interval := interval '12 months';
  _next     timestamptz;
  _jwt_role text;
BEGIN
  IF NEW.custom_url IS NOT DISTINCT FROM OLD.custom_url THEN
    RETURN NEW;
  END IF;

  -- A member who has NEVER held a URL is receiving their first and has spent
  -- nothing. Note this is now "never held", not "holds none right now" — the
  -- latter is what clear_custom_url could manufacture on demand.
  IF OLD.custom_url IS NULL AND NOT public.custom_url_ever_held(OLD.id) THEN
    RETURN NEW;
  END IF;

  BEGIN
    _jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN others THEN
    _jwt_role := NULL;
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

-- ---------------------------------------------------------------------------
-- claim_username: ONE PREDICATE. This is the F-96b fix.
--
-- It previously checked the format regex and relied on the unique index, which
-- knows only about CURRENT values. custom_url_available() is what
-- change_custom_url already uses and it also excludes reserved names and names
-- held in another member's history. Two write paths, one rule set.
CREATE OR REPLACE FUNCTION public.claim_username(candidate text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid     uuid := auth.uid();
  updated int;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  candidate := lower(btrim(candidate));

  IF NOT (candidate ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$') OR candidate ~ '\.\.' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_format');
  END IF;

  -- ⚠ THE FIX. Distinguish the reasons so the member is told the truth rather
  -- than a generic "taken" — a reserved name and a name that belongs to
  -- somebody else's old links are different situations.
  IF NOT public.custom_url_available(candidate, uid) THEN
    IF EXISTS (SELECT 1 FROM public.reserved_custom_urls WHERE value = candidate) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'reserved');
    ELSIF EXISTS (SELECT 1 FROM public.custom_url_history h
                   WHERE lower(h.custom_url) = candidate AND h.user_id <> uid) THEN
      -- Held by another member NOW, or released by them and still resolving to
      -- them through custom_url_history. Never reissued: doing so would send
      -- every link they have ever shared to whoever claimed it next.
      RETURN jsonb_build_object('ok', false, 'reason', 'taken');
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'taken');
    END IF;
  END IF;

  -- Bounded to a member with no URL, as before — this is the onboarding claim,
  -- not a rename. With the window now keyed on history, a member who cleared
  -- their URL is still inside the regime and the trigger below refuses them.
  PERFORM set_config('app.allow_custom_url_update', 'true', true);
  BEGIN
    UPDATE public.profiles
       SET custom_url = candidate, custom_url_changed_at = now()
     WHERE id = uid AND custom_url IS NULL;
    GET DIAGNOSTICS updated = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'taken');
  END;

  IF updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_set_or_no_profile');
  END IF;

  INSERT INTO public.custom_url_history (user_id, custom_url, is_current)
  VALUES (uid, candidate, true) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'username', candidate);
END;
$$;

-- ---------------------------------------------------------------------------
-- change_custom_url: window keyed on history.
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
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  _cleaned := lower(btrim(_new_url));

  SELECT custom_url, custom_url_changed_at INTO _old_url, _last
    FROM public.profiles WHERE id = _user_id;

  IF lower(coalesce(_old_url,'')) = _cleaned THEN
    RETURN jsonb_build_object('success', true, 'message', 'URL unchanged');
  END IF;

  -- ⚠ custom_url_ever_held(), NOT "_old_url IS NOT NULL". That test was the
  -- bypass: clear_custom_url() made _old_url NULL and the whole window
  -- short-circuited.
  IF public.custom_url_ever_held(_user_id) AND _last IS NOT NULL
     AND now() - _last < _window THEN
    RAISE EXCEPTION 'You can change your profile URL once every 12 months. Your next change is available on %.',
      to_char((_last + _window) AT TIME ZONE 'utc', 'FMDD Mon YYYY');
  END IF;

  IF NOT public.custom_url_available(_cleaned, _user_id) THEN
    IF _cleaned !~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$' OR _cleaned ~ '\.\.' THEN
      RAISE EXCEPTION 'A profile URL must be 3-30 characters using lowercase letters, numbers, dots and underscores, and may not start or end with a dot.';
    ELSIF EXISTS (SELECT 1 FROM public.reserved_custom_urls WHERE value = _cleaned) THEN
      RAISE EXCEPTION 'That URL is reserved by the site and cannot be used.';
    ELSE
      RAISE EXCEPTION 'That URL is already taken.';
    END IF;
  END IF;

  UPDATE public.custom_url_history
     SET is_current = false, released_at = now()
   WHERE user_id = _user_id AND is_current = true;

  SELECT id INTO _mine FROM public.custom_url_history
   WHERE user_id = _user_id AND lower(custom_url) = _cleaned
   ORDER BY created_at DESC LIMIT 1;

  IF _mine IS NOT NULL THEN
    UPDATE public.custom_url_history SET is_current = true, released_at = NULL WHERE id = _mine;
  ELSE
    INSERT INTO public.custom_url_history (user_id, custom_url, is_current)
    VALUES (_user_id, _cleaned, true);
  END IF;

  PERFORM set_config('app.allow_custom_url_update', 'true', true);

  UPDATE public.profiles
     SET custom_url = _cleaned, custom_url_changed_at = now()
   WHERE id = _user_id;

  RETURN jsonb_build_object('success', true, 'custom_url', _cleaned,
    'next_change_available', ((now() + _window) AT TIME ZONE 'utc')::date);
END;
$$;

-- ---------------------------------------------------------------------------
-- ANON GRANTS. Hygiene, stated as hygiene: all three fail closed on
-- auth.uid() IS NULL, so this was not exploitable. A mutating profile RPC
-- should still not carry an EXECUTE grant for unauthenticated callers.
REVOKE EXECUTE ON FUNCTION public.change_custom_url(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_custom_url()      FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_username(text)    FROM anon;
