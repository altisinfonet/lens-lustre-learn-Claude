-- ============================================================================
-- A PROFILE PHOTO IS MANDATORY — AND A GOOGLE ACCOUNT PICTURE IS NOT ONE
-- 2026-08-01
--
-- WHAT WAS WRONG (measured on production, not assumed)
--
--   The "strict profile photo policy" lived entirely in one React useEffect in
--   src/components/Layout.tsx. Two holes:
--
--   1. Google sign-in writes the member's Google account picture into
--      profiles.avatar_url automatically, before they touch anything. The gate
--      checked only `avatar_url IS NULL`, so it never opened. Of 77 accounts,
--      31 had lh3.googleusercontent.com as their "profile photo" — never
--      chosen by the member, frequently Google's grey letter placeholder, and a
--      hotlink that can stop resolving. 36 had a real upload. 8 had nothing.
--
--   2. Nothing enforced the rule below the UI. No NOT NULL, no CHECK, no
--      policy, no trigger — verified across all 564 migrations. An older app
--      build, or a direct PostgREST call, was never asked for a photo at all.
--
-- WHAT THIS DOES
--
--   Refuses a post or a comment from an account whose avatar does not live on
--   OUR storage. It deletes nothing and locks nobody out: signing in, reading,
--   browsing, reacting and — crucially — uploading a photo all keep working.
--   The member simply cannot publish until they set a real photo.
--
-- WHY `AS RESTRICTIVE`
--
--   Multiple PERMISSIVE policies are combined with OR, so adding one could only
--   ever LOOSEN access. A RESTRICTIVE policy is ANDed with all the others, so
--   it can only tighten, and it leaves every existing policy untouched. This is
--   the same shape as the existing "Banned users cannot create posts" policy —
--   deliberately, so the table has one pattern rather than two.
--
-- ADMIN EXEMPTION — deliberate, and here is the reasoning
--
--   The client gate in Layout.tsx already exempts admins. Matching that here
--   keeps the two consistent, and it means a moderator can never be locked out
--   of moderating by a change to what counts as an avatar host. Remove the
--   `has_role(...)` clause from all three policies if the rule should bind
--   staff too.
-- ============================================================================

-- ── Does this account have a photo IT uploaded? ──────────────────────────────
-- ALLOWLIST, not a denylist. Naming the hosts we accept means the next OAuth
-- provider, Gravatar, or any other hotlink is refused by default. A "not
-- google" denylist would need extending forever, and forgetting once reopens
-- exactly the hole this migration closes.
--
-- ⚠ KEEP IN SYNC with isOwnProfilePhoto() in src/lib/profilePhoto.ts. The two
-- must apply the same patterns or the UI and the server will disagree.
CREATE OR REPLACE FUNCTION public.has_profile_photo(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT avatar_url LIKE 'https://cdn.50mmretina.com/%'
          OR avatar_url LIKE '%/storage/v1/object/public/avatars/%'
      FROM public.profiles
      WHERE id = _user_id
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.has_profile_photo(uuid) IS
  'True only when the account has an avatar on our own storage (a real upload). A Google/OAuth picture returns false — see the migration header.';

-- ── Posts ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Profile photo required to create posts" ON public.posts;
CREATE POLICY "Profile photo required to create posts"
ON public.posts
AS RESTRICTIVE
FOR INSERT
WITH CHECK (
  public.has_profile_photo((SELECT auth.uid()))
  OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
);

-- ── Comments on posts ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Profile photo required to comment on posts" ON public.post_comments;
CREATE POLICY "Profile photo required to comment on posts"
ON public.post_comments
AS RESTRICTIVE
FOR INSERT
WITH CHECK (
  public.has_profile_photo((SELECT auth.uid()))
  OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
);

-- ── Comments on journal articles and competition entries ────────────────────
-- Same class of public participation, same rule.
DROP POLICY IF EXISTS "Profile photo required to comment" ON public.comments;
CREATE POLICY "Profile photo required to comment"
ON public.comments
AS RESTRICTIVE
FOR INSERT
WITH CHECK (
  public.has_profile_photo((SELECT auth.uid()))
  OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
);
