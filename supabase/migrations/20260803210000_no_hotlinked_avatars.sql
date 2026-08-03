-- ============================================================================
-- STOP STORING GOOGLE-HOSTED PROFILE PHOTOS.                      (2026-08-03)
--
-- WHAT BROKE, measured on production
--   Loading the signed-in feed, every avatar served from our own CDN returned
--   200 — and every avatar served from lh3.googleusercontent.com returned
--   **HTTP 503**. Google is refusing to serve hotlinked account pictures.
--   27 of 81 members still carry such a URL in profiles.avatar_url, so their
--   faces are broken circles on every surface: feed, comments, suggestions,
--   and for a brand-new member the moment they join. Owner report:
--   "login time image not loading, joining time image not loading."
--
-- WHY THE DATA KEPT COMING BACK
--   Two triggers write it:
--     - handle_new_user       copies the OAuth picture at signup
--     - sync_oauth_on_login   RE-writes it on any later login while
--                             profiles.avatar_url IS NULL
--   So blanking the 27 rows without changing both triggers would regress on
--   each member's next sign-in.
--
-- THE POLICY THIS ALIGNS WITH (already enforced, see profilePhoto.ts and
-- 20260801160000_require_own_profile_photo.sql)
--   A profile photo counts ONLY if it lives on our own storage. The OAuth
--   picture never counted; the onboarding gate already forces these members
--   to upload a real one on their next visit. This migration only stops us
--   STORING and therefore RENDERING a URL that (a) never satisfied the
--   policy and (b) Google now refuses to serve.
--
-- WHAT CHANGES
--   1. handle_new_user:      never copies the OAuth picture. Name copy kept.
--   2. sync_oauth_on_login:  never copies the OAuth picture. Name copy kept.
--   3. Backfill:             the 27 hotlinked avatar_url values -> NULL.
--                            Every avatar component falls back to the branded
--                            initial/placeholder, which is what most of these
--                            members effectively see already (Google serves a
--                            grey letter tile even when it responds).
--
-- WHAT THIS DOES NOT DO
--   No account is touched beyond avatar_url. No uploaded photo (our CDN or
--   legacy /avatars/ storage) is affected — the WHERE matches only
--   googleusercontent hotlinks.
--
-- ROLLBACK
--   Re-run the function bodies from 20260325112938. The blanked URLs are
--   recoverable per-member from auth.users.raw_user_meta_data if ever needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _oauth_name text;
  _is_first_admin boolean;
BEGIN
  _oauth_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NULL
  );

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO _is_first_admin;

  -- avatar_url deliberately NULL: the OAuth picture is a third-party hotlink
  -- that never counted under the own-storage policy and now 503s from Google.
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    CASE WHEN _is_first_admin THEN '50mm Retina World' ELSE _oauth_name END,
    NULL
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_oauth_on_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _oauth_name text;
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

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role = 'admin'
  ) INTO _is_admin;

  -- Avatar sync removed on purpose: it was the path that kept restoring
  -- hotlinked pictures after they were blanked. Names still sync.
  IF _is_admin THEN
    UPDATE public.profiles
    SET full_name = '50mm Retina World',
        updated_at = now()
    WHERE id = NEW.id
      AND full_name IS DISTINCT FROM '50mm Retina World';
  ELSE
    IF _oauth_name IS NOT NULL THEN
      UPDATE public.profiles
      SET full_name = COALESCE(full_name, _oauth_name),
          updated_at = now()
      WHERE id = NEW.id
        AND full_name IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: only googleusercontent hotlinks. Uploaded photos (our CDN or the
-- legacy /avatars/ storage path) do not match and are untouched.
UPDATE public.profiles
   SET avatar_url = NULL,
       updated_at = now()
 WHERE avatar_url ILIKE '%googleusercontent.com%';
