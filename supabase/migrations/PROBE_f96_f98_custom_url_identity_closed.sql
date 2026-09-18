-- ═══════════════════════════════════════════════════════════════════════════
-- F-96 / F-97 / F-98 GATE PROBE — claim_username, change_custom_url and
-- clear_custom_url closed to PUBLIC and anon, authenticated matching each
-- function's intended design, service_role untouched. READS ONLY. Ends in
-- ROLLBACK.
--
-- ⚠ THIS PROBE DID NOT EXIST WHEN 0011/0012 WERE WRITTEN — that gap was
-- found during a forensic re-verification pass on 2026-09-17, before either
-- migration was ever dispatched. Every other named P30-P33 unit in this
-- project ships its own PROBE_*.sql in the same PR as its forward migration
-- (PROBE_p30_email_exists_closed.sql, PROBE_p31_search_certificates_closed.sql,
-- PROBE_p32_money_account_control_closed.sql, and others). 0011/0012 did not,
-- and this file closes that gap without touching either forward migration.
--
-- ⚠ THE THREE FUNCTIONS DO NOT SHARE ONE INTENDED authenticated STATE.
-- claim_username and change_custom_url stay member-callable (0011 revokes
-- only PUBLIC/anon from them, per its own text). clear_custom_url is
-- revoked from authenticated as well as PUBLIC/anon (0011: "clear_custom_url
-- STOPS BEING MEMBER-CALLABLE... DO NOT RE-GRANT THIS TO authenticated") —
-- it survives only as a privileged action. A probe that used one expected
-- value for all three would silently pass an over-revoke on the first two or
-- an under-revoke on the third. The intended-authenticated column below is
-- per function for exactly this reason, and C4 fails loudly either direction.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE'S OWN RULE — docs/gates/P1-revocation-list.md §1, frozen:
--
--   "A closure is proved per function, by
--    has_function_privilege('anon', <oid>, 'EXECUTE') = false, on the lane it
--    is claimed for. No gate on this list may be written against a *class*."
--
-- ⚠ F-62 GENUINELY BITES HERE, ON ALL THREE. Measured on staging
-- (fpszggreishhuvdpkmdr, 2026-09-17, this session, read-only): PUBLIC holds
-- EXECUTE on all three today (the leading `=X/postgres` in proacl,
-- aclexplode grantee=0 count = 1 on every one) — the pre-revoke state, since
-- neither 0011 nor 0012 has been dispatched on this lane since the
-- 2026-09-11 full-schema bootstrap reset every function's ACL to the
-- Postgres default (F-66; that bootstrap's own header confirms it carries
-- zero GRANT/REVOKE statements). So today this probe is EXPECTED TO FAIL at
-- C2/C3 for all three functions — that is what "not yet applied" looks like,
-- and it is the correct, honest state for this file to report before 0011
-- and 0012 are dispatched. It is committed now, unrun and failing by design
-- against the current live state, so that dispatching 0011/0012 has a gate
-- ready to prove the result rather than a gate written afterward to match
-- whatever happened (C-34: a test written after the fact, that could not
-- have been shown failing first, is not evidence).
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the catalogue only. It does not
-- call claim_username, change_custom_url or clear_custom_url — all three are
-- VOLATILE and mutate profiles/custom_url_history, so exercising them here
-- would write data inside what is supposed to be a read-only gate; that is
-- not this file's job. It does not exercise /rest/v1/rpc over HTTP as a real
-- browser would (F-53), and it does not re-verify EditProfile.tsx's client
-- behaviour — that is D2's half, already evidenced separately by
-- src/lib/__tests__/customUrlCannotBeRemoved.test.ts (a source-level test,
-- not a substitute for this database-level probe, and not duplicated here).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  rec          record;
  fn_oid       oid;
  fn_acl       text;
  fn_secdef    boolean;
  fn_volatile  "char";
  fn_anon      boolean;
  fn_auth      boolean;
  fn_svc       boolean;
  fn_public    integer;
  checked      integer := 0;
BEGIN
  RAISE NOTICE '--- F-96/F-97/F-98 gate probe: custom-url identity functions @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  -- sig · the exact signature this migration pair targets.
  -- expect_auth · this function's OWN intended authenticated state — not a
  -- shared constant. true for claim_username and change_custom_url (member-
  -- callable, per 0011's own REVOKE list, which touches only PUBLIC/anon for
  -- these two). false for clear_custom_url (0011 additionally revokes it
  -- from authenticated and 0011's own comment forbids ever re-granting it).
  FOR rec IN
    SELECT * FROM (VALUES
      ('public.claim_username(text)',      true),
      ('public.change_custom_url(text)',   true),
      ('public.clear_custom_url()',        false)
    ) AS t(sig, expect_auth)
  LOOP
    -- C1 · the exact signature this migration pair targets still resolves to
    -- exactly one function. to_regprocedure returns NULL rather than erroring
    -- on no-match/ambiguous-match, so both cases are caught here rather than
    -- as an opaque cast failure.
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'C1 FAILED — % does not resolve to exactly one function. F-96/F-97/F-98 close a grant; they do not drop the function, and the signature must match what 0011/0012 target exactly.', rec.sig;
    END IF;

    SELECT p.proacl::text, p.prosecdef, p.provolatile
      INTO fn_acl, fn_secdef, fn_volatile
      FROM pg_proc p WHERE p.oid = fn_oid;

    checked := checked + 1;

    -- C2 · THE GATE. anon must not be able to execute any of the three.
    SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role',  fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    IF fn_anon THEN
      RAISE EXCEPTION
        'C2 FAILED — anon can still EXECUTE % (oid %). A mutating profile-identity RPC is open to any holder of the public anon key. acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C3 · THE F-62 TRAP. PUBLIC held EXECUTE on all three, measured
    -- 2026-09-17 (this session, read-only, before either migration ran).
    SELECT count(*) INTO fn_public
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

    IF fn_acl IS NULL THEN
      RAISE EXCEPTION
        'C3 FAILED — proacl is NULL on % (oid %). NULL is the BUILT-IN DEFAULT, which IS EXECUTE TO PUBLIC, not "no grants". The function has been recreated (DROP+CREATE re-applies the default — F-66) and this closure has silently reopened.',
        rec.sig, fn_oid;
    END IF;
    IF fn_public > 0 THEN
      RAISE EXCEPTION
        'C3 FAILED — PUBLIC holds EXECUTE on % (oid %, % entry). anon inherits through PUBLIC, so revoking from anon alone would have closed NOTHING here (F-62). acl = %',
        rec.sig, fn_oid, fn_public, fn_acl;
    END IF;

    -- C4 · authenticated MATCHES THIS FUNCTION'S OWN INTENDED STATE, not a
    -- shared constant. Fails loudly on an over-revoke (claim_username or
    -- change_custom_url losing authenticated — that would break the real
    -- EditProfile.tsx / OnboardingModal.tsx save paths) AND on an
    -- under-revoke (clear_custom_url regaining authenticated — that
    -- reopens the exact member-facing "clear my URL" button 0011 removed).
    IF fn_auth <> rec.expect_auth THEN
      RAISE EXCEPTION
        'C4 FAILED — % (oid %): authenticated EXECUTE = %, expected %. % acl = %',
        rec.sig, fn_oid, fn_auth, rec.expect_auth,
        CASE WHEN rec.expect_auth THEN 'This function must stay member-callable — an over-revoke breaks a real save path.'
             ELSE 'This function must stay privileged-only — 0011 forbids ever re-granting it to authenticated.' END,
        fn_acl;
    END IF;

    -- C5 · NO OVER-REVOKE ON THE SERVER-SIDE PATH. Neither 0011 nor 0012
    -- touches service_role for any of the three.
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C5 FAILED — service_role can no longer EXECUTE % (oid %). Neither 0011 nor 0012 authorised removing this. acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    -- C6 · THE FUNCTION IS UNCHANGED IN KIND. This gate is a grant change
    -- only.
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C6 FAILED — % (oid %) is no longer SECURITY DEFINER. F-96/F-97/F-98 change grants only; something else edited the function.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C6 FAILED — % (oid %) is no longer VOLATILE (provolatile=%). F-96/F-97/F-98 change grants only.', rec.sig, fn_oid, fn_volatile;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, anon=false, public_entries=0, authenticated=%, service_role=true, SECURITY DEFINER, VOLATILE)',
      rpad(rec.sig, 32), fn_oid, rec.expect_auth;
  END LOOP;

  IF checked <> 3 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 3 functions, checked %. The VALUES list above was edited without updating this guard, or a signature failed to resolve silently.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for all 3 functions. claim_username and change_custom_url closed to PUBLIC/anon and retained for authenticated; clear_custom_url additionally closed to authenticated. Nothing was written. ---';
  RAISE NOTICE '    Not tested here: PostgREST HTTP exposure (F-53), and calling any of the three (all VOLATILE — this probe never mutates data).';
  RAISE NOTICE '    D2 half already evidenced separately: src/lib/__tests__/customUrlCannotBeRemoved.test.ts (8/8 passing, 2026-09-17) proves EditProfile.tsx never calls clear_custom_url and no other src/ caller does either — a source-level guard, not a substitute for this ACL probe.';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
