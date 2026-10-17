-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261013_0007 — converter account provisioning (D1, T1).
-- CONVERTER-DESIGN.md v2 §4 [R9]: "a separate provisioning migration lists the
-- user once it exists, and marks its profile banned and hidden".
--
-- NOT IN THIS FILE, AND NEVER IN SQL: the account itself and its password.
--   The account is a Supabase Auth user. The Owner creates it (Supabase →
--   Authentication → Users → Add user, "Auto Confirm User" on) with the e-mail
--   below and a password only he holds; the same two values go into
--   /var/lib/converter/secrets/credentials.json on the VM. This file reads the
--   user by its e-mail (not a secret) and refuses when it does not exist. It
--   never reads, writes or prints a password, a hash or a token.
--
-- WHAT IT DOES (data + one guard):
--   1. public.video_converter_accounts gets the one row for that user — from
--      then on public.video_is_converter() is true for it, so the converter
--      RPCs of 20261012_0002 accept it and nobody else.
--   2. its profile is banned (is_banned) and hidden (is_suspended, no end
--      date): the existing "Banned users cannot …" policies refuse its posts,
--      comments and reactions; feeds, search and suggestions leave it out; the
--      existing guard_profile_moderation_columns trigger stops it lifting
--      either flag itself; video_owner_may() refuses it as an uploader.
--   3. it holds NO user_roles row (the 'user' row the sign-up trigger gave it
--      is removed), and trigger tg_user_roles_no_converter keeps it so: no role
--      can be given to a converter account by anyone (user_roles lets a member
--      self-assign 'registered_photographer').
--
-- REFUSES (changes nothing) when: the Auth user does not exist, is unconfirmed,
-- has no password, is auth-banned or deleted; it holds any role other than
-- 'user' (never strip a real member or an admin); it was already moderated, or
-- owns a video; another converter account is listed; the ban policies or the
-- profile guard this stands on are missing.
-- IDEMPOTENT: a second run changes nothing.
--
-- ROLLBACK: supabase/rollback/20261013_0007_vid1_converter_account_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261013_0007_vid1_converter_account.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

-- ── PRE: what this stands on ────────────────────────────────────────────────
DO $pre$
BEGIN
  IF to_regclass('public.video_converter_accounts') IS NULL OR to_regprocedure('public.video_is_converter()') IS NULL THEN
    RAISE EXCEPTION 'VID-ACC-PRE-001: the converter queue is not on this lane — apply 20261012_0002 first';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.user_roles') IS NULL
     OR to_regprocedure('public.is_banned(uuid)') IS NULL THEN
    RAISE EXCEPTION 'VID-ACC-PRE-002: profiles / user_roles / is_banned missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'D'
                    AND p.proname = 'guard_profile_moderation_columns' AND p.pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'VID-ACC-PRE-003: no enabled guard_profile_moderation_columns trigger on profiles — the account could lift its own ban';
  END IF;
  IF (SELECT count(DISTINCT c.relname) FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('posts', 'post_comments') AND c.relrowsecurity
         AND NOT pol.polpermissive AND pol.polcmd = 'a'
         AND position('is_banned' IN pg_get_expr(pol.polwithcheck, pol.polrelid)) > 0) <> 2 THEN
    RAISE EXCEPTION 'VID-ACC-PRE-004: the restrictive "Banned users cannot …" INSERT policies on posts / post_comments are missing';
  END IF;
END
$pre$;

-- ── 1. no role for a converter account, ever ────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_user_roles_no_converter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.video_converter_accounts WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'VID-ACC-001: the video converter account holds no role' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_user_roles_no_converter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_user_roles_no_converter ON public.user_roles;
CREATE TRIGGER tg_user_roles_no_converter BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_roles_no_converter();

-- ── 2. the account ──────────────────────────────────────────────────────────
DO $account$
DECLARE
  _email    constant text := 'video-converter@50mmretina.com';   -- not a secret; the password is never here
  _n        integer;
  _u        record;
  _p        record;
  _had_user boolean;
