-- ═══════════════════════════════════════════════════════════════════════════
-- P30 GATE PROBE — email_exists(text) is closed to anon. READS ONLY.
--
-- The `PROBE_` prefix follows PROBE_credential_connectivity_readonly.sql and
-- PROBE_top_contributors_v3_cross_member.sql: not part of the ordered migration
-- sequence, dispatched through apply-migration.yml like any other reviewed
-- file, safe on either lane, any number of times. It ends in ROLLBACK.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE, AND WHY IT IS SHAPED PER-FUNCTION
--
-- docs/gates/P1-revocation-list.md §1, frozen (rev 2, blob 88c08093):
--
--   "A closure is proved per function, by
--    has_function_privilege('anon', <oid>, 'EXECUTE') = false, on the lane it
--    is claimed for. No gate on this list may be written against a *class*
--    (TRAP-BOTH, TRAP-PUBLIC-ONLY, ANON-NAMED-ONLY)."
--
-- The reason is measured, not stylistic: D1 measured the class split as 222/24
-- on production and 246/0 on staging — the same 246 functions, a different
-- split, because production has no pg_default_acl entry for supabase_admin in
-- public and staging does. A class-based gate proven on staging would not
-- describe production. So B2 below reads the privilege itself, on whatever lane
-- it runs, and B5 pins it to exactly one oid so the answer cannot come from a
-- different overload.
--
-- ⚠ A TEST THAT COULD NOT HAVE FAILED IS NOT EVIDENCE (C-34).
-- Every assertion here was shown FAILING before the revoke and passing after,
-- on a scratch PostgreSQL 16.13 fixture reproducing the measured ACL — the F-65
-- rule that grant controls are exercised on fixtures, not on a lane. The
-- transcript is docs/evidence/d1/P30/P30-fixture-transcript.txt and it includes
-- B2 failing, B2 passing, and B2 failing again after the rollback file runs.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the database catalogue. It does
-- NOT call /rest/v1/rpc/email_exists over HTTP as an anonymous browser would,
-- so it does not test PostgREST's own exposure rules. It does NOT prove the
-- password-reset and signup HTTP responses are byte-identical — that is clause
-- 2 of the P30 gate, it is a client measurement, and curl is not a browser
-- (F-53). This probe closes clause 1. Say what was proved, and no more.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  fn_oid        oid;
  fn_count      integer;
  anon_exec     boolean;
  auth_exec     boolean;
  svc_exec      boolean;
  public_entries integer;
  acl_text      text;
  is_secdef     boolean;
  volatility    "char";
