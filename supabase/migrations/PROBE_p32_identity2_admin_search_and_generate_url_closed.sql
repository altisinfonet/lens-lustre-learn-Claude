-- ═══════════════════════════════════════════════════════════════════════════
-- P32 IDENTITY GROUP, PART 2 — GATE PROBE. admin_search_users,
-- admin_search_users_v2, admin_list_certificates,
-- admin_search_certificate_recipients closed to PUBLIC/anon, authenticated
-- RETAINED (each internally gated on has_role(auth.uid(),'admin')).
-- generate_custom_url closed to PUBLIC/anon/authenticated (zero application
-- callers). service_role retained on all five. READS ONLY. Ends in ROLLBACK.
--
-- Companion migration: 20260910_0027_p32identity2_admin_search_and_
-- generate_url_revoke.sql. See that file's header for why this does not
-- dispatch UNAPPLIED_20260824000000_admin_user_list_pagination.sql or
-- UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  rec         record;
  fn_oid      oid;
  fn_acl      text;
  fn_secdef   boolean;
  fn_volatile "char";
  fn_schema   text;
  fn_anon     boolean;
  fn_auth     boolean;
  fn_svc      boolean;
  fn_public   integer;
  checked     integer := 0;
BEGIN
  RAISE NOTICE '--- P32 identity-group-2 gate probe: admin search + generate_custom_url @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  -- sig · expect_auth · the exact signature each covers, and whether
  -- authenticated is expected TRUE (the four admin-gated search RPCs — real
  -- admins are authenticated callers, the has_role() check inside is the
  -- actual gate) or FALSE (generate_custom_url — zero application callers,
  -- so authenticated has no legitimate reason to hold it either).
  FOR rec IN
    SELECT * FROM (VALUES
      ('public.admin_search_users(text, text)', true),
      ('public.admin_search_users_v2(text, text, text, text, integer, integer)', true),
      ('public.admin_list_certificates(text, text, integer, integer)', true),
      ('public.admin_search_certificate_recipients(text, integer)', true),
      ('public.generate_custom_url(text, uuid)', false)
    ) AS t(sig, expect_auth)
  LOOP
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'C1 FAILED — % does not resolve to exactly one function.', rec.sig;
    END IF;

    SELECT p.proacl::text, p.prosecdef, p.provolatile, n.nspname
      INTO fn_acl, fn_secdef, fn_volatile, fn_schema
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.oid = fn_oid;

    checked := checked + 1;

    IF fn_schema <> 'public' THEN
      RAISE EXCEPTION 'C2 FAILED — % (oid %) lives in schema %, expected public.', rec.sig, fn_oid, fn_schema;
    END IF;

    SELECT has_function_privilege('anon', fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role', fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    IF fn_anon THEN
      RAISE EXCEPTION 'C3 FAILED — anon can still EXECUTE % (oid %). acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    SELECT count(*) INTO fn_public
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

    IF fn_acl IS NULL THEN
      RAISE EXCEPTION 'C4 FAILED — proacl is NULL on % (oid %) — the built-in default (EXECUTE TO PUBLIC), meaning this closure has silently reopened via a DROP+CREATE (F-66).', rec.sig, fn_oid;
    END IF;
    IF fn_public > 0 THEN
      RAISE EXCEPTION 'C4 FAILED — PUBLIC holds EXECUTE on % (oid %, % entry). acl = %', rec.sig, fn_oid, fn_public, fn_acl;
    END IF;

    IF fn_auth <> rec.expect_auth THEN
      RAISE EXCEPTION 'C5 FAILED — % (oid %) authenticated=% but expected %. acl = %',
        rec.sig, fn_oid, fn_auth, rec.expect_auth, fn_acl;
    END IF;

    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C6 FAILED — service_role can no longer EXECUTE % (oid %). acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer SECURITY DEFINER.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer VOLATILE (provolatile=%).', rec.sig, fn_oid, fn_volatile;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, anon=false, public_entries=0, authenticated=%, service_role=true, SECURITY DEFINER, VOLATILE, schema=public)',
      rpad(rec.sig, 78), fn_oid, fn_auth;
  END LOOP;

  IF checked <> 5 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 5 functions, checked %.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for all 5 functions. Nothing was written. ---';
  RAISE NOTICE '    Not superseded/dispatched by this unit: UNAPPLIED_20260824000000_admin_user_list_pagination.sql, UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql — each bundles index/constraint behaviour beyond this unit''s ACL-only scope. See companion migration header.';
END
$probe$;

ROLLBACK;