BEGIN
  SELECT count(*) INTO _n FROM auth.users WHERE lower(email) = _email;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'VID-ACC-PRE-010: % Supabase Auth user(s) with the e-mail % — the Owner creates exactly one first (Authentication → Users → Add user, Auto Confirm on). SQL never creates it.', _n, _email;
  END IF;
  SELECT id, email_confirmed_at IS NOT NULL AS confirmed, coalesce(encrypted_password, '') <> '' AS has_password,
         (banned_until IS NOT NULL AND banned_until > now()) AS auth_banned, deleted_at IS NOT NULL AS deleted
    INTO _u FROM auth.users WHERE lower(email) = _email;
  IF NOT _u.confirmed OR NOT _u.has_password OR _u.auth_banned OR _u.deleted THEN
    RAISE EXCEPTION 'VID-ACC-PRE-011: the Auth user cannot sign in with a password (confirmed %, has a password %, auth-banned %, deleted %) — fix it in Authentication → Users',
      _u.confirmed, _u.has_password, _u.auth_banned, _u.deleted;
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_converter_accounts WHERE user_id <> _u.id) THEN
    RAISE EXCEPTION 'VID-ACC-PRE-012: another converter account is already listed — one at most';
  END IF;

  IF EXISTS (SELECT 1 FROM public.video_converter_accounts WHERE user_id = _u.id) THEN
    -- already provisioned: hold the state, change nothing else
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _u.id)
       OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _u.id AND is_banned AND is_suspended AND suspended_until IS NULL) THEN
      RAISE EXCEPTION 'VID-ACC-PRE-013: the account is listed but no longer banned + hidden + role-less — read it before touching it';
    END IF;
    RAISE NOTICE 'VID-ACC: already provisioned — nothing changed';
    RETURN;
  END IF;

  SELECT is_banned, is_suspended, suspended_until INTO _p FROM public.profiles WHERE id = _u.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VID-ACC-PRE-014: the Auth user has no profile row — the sign-up trigger did not run on this lane';
  END IF;
  IF _p.is_banned OR _p.is_suspended OR _p.suspended_until IS NOT NULL THEN
    RAISE EXCEPTION 'VID-ACC-PRE-015: the profile is already moderated — this is not a fresh account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _u.id AND role::text <> 'user') THEN
    RAISE EXCEPTION 'VID-ACC-PRE-016: the account holds a role other than ''user'' — this is a real member or an admin, not the converter';
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_sources WHERE owner_id = _u.id) OR EXISTS (SELECT 1 FROM public.videos WHERE owner_id = _u.id) THEN
    RAISE EXCEPTION 'VID-ACC-PRE-017: the account owns a video — this is not a fresh account';
  END IF;

  _had_user := EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _u.id);
  DELETE FROM public.user_roles WHERE user_id = _u.id;
  UPDATE public.profiles SET is_banned = true, is_suspended = true WHERE id = _u.id;
  INSERT INTO public.video_converter_accounts (user_id, note)
  VALUES (_u.id, 'VID-1 converter account · 20261013_0007 · before: user_role=' || CASE WHEN _had_user THEN 'yes' ELSE 'no' END);
  RAISE NOTICE 'VID-ACC: provisioned — listed as the converter, profile banned + hidden, % role row(s) removed', CASE WHEN _had_user THEN 1 ELSE 0 END;
END
$account$;

-- ── POST ────────────────────────────────────────────────────────────────────
DO $post$
DECLARE _id uuid;
BEGIN
  IF (SELECT count(*) FROM public.video_converter_accounts) <> 1 THEN
    RAISE EXCEPTION 'VID-ACC-POST-001: not exactly one converter account';
  END IF;
  SELECT user_id INTO _id FROM public.video_converter_accounts;
  IF NOT public.is_banned(_id) OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _id AND is_suspended AND suspended_until IS NULL) THEN
    RAISE EXCEPTION 'VID-ACC-POST-002: the converter account is not banned + hidden + role-less';
  END IF;
  IF has_function_privilege('anon', 'public.tg_user_roles_no_converter()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_user_roles_no_converter()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VID-ACC-POST-003: tg_user_roles_no_converter() is executable by an API role';
  END IF;
END
$post$;

COMMIT;
