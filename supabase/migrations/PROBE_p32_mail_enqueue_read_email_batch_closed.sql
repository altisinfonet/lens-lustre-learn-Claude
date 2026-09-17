-- ═══════════════════════════════════════════════════════════════════════════
-- P32 MAIL GROUP — GATE PROBE for the two-function gap left open by PR #258
-- (which covers delete_email/emit_notification/move_to_dlq only). Closes:
--
--   enqueue_email(text, jsonb)
--   read_email_batch(text, integer, integer)
--
-- Companion migration: 20260814042609_email_queue_authority.sql (already
-- exists, already GREEN per 2026-09-17-P32-mail-group-FORENSICS-NO-GO.md —
-- NOT modified by this file). Companion rollback:
-- 20260814042609_email_queue_authority_ROLLBACK.sql (already exists, NOT
-- modified by this file). This PROBE is the only thing that was missing.
--
-- PUBLIC/anon/authenticated closed entirely (zero legitimate caller in any
-- of those roles — every real caller is service_role, per the forensics
-- doc's Step 3: three edge functions with SERVICE_ROLE_KEY, plus two
-- postgres-owned SECURITY DEFINER callers inside the database, which bypass
-- EXECUTE checks as the object owner regardless). service_role retained on
-- both. READS ONLY. Ends in ROLLBACK.
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
  fn_public   boolean;
  fn_anon     boolean;
  fn_auth     boolean;
  fn_svc      boolean;
  fn_public_n integer;
  checked     integer := 0;
BEGIN
  RAISE NOTICE '--- P32 mail-group gate probe: enqueue_email + read_email_batch @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  -- Both functions close identically: PUBLIC/anon/authenticated all false,
  -- service_role true. Unlike the identity-group probe, there is no
  -- expect_auth split here — neither function has a legitimate authenticated
  -- caller (both are queue-internal, service_role only).
  FOR rec IN
    SELECT * FROM (VALUES
      ('public.enqueue_email(text, jsonb)'),
      ('public.read_email_batch(text, integer, integer)')
    ) AS t(sig)
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

    SELECT has_function_privilege('public', fn_oid, 'EXECUTE'),
           has_function_privilege('anon', fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role', fn_oid, 'EXECUTE')
      INTO fn_public, fn_anon, fn_auth, fn_svc;

    -- C3: PUBLIC EXECUTE = false. has_function_privilege('public', ...) rolls
    -- up bare-PUBLIC inheritance; C4 below separately checks for a NAMED
    -- PUBLIC (grantee 0) ACL entry, which is the F-62-relevant failure mode.
    IF fn_public THEN
      RAISE EXCEPTION 'C3 FAILED — PUBLIC can still EXECUTE % (oid %). acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C4: anon EXECUTE = false.
    IF fn_anon THEN
      RAISE EXCEPTION 'C4 FAILED — anon can still EXECUTE % (oid %). acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C5: authenticated EXECUTE = false. Both functions are queue-internal;
    -- unlike the identity-group admin RPCs, there is no legitimate
    -- authenticated caller to retain.
    IF fn_auth THEN
      RAISE EXCEPTION 'C5 FAILED — authenticated can still EXECUTE % (oid %). acl = %',
        rec.sig, fn_oid, fn_acl;
    END IF;

    -- C6: service_role EXECUTE = true — the only role that should still
    -- reach these, matching the three SERVICE_ROLE_KEY edge callers.
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C6 FAILED — service_role can no longer EXECUTE % (oid %). acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    -- C7: acl is not NULL (built-in default reopened via DROP+CREATE, F-66)
    -- and PUBLIC (grantee 0) holds no explicit ACL entry either.
    IF fn_acl IS NULL THEN
      RAISE EXCEPTION 'C7 FAILED — proacl is NULL on % (oid %) — the built-in default (EXECUTE TO PUBLIC), meaning this closure has silently reopened via a DROP+CREATE (F-66).', rec.sig, fn_oid;
    END IF;
    SELECT count(*) INTO fn_public_n
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF fn_public_n > 0 THEN
      RAISE EXCEPTION 'C7 FAILED — PUBLIC holds a named EXECUTE ACL entry on % (oid %, % entry). acl = %', rec.sig, fn_oid, fn_public_n, fn_acl;
    END IF;

    -- C8: still SECURITY DEFINER / VOLATILE / correct signature — a
    -- DROP+CREATE that changed these would be a different, larger defect.
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C8 FAILED — % (oid %) is no longer SECURITY DEFINER.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C8 FAILED — % (oid %) is no longer VOLATILE (provolatile=%).', rec.sig, fn_oid, fn_volatile;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, PUBLIC=false, anon=false, authenticated=false, service_role=true, SECURITY DEFINER, VOLATILE, schema=public)',
      rpad(rec.sig, 62), fn_oid;
  END LOOP;

  IF checked <> 2 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 2 functions, checked %.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for both functions. Nothing was written. ---';
  RAISE NOTICE '    Companion migration/rollback (20260814042609_email_queue_authority.sql / _ROLLBACK.sql) were not modified by this PROBE.';
END
$probe$;

ROLLBACK;
