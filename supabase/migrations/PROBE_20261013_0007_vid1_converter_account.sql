-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 20261013_0007 — converter account provisioning. READ-ONLY.
-- Ends in ROLLBACK. Reads no password, hash or token (only WHETHER one is set).
--   A1 · exactly one row in video_converter_accounts, listed by 0007.
--   A2 · it is the Supabase Auth user video-converter@50mmretina.com, and that
--        user can sign in with a password: confirmed, a password is set, not
--        auth-banned, not deleted.
--   A3 · it holds NO user_roles row.
--   A4 · its profile is banned and hidden (is_banned, is_suspended, no end
--        date); is_banned() says so.
--   A5 · it cannot undo that: the guard_profile_moderation_columns trigger is
--        enabled on profiles, and tg_user_roles_no_converter (BEFORE INSERT OR
--        UPDATE, per row, DEFINER, search_path '', no API role may execute it)
--        is enabled on user_roles.
--   A6 · the restrictive "Banned users cannot …" INSERT policies are on posts
--        and post_comments.
--   A7 · it owns no video and no conversion source.
-- Before 20261013_0007 this probe FAILS (A1). After it: PASS.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits  text := '';
  _n    integer;
  _id   uuid;
  _note text;
  _seen timestamptz;
  _u    record;
  _f    oid := to_regprocedure('public.tg_user_roles_no_converter()');
BEGIN
  IF to_regclass('public.video_converter_accounts') IS NULL OR to_regprocedure('public.video_is_converter()') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-ACC: the converter queue is not on this lane — is 20261012_0002 applied?';
  END IF;

  -- A1
  SELECT count(*) INTO _n FROM public.video_converter_accounts;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL VID-ACC:%  A1 converter accounts % (must be exactly 1) — 20261013_0007 is not applied', E'\n', _n;
  END IF;
  SELECT user_id, note, last_seen_at INTO _id, _note, _seen FROM public.video_converter_accounts;
  IF _note NOT LIKE 'VID-1 converter account · 20261013_0007 · before: user_role=%' THEN
    hits := hits || E'\n  A1 the listed account was not listed by 20261013_0007';
  END IF;

  -- A2
  SELECT lower(email) AS email, email_confirmed_at IS NOT NULL AS confirmed, coalesce(encrypted_password, '') <> '' AS has_password,
         (banned_until IS NOT NULL AND banned_until > now()) AS auth_banned, deleted_at IS NOT NULL AS deleted
    INTO _u FROM auth.users WHERE id = _id;
  IF _u.email IS DISTINCT FROM 'video-converter@50mmretina.com' THEN
    hits := hits || E'\n  A2 the listed account is not video-converter@50mmretina.com';
  END IF;
  IF NOT _u.confirmed OR NOT _u.has_password OR _u.auth_banned OR _u.deleted THEN
    hits := hits || E'\n  A2 the account cannot sign in with a password (confirmed ' || _u.confirmed || ', has a password ' || _u.has_password
                 || ', auth-banned ' || _u.auth_banned || ', deleted ' || _u.deleted || ')';
  END IF;

  -- A3
  SELECT count(*) INTO _n FROM public.user_roles WHERE user_id = _id;
  IF _n > 0 THEN hits := hits || E'\n  A3 the converter account holds ' || _n || ' role row(s)'; END IF;

  -- A4
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _id AND is_banned AND is_suspended AND suspended_until IS NULL)
     OR NOT public.is_banned(_id) THEN
    hits := hits || E'\n  A4 the converter account''s profile is not banned + hidden (is_banned, is_suspended, no end date)';
  END IF;

  -- A5
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'D'
                    AND p.proname = 'guard_profile_moderation_columns' AND p.pronamespace = 'public'::regnamespace) THEN
    hits := hits || E'\n  A5 no enabled guard_profile_moderation_columns trigger on profiles — the account could lift its own ban';
  END IF;
  IF _f IS NULL OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_roles'::regclass AND tgname = 'tg_user_roles_no_converter'
                                  AND tgfoid = _f AND tgenabled <> 'D' AND tgtype = 23) THEN
    hits := hits || E'\n  A5 trigger tg_user_roles_no_converter (BEFORE INSERT OR UPDATE, per row) is missing or disabled on user_roles';
  ELSIF NOT (SELECT prosecdef AND coalesce(proconfig, '{}') @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = _f)
     OR has_function_privilege('anon', _f, 'EXECUTE') OR has_function_privilege('authenticated', _f, 'EXECUTE') THEN
    hits := hits || E'\n  A5 tg_user_roles_no_converter() is not DEFINER with search_path '''', or an API role may execute it';
  END IF;

  -- A6
  IF (SELECT count(DISTINCT c.relname) FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('posts', 'post_comments') AND c.relrowsecurity
         AND NOT pol.polpermissive AND pol.polcmd = 'a'
         AND position('is_banned' IN pg_get_expr(pol.polwithcheck, pol.polrelid)) > 0) <> 2 THEN
    hits := hits || E'\n  A6 the restrictive "Banned users cannot …" INSERT policies on posts / post_comments are missing';
  END IF;

  -- A7
  IF EXISTS (SELECT 1 FROM public.video_sources WHERE owner_id = _id) OR EXISTS (SELECT 1 FROM public.videos WHERE owner_id = _id) THEN
    hits := hits || E'\n  A7 the converter account owns a video or a conversion source';
  END IF;

  IF hits <> '' THEN RAISE EXCEPTION 'PROBE FAIL VID-ACC:%', hits; END IF;
  RAISE NOTICE 'PROBE PASS VID-ACC: converter accounts 1 (video-converter@50mmretina.com) — can sign in with a password, banned + hidden, no role and none can be given, owns nothing. Last seen by the queue: %.',
    coalesce(to_char(_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI"Z"'), 'never (the worker has not claimed yet)');
END
$probe$;
ROLLBACK;
