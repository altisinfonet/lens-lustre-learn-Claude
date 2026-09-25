-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · MONEY AND ACCOUNT CONTROL — ELEVEN FUNCTIONS CLOSED TO anon AND PUBLIC.
--
-- This file is the R-23 RE-CUT of 20260910_0027_p32_money_account_control_revoke.sql.
-- The object list and the revoke semantics are UNCHANGED — R-23 is explicit
-- that this is "not a re-scope". What changes is how the file behaves when it
-- runs, and 0027 is withdrawn in the same PR rather than left to be dispatched
-- by accident.
--
-- ── WHY 0027 COULD NOT BE DISPATCHED ───────────────────────────────────────
--
--   1. NO TRANSACTION. 0027 has no BEGIN and no COMMIT. Under psql's
--      --set ON_ERROR_STOP=1 a failure at statement 14 of 33 leaves the first
--      thirteen applied and the rest not — eleven money functions in a state
--      nobody designed, and a rollback file that assumes all-or-nothing.
--   2. RETENTION BY OMISSION. 0027 keeps `authenticated` and `service_role`
--      by NOT revoking them. That is safe only while those roles happen to
--      hold named ACL entries of their own. It is the same reasoning that
--      failed in the withdrawn 0029, where the role in question held no named
--      entry and the revoke took everything. This file GRANTS them back
--      EXPLICITLY, so the end state is asserted rather than inherited.
--   3. NO LANE ASSERTION, NO PRECONDITION, NO POSTCONDITION. It could run
--      anywhere, against anything, and could not tell you afterwards whether
--      it had worked.
--
-- ── WHAT IS BEING CLOSED, MEASURED ON STAGING 2026-09-24, SELECT ONLY ──────
--
-- All eleven are SECURITY DEFINER and VOLATILE, and all eleven carry the
-- identical ACL:
--
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
--
-- The leading `=X/postgres` is the PUBLIC grant. F-62: `REVOKE … FROM anon`
-- ALONE WOULD BE A NO-OP HERE, because anon reaches EXECUTE through PUBLIC.
-- Every REVOKE below names PUBLIC first and anon second.
--
-- A SECURITY DEFINER function runs with its owner's rights, and `postgres` on
-- Supabase is BYPASSRLS. An unauthenticated visitor holding EXECUTE on
-- `wallet_transaction` or `admin_wallet_credit` is not protected by RLS at
-- all; whatever `has_role` check the body performs is the only thing standing
-- there, and a grant is not a place to rely on that.
--
-- ── WHY NOTHING BREAKS — re-confirmed at 640b2a0, not copied forward ───────
--
-- 28 `.rpc()` call sites across src/**, supabase/functions/** and functions/**.
-- Every one runs as `authenticated` or as a service-role client:
--
--   src/**  (7 sites)   the browser client, which is `authenticated` at every
--                       one of them. The three admin components live under
--                       AdminPanel.tsx, which returns null unless
--                       hasAdminPanelAccess; the two member wallet hooks both
--                       guard `if (!user)` before the call.
--   edge    (21 sites)  eleven functions, each calling through a client built
--                       with SUPABASE_SERVICE_ROLE_KEY — `admin`,
--                       `adminClient`, `serviceClient`, or `supabase`. The
--                       four `wallet_ledger_apply_v2` sites are inside
--                       shadowApplyV2* helpers that take the client as a
--                       parameter; every invocation passes the service-role
--                       client, traced individually.
--
-- ⚠ ELEVEN EDGE FUNCTIONS, NOT TEN. The R-23 command lists ten. The eleventh
-- is supabase/functions/delete-user/index.ts, which calls
-- admin_delete_auth_user (line 70) and admin_purge_orphan_user_data (line 156)
-- through `adminClient`, a SUPABASE_SERVICE_ROLE_KEY client. It is
-- service-role like the rest, so it does not change the outcome — but it was
-- missing from the inventory, and an inventory that is short by one file is
-- the shape of an outage. Recorded rather than quietly folded in.
--
-- NO ANON CALLER EXISTS FOR ANY OF THE ELEVEN.
--
-- ── WHAT THIS FILE DOES NOT DO ────────────────────────────────────────────
--
--   * It does not touch any function BODY. This is a grant change.
--   * It does not revoke `authenticated` or `service_role` — it grants them
--     explicitly. Revoking `authenticated` is the eventual scope of the
--     separate, unexecuted Phase 1A convergence plan (step 1A-E-1), and doing
--     it here would break the member wallet flows this file's own call-site
--     inventory just confirmed are real.
--   * It does not assert the exact pre-state ACL. Production is UNMEASURED —
--     the Auditor's two-lane diff says ten of the eleven are already closed to
--     anon there and the eleventh never had PUBLIC — and this file must be
--     correct on both lanes. REVOKE and GRANT are idempotent; asserting an ACL
--     that only staging has would make the file refuse on production for a
--     reason that has nothing to do with safety.
--
-- ── SEQUENCE ──────────────────────────────────────────────────────────────
--
-- BEHAVIOUR step. Nothing is dropped and no body is recreated, so F-66 — a
-- DROP+CREATE re-opening the built-in EXECUTE-to-PUBLIC default — cannot
-- happen here. The rollback ships in the same PR.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — TWO-LANE FORM. ───────────────────────────────────────
-- This is deliberately NOT the staging-only R-9 guard. This apply is meant for
-- BOTH lanes: it closes a door, and the door needs closing on production too.
-- It still fails closed outside the workflow, because apply-migration.yml is
-- the only thing that sets p32.lane (R-13, live since #293) and it sets it
-- from the dispatch's own target. A hand-run psql session has it unset and is
-- refused.
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'This file is meant for both lanes, but it will not run outside the dispatch '
      'workflow, which is the only thing that sets the lane and sets it from the '
      'target you chose. The file cannot detect its own lane, so it refuses '
      'unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION — the eleven exist, with exactly these signatures, and each
--    is SECURITY DEFINER. The ACL is deliberately NOT asserted (see above).
DO $preconditions$
DECLARE
  sig text;
  oid_ oid;
  n   int := 0;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.admin_delete_auth_user(uuid)',
    'public.admin_purge_orphan_user_data(uuid)',
    'public.admin_reject_wallet_transaction(uuid, uuid, text)',
    'public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb)',
    'public.approve_deposit(uuid, uuid)',
    'public.create_pending_deposit(uuid, numeric, text, text, jsonb, text)',
    'public.expire_gift_credit(uuid)',
    'public.request_withdrawal(numeric, jsonb)',
    'public.soft_void_wallet_transactions(uuid[], text, uuid)',
    'public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)',
    'public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb)']
  LOOP
    n := n + 1;
    oid_ := to_regprocedure(sig);
    IF oid_ IS NULL THEN
      RAISE EXCEPTION 'P32-0032-PRE-001: % does not exist with that exact signature', sig
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = oid_) THEN
      RAISE EXCEPTION 'P32-0032-PRE-002: % is not SECURITY DEFINER', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 11 THEN
    RAISE EXCEPTION 'P32-0032-PRE-003: expected 11 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE REVOCATION AND THE EXPLICIT RETENTION ─────────────────────────────
-- Two statements per function, in this order, every time:
--   REVOKE ALL … FROM PUBLIC, anon   — PUBLIC first (F-62)
--   GRANT EXECUTE … TO authenticated, service_role
-- The GRANT is not a no-op dressed up as one: it is what turns "these roles
-- keep EXECUTE because nothing took it away" into "these roles hold EXECUTE
-- because this file says so". Both statements are idempotent.

REVOKE ALL ON FUNCTION public.admin_delete_auth_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_auth_user(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_purge_orphan_user_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_orphan_user_data(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.approve_deposit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.expire_gift_credit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_gift_credit(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) TO authenticated, service_role;

-- ── THE COMMENTS, CARRIED ACROSS FROM 0027 VERBATIM ───────────────────────
-- Unchanged text, deliberately: these are 0027's own words about each
-- function, and 0027 never ran, so the database has never carried them.
-- Standing Rule 21 — the comment is a control, so it travels with the change
-- it describes rather than being re-written to match a new file name.

COMMENT ON FUNCTION public.admin_delete_auth_user(uuid) IS
  'Deletes an auth user. NOT executable by anon or public — P32 money/account-control batch. Admin-UI-only caller (AdminGiftCredit.tsx / delete-user edge fn); no anon path existed. ⚠ PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). If recreated with DROP+CREATE this REOPENS to PUBLIC (F-66) and the revoke must be re-applied and re-proved.';

COMMENT ON FUNCTION public.admin_purge_orphan_user_data(uuid) IS
  'Purges orphaned data for a deleted user. NOT executable by anon or public — P32. Admin-UI/service_role edge-fn only. Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) IS
  'Rejects a pending wallet transaction as an admin action. NOT executable by anon or public — P32. Admin-UI only (AdminTransactions.tsx). Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) IS
  'Credits a member wallet as an admin action. NOT executable by anon or public — P32. Admin-UI only (AdminGiftCredit.tsx, AdminWalletTab.tsx). Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.approve_deposit(uuid, uuid) IS
  'Approves a pending deposit as an admin action. NOT executable by anon or public — P32. Admin-UI only. Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) IS
  'Creates a pending deposit record. NOT executable by anon or public — P32. service_role edge function only (submit-deposit); zero references in src/. Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.expire_gift_credit(uuid) IS
  'Expires a gift-credit balance. NOT executable by anon or public — P32. service_role edge function only (expire-gift-credits); zero references in src/. Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.request_withdrawal(numeric, jsonb) IS
  'Requests a member withdrawal. NOT executable by anon or public — P32. authenticated member caller only (useWalletWithdrawals.ts); no anon path existed. authenticated EXECUTE is retained on purpose — this is the real, legitimate caller. Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) IS
  'Soft-voids a batch of wallet transactions as an admin action. NOT executable by anon or public — P32. Admin-UI/service_role edge-fn only (hard-delete-competition). Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) IS
  'Phase 1A canonical wallet-ledger writer, dry-run shadow phase. NOT executable by anon or public — P32. service_role edge functions only (expire-gift-credits, razorpay-verify-payment, cast-photo-vote, paypal-capture-order); zero references in src/, confirmed 2026-09-17. ⚠ A PLAN-ONLY doc (phase-1a-wallet-authority-backlog.md) claimed this was already service_role-restricted; the live catalogue showed PUBLIC and anon still held EXECUTE before this revoke (Standing Rule 21 — assert from the system, not the document). Same F-62/F-66 caveats as admin_delete_auth_user.';

COMMENT ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) IS
  'Records a wallet transaction. NOT executable by anon or public — P32. Admin-UI and authenticated member caller (useWallet.ts); authenticated EXECUTE is retained on purpose. The separate, unexecuted Phase 1A canonical-wallet-authority plan eventually intends to revoke this from authenticated/service_role too (step 1A-E-1) once a new canonical helper exists — not done here, and not this file''s scope. Same F-62/F-66 caveats as admin_delete_auth_user.';

-- ── POSTCONDITION — three separate assertions, each able to fail alone. ───
DO $postconditions$
DECLARE
  sig     text;
  oid_    oid;
  pub_n   int;
  n       int := 0;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.admin_delete_auth_user(uuid)',
    'public.admin_purge_orphan_user_data(uuid)',
    'public.admin_reject_wallet_transaction(uuid, uuid, text)',
    'public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb)',
    'public.approve_deposit(uuid, uuid)',
    'public.create_pending_deposit(uuid, numeric, text, text, jsonb, text)',
    'public.expire_gift_credit(uuid)',
    'public.request_withdrawal(numeric, jsonb)',
    'public.soft_void_wallet_transactions(uuid[], text, uuid)',
    'public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)',
    'public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb)']
  LOOP
    n := n + 1;
    oid_ := to_regprocedure(sig);

    IF has_function_privilege('anon', oid_, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0032-POST-001: anon still holds EXECUTE on %', sig
        USING ERRCODE = 'raise_exception';
    END IF;

    -- grantee 0 is the PUBLIC pseudo-role. Counted through aclexplode rather
    -- than by looking for a leading '=' in the text, because the text form is
    -- a rendering and this is a fact about the ACL.
    SELECT count(*) INTO pub_n
      FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = oid_ AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-0032-POST-002: % still has % PUBLIC ACL entr(y/ies)', sig, pub_n
        USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT has_function_privilege('authenticated', oid_, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0032-POST-003: authenticated lost EXECUTE on %', sig
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', oid_, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0032-POST-004: service_role lost EXECUTE on %', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 11 THEN
    RAISE EXCEPTION 'P32-0032-POST-005: expected 11 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
