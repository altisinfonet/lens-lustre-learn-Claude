-- ============================================================
-- USERNAME SYSTEM (custom_url as Instagram-style handle)
-- Requirements (owner, 2026-07-28):
--   1. Auto-generated at registration, editable ONCE during signup
--   2. Immutable for life once set (DB-enforced, not UI-enforced)
--   3. Freed for reuse when the profile is deleted
--   4. Public (already exposed via profiles_public_data view)
--   5. Instagram format: lowercase a-z, 0-9, dot, underscore;
--      3-30 chars; no leading/trailing dot; no consecutive dots
-- Pre-existing (verified in live schema before writing this):
--   * profiles.custom_url with UNIQUE INDEX on lower(custom_url)
--   * custom_url_history table (user_id ON DELETE CASCADE)
-- ============================================================

-- ---- 1. Instagram format, enforced by the database ----------
-- Existing values are grandfathered only if they already comply;
-- verified live before applying: dipannita / phani.anindya /
-- 50mmretinaworld -- all comply.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_custom_url_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_custom_url_format CHECK (
    custom_url IS NULL OR (
      custom_url ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$'
      AND custom_url !~ '\.\.'
    )
  );

-- ---- 2. Immutable for life --------------------------------
-- Once non-null, custom_url can never change or be cleared.
-- (DELETE of the whole row is unaffected -> deletion frees it.)
CREATE OR REPLACE FUNCTION public.forbid_custom_url_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.custom_url IS NOT NULL
     AND NEW.custom_url IS DISTINCT FROM OLD.custom_url THEN
    RAISE EXCEPTION 'custom_url is permanent and cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_custom_url_change ON public.profiles;
CREATE TRIGGER trg_forbid_custom_url_change
  BEFORE UPDATE OF custom_url ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_custom_url_change();

-- ---- 3. Availability check (anon-callable, for live signup UI) ----
CREATE OR REPLACE FUNCTION public.username_available(candidate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT candidate ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$'
     AND candidate !~ '\.\.'
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE lower(custom_url) = lower(candidate)
     );
$$;

GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;

-- ---- 4. Deterministic suggestion generator ----------------
-- Slugifies a display name into IG format; appends digits on collision.
CREATE OR REPLACE FUNCTION public.suggest_username(display_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base text;
  candidate text;
  n int := 0;
BEGIN
  -- lowercase, spaces->dot, strip everything not [a-z0-9._], squeeze dots
  base := lower(coalesce(display_name, ''));
  base := regexp_replace(base, '\s+', '.', 'g');
  base := regexp_replace(base, '[^a-z0-9._]', '', 'g');
  base := regexp_replace(base, '\.{2,}', '.', 'g');
  base := trim(both '._' from base);
  IF length(base) < 3 THEN
    base := 'user' || floor(random() * 9000 + 1000)::int::text;
  END IF;
  base := left(base, 24);  -- room for numeric suffix
  candidate := base;
  WHILE NOT public.username_available(candidate) AND n < 500 LOOP
    n := n + 1;
    candidate := base || n::text;
  END LOOP;
  RETURN candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_username(text) TO anon, authenticated;

-- ---- 5. Atomic claim ---------------------------------------
-- The ONLY sanctioned way to set a username. Race-safe: the
-- pre-existing unique index on lower(custom_url) is the referee;
-- a concurrent duplicate claim fails with unique_violation and is
-- reported as taken. Sets the value only when currently NULL, so
-- it doubles as one-shot enforcement.
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
