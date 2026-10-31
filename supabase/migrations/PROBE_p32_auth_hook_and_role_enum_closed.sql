-- ═══════════════════════════════════════════════════════════════════════════
-- P32 SESSION A GATE PROBE — password_verification_hook closed to public/
-- anon/authenticated (supabase_auth_admin retained); get_public_role_user_ids
-- closed to public/anon (authenticated retained). READS ONLY. Follows the
-- PROBE_p30_email_exists_closed.sql shape: BEGIN; DO $probe$ ... END $probe$;
-- ROLLBACK; — cannot write, even if a future edit introduces one by accident.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  hook_oid       oid;
  hook_count     integer;
  hook_acl       text;
  hook_secdef    boolean;
  hook_public    boolean; hook_anon boolean; hook_auth boolean; hook_authadmin boolean;
  role_oid       oid;
  role_count     integer;
  role_acl       text;
  role_secdef    boolean;
  role_volatility "char";
  role_public    boolean; role_anon boolean; role_auth boolean; role_svc boolean;
BEGIN
  RAISE NOTICE '--- P32 session-A gate probe @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %  (current_database)', current_database();

  ---------------------------------------------------------------------------
  -- password_verification_hook — exactly one, and its oid.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO hook_count FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname='password_verification_hook';
  IF hook_count = 0 THEN
    RAISE EXCEPTION 'HOOK-B5 FAILED — public.password_verification_hook does not exist. This unit closes a grant; it does not drop the function, and GoTrue''s Password Verification hook config depends on it existing.';
  END IF;
  IF hook_count > 1 THEN
    RAISE EXCEPTION 'HOOK-B5 FAILED — % functions named public.password_verification_hook exist. The gate is per-function; an extra overload is a silent reopening risk.', hook_count;
  END IF;

  SELECT p.oid, p.proacl::text, p.prosecdef INTO hook_oid, hook_acl, hook_secdef
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='password_verification_hook';
  RAISE NOTICE 'HOOK-B5 exactly one function ........ PASS (oid %, acl %)', hook_oid, COALESCE(hook_acl,'NULL');

  SELECT has_function_privilege('public', hook_oid, 'EXECUTE'),
         has_function_privilege('anon', hook_oid, 'EXECUTE'),
         has_function_privilege('authenticated', hook_oid, 'EXECUTE'),
         has_function_privilege('supabase_auth_admin', hook_oid, 'EXECUTE')
    INTO hook_public, hook_anon, hook_auth, hook_authadmin;

  IF hook_public OR hook_anon THEN
    RAISE EXCEPTION 'HOOK-B2 FAILED — public/anon can still EXECUTE password_verification_hook (oid %, public=%, anon=%). Any caller of the public API key can lock or unlock an arbitrary user_id''s sign-in. acl = %',
      hook_oid, hook_public, hook_anon, COALESCE(hook_acl,'NULL (built-in default = EXECUTE TO PUBLIC)');
  END IF;
  IF hook_auth THEN
    RAISE EXCEPTION 'HOOK-B2 FAILED — authenticated can still EXECUTE password_verification_hook (oid %). Any signed-in member can call this on ANY user_id, not just their own. acl = %',
      hook_oid, hook_acl;
  END IF;
  RAISE NOTICE 'HOOK-B2 public/anon/authenticated cannot execute (THE GATE) .. PASS';

  IF NOT hook_authadmin THEN
    RAISE EXCEPTION 'HOOK-B4 FAILED — supabase_auth_admin can no longer EXECUTE password_verification_hook (oid %). This is an over-revoke: GoTrue itself invokes this hook AS supabase_auth_admin, and sign-in would break entirely. acl = %',
      hook_oid, hook_acl;
  END IF;
  RAISE NOTICE 'HOOK-B4 no over-revoke ............... PASS (supabase_auth_admin=true, as intended)';

  IF NOT hook_secdef THEN
    RAISE EXCEPTION 'HOOK-B1 FAILED — oid % is no longer SECURITY DEFINER. This unit changes grants only.', hook_oid;
  END IF;
  RAISE NOTICE 'HOOK-B1 function unchanged in kind ... PASS (SECURITY DEFINER)';

  ---------------------------------------------------------------------------
  -- get_public_role_user_ids — exactly one, and its oid.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO role_count FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname='get_public_role_user_ids';
  IF role_count = 0 THEN
    RAISE EXCEPTION 'ROLE-B5 FAILED — public.get_public_role_user_ids does not exist.';
  END IF;
  IF role_count > 1 THEN
    RAISE EXCEPTION 'ROLE-B5 FAILED — % functions named public.get_public_role_user_ids exist. Gate is per-function.', role_count;
  END IF;

  SELECT p.oid, p.proacl::text, p.prosecdef, p.provolatile
    INTO role_oid, role_acl, role_secdef, role_volatility
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='get_public_role_user_ids';
  RAISE NOTICE 'ROLE-B5 exactly one function ......... PASS (oid %, acl %)', role_oid, COALESCE(role_acl,'NULL');

  SELECT has_function_privilege('public', role_oid, 'EXECUTE'),
         has_function_privilege('anon', role_oid, 'EXECUTE'),
         has_function_privilege('authenticated', role_oid, 'EXECUTE'),
         has_function_privilege('service_role', role_oid, 'EXECUTE')
    INTO role_public, role_anon, role_auth, role_svc;

  IF role_public THEN
    RAISE EXCEPTION 'ROLE-B3 FAILED — PUBLIC holds EXECUTE on get_public_role_user_ids (oid %). anon inherits through PUBLIC (F-62). acl = %', role_oid, role_acl;
  END IF;
  IF role_anon THEN
    RAISE EXCEPTION 'ROLE-B2 FAILED — anon can still EXECUTE get_public_role_user_ids (oid %). acl = %', role_oid, role_acl;
  END IF;
  RAISE NOTICE 'ROLE-B2/B3 public/anon cannot execute (THE GATE) .. PASS';

  IF NOT role_auth THEN
    RAISE EXCEPTION 'ROLE-B4 FAILED — authenticated can no longer EXECUTE get_public_role_user_ids (oid %). This is an over-revoke: real admin/judge callers are authenticated callers and would break. acl = %', role_oid, role_acl;
  END IF;
  IF NOT role_svc THEN
    RAISE EXCEPTION 'ROLE-B4 FAILED — service_role can no longer EXECUTE get_public_role_user_ids (oid %).', role_oid;
  END IF;
  RAISE NOTICE 'ROLE-B4 no over-revoke ................ PASS (authenticated=true, service_role=true)';

  IF NOT role_secdef THEN
    RAISE EXCEPTION 'ROLE-B1 FAILED — oid % is no longer SECURITY DEFINER.', role_oid;
  END IF;
  IF role_volatility <> 's' THEN
    RAISE EXCEPTION 'ROLE-B1 FAILED — oid % is no longer STABLE (provolatile=%). This unit changes grants only.', role_oid, role_volatility;
  END IF;
  RAISE NOTICE 'ROLE-B1 function unchanged in kind ... PASS (SECURITY DEFINER, STABLE)';

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for both functions in this unit. Nothing was written. ---';
END
$probe$;

ROLLBACK;
