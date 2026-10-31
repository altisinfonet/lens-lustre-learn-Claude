-- ═══════════════════════════════════════════════════════════════════════════
-- P32 GATE PROBE — money/account-control batch: eleven functions closed to
-- anon and public, authenticated/service_role and function kind unchanged.
-- READS ONLY. Ends in ROLLBACK.
--
-- ⚠ THE GATE'S OWN RULE — docs/gates/P1-revocation-list.md §1, frozen:
--
--   "A closure is proved per function, by
--    has_function_privilege('anon', <oid>, 'EXECUTE') = false, on the lane it
--    is claimed for. No gate on this list may be written against a *class*."
--
-- This probe is data-driven (one row per function, looped) rather than eleven
-- hand-copied blocks, but the assertion itself still runs and reports
-- per-function, per-oid — the loop is a way of not retyping the same five
-- checks eleven times with the eleventh copy-paste error nobody catches, not
-- a class-based shortcut. Each iteration resolves its own oid from the
-- catalogue at run time (via to_regprocedure, never a hardcoded oid) and
-- fails with that function's own name and acl in the message.
--
-- ⚠ F-62 GENUINELY BITES HERE, ON ALL ELEVEN. PUBLIC held EXECUTE on every one
-- of them (measured 2026-09-17: the leading `=X/postgres` in proacl,
-- aclexplode grantee=0 count = 1, on all eleven). So C2 (anon) and C3
-- (PUBLIC) are BOTH required per function, exactly as in the P31 probe: they
-- fail differently and the difference names the defect.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the catalogue in-database. It
-- does not exercise /rest/v1/rpc over HTTP as a real anonymous browser would,
-- so it does not test PostgREST's own exposure rules directly (curl is not a
-- browser, F-53) — and it does not re-verify the admin-UI/service_role/
-- authenticated callers still work, which is D2's half and a browser
-- question. What it DOES prove: the grant layer is closed for anon/public and
-- open for the three legitimate roles, on the object actually in the
-- database today.
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
  RAISE NOTICE '--- P32 gate probe: money/account-control batch @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  FOR rec IN
    SELECT * FROM (VALUES
      ('public.admin_delete_auth_user(uuid)'),
      ('public.admin_purge_orphan_user_data(uuid)'),
      ('public.admin_reject_wallet_transaction(uuid, uuid, text)'),
      ('public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb)'),
      ('public.approve_deposit(uuid, uuid)'),
      ('public.create_pending_deposit(uuid, numeric, text, text, jsonb, text)'),
      ('public.expire_gift_credit(uuid)'),
      ('public.request_withdrawal(numeric, jsonb)'),
      ('public.soft_void_wallet_transactions(uuid[], text, uuid)'),
      ('public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)'),
      ('public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb)')
    ) AS t(sig)
  LOOP
    -- C1 · the exact signature this migration revoked still resolves to
    -- exactly one function. to_regprocedure returns NULL rather than erroring
    -- if it does not exist or is ambiguous, so both cases are caught here
    -- rather than as an opaque cast failure.
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'C1 FAILED — % does not resolve to exactly one function. P32 closes a grant; it does not drop the function, and the signature must match what the migration revoked exactly.', rec.sig;
    END IF;

    SELECT p.proacl::text, p.prosecdef, p.provolatile
      INTO fn_acl, fn_secdef, fn_volatile
      FROM pg_proc p WHERE p.oid = fn_oid;

    checked := checked + 1;

    -- C2 · THE GATE.
    SELECT has_function_privilege('anon', fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role', fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    IF fn_anon THEN
      RAISE EXCEPTION
        'C2 FAILED — anon can still EXECUTE % (oid %). A money-moving or account-destroying RPC is open to any holder of the public anon key. acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C3 · THE F-62 TRAP, REAL HERE. PUBLIC held EXECUTE on all eleven before
    -- the revoke (measured 2026-09-17).
    SELECT count(*) INTO fn_public
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

    IF fn_acl IS NULL THEN
      RAISE EXCEPTION
        'C3 FAILED — proacl is NULL on % (oid %). NULL is the BUILT-IN DEFAULT, which IS EXECUTE TO PUBLIC, not "no grants". The function has been recreated (DROP+CREATE re-applies the default — F-66) and P32 has silently reopened.',
        rec.sig, fn_oid;
    END IF;
    IF fn_public > 0 THEN
      RAISE EXCEPTION
        'C3 FAILED — PUBLIC holds EXECUTE on % (oid %, % entry). anon inherits through PUBLIC, so revoking from anon alone would have closed NOTHING here (F-62). acl = %',
        rec.sig, fn_oid, fn_public, fn_acl;
    END IF;

    -- C4 · NO OVER-REVOKE. The gate closes anon/public; authenticated and
    -- service_role are the legitimate callers this migration's own inventory
    -- found and must still work.
    IF NOT fn_auth THEN
      RAISE EXCEPTION 'C4 FAILED — authenticated can no longer EXECUTE % (oid %). This is an over-revoke; the rollback does not restore it. acl = %', rec.sig, fn_oid, fn_acl;
    END IF;
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C4 FAILED — service_role can no longer EXECUTE % (oid %). Server-side/edge-function callers are not the attack class P32 addresses. acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    -- C5 · THE FUNCTION IS UNCHANGED IN KIND. P32 is a grant change only.
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C5 FAILED — % (oid %) is no longer SECURITY DEFINER. P32 changes grants only; something else edited the function.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C5 FAILED — % (oid %) is no longer VOLATILE (provolatile=%). P32 changes grants only.', rec.sig, fn_oid, fn_volatile;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, anon=false, public_entries=0, authenticated=true, service_role=true, SECURITY DEFINER, VOLATILE)', rpad(rec.sig, 74), fn_oid;
  END LOOP;

  IF checked <> 11 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 11 functions, checked %. The VALUES list above was edited without updating this guard, or a signature failed to resolve silently.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for all 11 functions. Money/account-control batch closed to anon and public on this lane. Nothing was written. ---';
  RAISE NOTICE '    Not tested here: PostgREST HTTP exposure (F-53) and the admin-UI/member-hook/edge-function callers actually working end to end — D2''s half.';
  RAISE NOTICE '    Remaining P32 scope, not this file: identity/enumeration (9), mail (5), competition-integrity (10), the 3 needing D2''s ruling, and a written disposition for the 24 with zero callers.';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
