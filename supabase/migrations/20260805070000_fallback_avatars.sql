-- ============================================================================
-- FALLBACK AVATARS — a friendly face for members with no profile photo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- OWNER REQUEST, 2026-08-05:
--
--   "Create AI DP small icons type 10 options 5 male 5 female (cartoon type).
--    Once you can do, based on man and woman, if DP fails allow then to choose
--    anyone user can change too. This DP update wont as updated profile picture
--    on the feed and wall anyone, its just for fall back or as user is not
--    giving DP, using that only."
--   "after doing that, update AI images random from your 10 options based on
--    the gender Female or Male"
--   "put gender on the 1st form just to select"
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE DESIGN DECISION THAT MAKES THIS SAFE
--
-- The chosen cartoon is written straight into `profiles.avatar_url` as a
-- SITE-RELATIVE path: `/avatars/fallback/m3.svg`.
--
-- That single choice gives us everything the owner asked for, with no new
-- rendering code anywhere:
--
--   * `isOwnProfilePhoto()` (src/lib/profilePhoto.ts) is an ALLOWLIST of our
--     own storage — `cdn.50mmretina.com/` and the Supabase avatars bucket. A
--     site-relative path matches neither, so it is **not** a real profile
--     photo. Same for `public.has_profile_photo()`, which applies the same two
--     patterns.
--   * So the photo prompt keeps asking, and when the owner reinstates the rule
--     at ~1000 members it still means "a photo you actually uploaded" — exactly
--     his "this DP won't [count] as updated profile picture".
--   * And every surface that already renders `avatar_url` — feed, wall,
--     comments, sidebar, friend rail, notifications — shows the cartoon with
--     ZERO changes. Nothing had to learn about a second column.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- GENDER: WHERE THE CLASSIFICATION CAME FROM
--
-- Measured first: only 8 of 83 members had ANY gender signal (`pronouns`), so
-- 90% were unknown. Guessing gender from a name — on a largely Bengali member
-- list — gets a meaningful share wrong, and a member shown the wrong avatar is
-- a complaint the owner would hear about. So he was asked, and he classified
-- the 32 himself:
--
--   FEMALE (3): Debanjana · Geetilekha · Kakali Poddar
--   MALE (29):  everyone else on that list
--
-- That answer is encoded below by name, once, and then stored in a real
-- `gender` column so it never has to be guessed again.
--
-- ASSIGNMENT IS DETERMINISTIC, NOT RANDOM-PER-RUN. `hashtext(id)` means the
-- same member always lands on the same face: re-running this migration cannot
-- shuffle everyone's avatar, and a member who has quietly grown attached to m3
-- keeps m3. It is still an even spread across the five options.
--
-- NOTHING WITH A REAL PHOTO IS TOUCHED — the WHERE clause is guarded by
-- `NOT has_profile_photo(id)`.
-- ============================================================================

-- ── 1. A place to keep gender, so it is asked once and never guessed ────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_gender_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.gender IS
  'male | female | NULL. Collected by the onboarding form purely to pick a fitting fallback avatar. Never used for permissions or visibility.';

-- ── 2. Record the owner's classification of the 32 without a photo ─────────
UPDATE public.profiles
   SET gender = 'female'
 WHERE gender IS NULL
   AND btrim(full_name) IN ('Debanjana', 'Geetilekha', 'Kakali Poddar');

UPDATE public.profiles p
   SET gender = 'male'
 WHERE p.gender IS NULL
   AND p.is_suspended = false
   AND NOT public.has_profile_photo(p.id)
   AND btrim(p.full_name) NOT IN ('Debanjana', 'Geetilekha', 'Kakali Poddar');

-- ── 3. Give everyone without a real photo a fitting cartoon ────────────────
--
-- `hashtext` can return negative values; `abs()` before the modulo, and the
-- result is 1..5 to match the filenames m1..m5 / f1..f5.
UPDATE public.profiles p
   SET avatar_url = '/avatars/fallback/'
                    || CASE WHEN p.gender = 'female' THEN 'f' ELSE 'm' END
                    || ((abs(hashtext(p.id::text)) % 5) + 1)::text
                    || '.svg'
 WHERE p.is_suspended = false
   AND NOT public.has_profile_photo(p.id)
   AND (p.avatar_url IS NULL OR p.avatar_url NOT LIKE '/avatars/fallback/%');

COMMENT ON TABLE public.profiles IS
  'Member profiles. NOTE: avatar_url may hold a site-relative /avatars/fallback/*.svg cartoon — that is a FALLBACK, not an uploaded photo, and has_profile_photo() correctly returns false for it.';