BEGIN
  RAISE NOTICE '--- P30 gate probe: email_exists(text) @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %  (current_database)', current_database();

  ---------------------------------------------------------------------------
  -- B5 · EXACTLY ONE email_exists IN public, and its oid is captured.
  -- Run FIRST: every assertion below is per-oid, and "per function" is
  -- meaningless if two overloads exist and only one was revoked. A second
  -- overload created later is a silent reopening.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO fn_count
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'email_exists';

  IF fn_count = 0 THEN
    RAISE EXCEPTION
      'B5 FAILED — public.email_exists does not exist. P30 closes a grant; it does not drop the function, and the rollback needs it. Something other than this unit removed it.';
  END IF;
  IF fn_count > 1 THEN
    RAISE EXCEPTION
      'B5 FAILED — % functions named public.email_exists exist. The gate is per-function; with an overload present, a green reading on one oid says nothing about the other. Revoke every overload or drop the extra one.',
      fn_count;
  END IF;

  SELECT p.oid, p.proacl::text, p.prosecdef, p.provolatile
    INTO fn_oid, acl_text, is_secdef, volatility
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'email_exists';
  RAISE NOTICE 'B5 exactly one function ............ PASS (oid %, acl %)', fn_oid, COALESCE(acl_text, 'NULL');

  ---------------------------------------------------------------------------
  -- B2 · THE GATE ITSELF. Clause 1 of P30, in the frozen list's own words.
  -- This is the assertion shown failing before the revoke.
  ---------------------------------------------------------------------------
  SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
         has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
         has_function_privilege('service_role',  fn_oid, 'EXECUTE')
    INTO anon_exec, auth_exec, svc_exec;

  IF anon_exec THEN
    RAISE EXCEPTION
      'B2 FAILED — anon can still EXECUTE public.email_exists (oid %). The account-enumeration endpoint is open: any holder of the public API key can confirm whether an address has an account, one call per address. acl = %',
      fn_oid, COALESCE(acl_text, 'NULL (built-in default = EXECUTE TO PUBLIC)');
  END IF;
  RAISE NOTICE 'B2 anon cannot execute (THE GATE) .. PASS (has_function_privilege anon = false)';

  ---------------------------------------------------------------------------
  -- B3 · PUBLIC HOLDS NOTHING. Not redundant with B2: it is the F-62 / F-66
  -- trap. anon inherits EXECUTE through PUBLIC, so a PUBLIC grant would make
  -- B2 true anyway — but the two fail differently and the distinction tells the
  -- reader WHICH defect they have. A NULL proacl is the built-in default, which
  -- IS EXECUTE TO PUBLIC (measured on a fixture, F-66 transcript step 1) — it
  -- is not "no grants", and reading it as such is the trap.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO public_entries
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

  IF acl_text IS NULL THEN
    RAISE EXCEPTION
      'B3 FAILED — proacl is NULL on oid %. NULL is the BUILT-IN DEFAULT, which is EXECUTE TO PUBLIC, not "no grants". The function has been recreated (DROP+CREATE re-applies the default — F-66) and P30 has silently reopened. Re-apply 20260910_0001.',
      fn_oid;
  END IF;
  IF public_entries > 0 THEN
    RAISE EXCEPTION
      'B3 FAILED — PUBLIC holds EXECUTE on oid % (% entry). anon inherits through PUBLIC, so revoking from anon alone is a no-op here (F-62). The migration revokes FROM public first for exactly this reason; if this fires, the function was recreated after the apply. acl = %',
      fn_oid, public_entries, acl_text;
  END IF;
  RAISE NOTICE 'B3 PUBLIC holds no EXECUTE ......... PASS (0 PUBLIC entries, proacl not NULL)';

  ---------------------------------------------------------------------------
  -- B4 · NO OVER-REVOKE. The frozen list authorised "FROM public, anon" and
  -- nothing more. Stripping authenticated or service_role would exceed the
  -- Auditor's instruction and would make the rollback file — which re-grants
  -- anon only — no longer a faithful restore. An over-revoke is a defect too.
  ---------------------------------------------------------------------------
  IF NOT auth_exec THEN
    RAISE EXCEPTION
      'B4 FAILED — authenticated can no longer EXECUTE oid %. The frozen revocation list (§2.1) authorised revoking from public and anon ONLY. This is an over-revoke beyond the Auditor''s instruction, and the rollback file does not restore it. acl = %',
      fn_oid, acl_text;
  END IF;
  IF NOT svc_exec THEN
    RAISE EXCEPTION
      'B4 FAILED — service_role can no longer EXECUTE oid %. Server-side callers are not the attack class P30 addresses, and the frozen list did not authorise removing them. acl = %',
      fn_oid, acl_text;
  END IF;
  RAISE NOTICE 'B4 no over-revoke .................. PASS (authenticated=true, service_role=true, as the list left them)';

  ---------------------------------------------------------------------------
  -- B1 · THE FUNCTION IS UNCHANGED IN KIND. P30 is a grant change. If the body
  -- had been swapped for something else, or the DEFINER flag dropped, the
  -- privilege reading above would still be green while the object had become a
  -- different thing. Cheap to assert, and it pins what the unit promised not to
  -- touch.
  ---------------------------------------------------------------------------
  IF NOT is_secdef THEN
    RAISE EXCEPTION
      'B1 FAILED — oid % is no longer SECURITY DEFINER. P30 changes grants only; it does not alter the function. Something else edited it.',
      fn_oid;
  END IF;
  IF volatility <> 's' THEN
    RAISE EXCEPTION
      'B1 FAILED — oid % is no longer STABLE (provolatile=%). P30 changes grants only. A VOLATILE variant would also be the amplification class, not just the enumeration class.',
      fn_oid, volatility;
  END IF;
  RAISE NOTICE 'B1 function unchanged in kind ...... PASS (SECURITY DEFINER, STABLE)';

  RAISE NOTICE '--- ALL FIVE ASSERTIONS PASSED. Clause 1 of P30 holds on this lane. Nothing was written. ---';
  RAISE NOTICE '    Clause 2 (signup and reset responses byte-identical) is NOT tested here — client measurement, F-53.';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
