-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · UNIT 0032 — money and account control. Ten Set C objects closed to
-- PUBLIC and anon.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor allocation R-7.
--
-- ⚠ ORDINAL. `0032` is allocated by the Auditor under R-7. Not self-selected.
-- This file replaces PR #274's `0027`, which is superseded, not amended.
--
-- ⚠ WHY THE RE-CUT. #274 carried three apply migrations and ZERO rollback
-- files — skill §3 is unconditional: "Every apply file ships with its rollback
-- file, in the same PR. No exceptions." Its `0027` also mixed Set B and Set C
-- objects, which have different lane profiles and therefore different rollback
-- hazards; this file is Set C only, and `request_withdrawal` — the Set B
-- object #274 bundled here — is now `0033` with its own two-lane rollback.
--
-- ─────────────────────────────────────────────────────────────────────────
-- MEASURED STARTING ACL — staging fpszggreishhuvdpkmdr, SELECT only,
-- 2026-09-22T06:45Z. Re-derived this session; NOT inherited from #274.
-- All ten, identical:
--   =X/postgres | postgres=X/postgres | anon=X/postgres |
--   authenticated=X/postgres | service_role=X/postgres
--   prosecdef = true · provolatile = 'v' · PUBLIC EXECUTE entries = 1
--
-- PRODUCTION: all ten already closed (RELAYED from the Auditor's two-lane
-- diff — production is not attached to this session's connector, so this is
-- not a measurement made here). On production this file is therefore a no-op
-- by construction, which is what makes one file safe for both lanes.
--
-- ─────────────────────────────────────────────────────────────────────────
-- F-62 — THE ORDER IS THE CONTROL, NOT A STYLE CHOICE.
-- The leading `=X/postgres` IS the PUBLIC grant. `anon` inherits EXECUTE
-- through PUBLIC, so `REVOKE ... FROM anon` alone closes NOTHING here. PUBLIC
-- is revoked first in every statement below, then anon, then the named grants
-- are restored explicitly.
--
-- F-66 — no DROP, no CREATE, no body change. `CREATE OR REPLACE` is not used
-- either. There is no instant at which Postgres re-applies its built-in
-- EXECUTE-to-PUBLIC default, so the closure cannot silently reopen inside this
-- file.
--
-- IDEMPOTENCE — REVOKE and GRANT are idempotent in PostgreSQL: revoking a
-- privilege that is absent and granting one already held are both no-ops. This
-- file is safe to re-run, and §14 step 5 proves it on a fixture rather than
-- asserting it here.
--
-- ─────────────────────────────────────────────────────────────────────────
-- `authenticated` IS RETAINED ON ALL TEN, AND THAT IS A DELIBERATE CHOICE
-- WITH A STATED COST.
--
-- This unit's gate is about the ANONYMOUS door. Six of the ten have no
-- authenticated caller anywhere in the tree — caller trace 2026-09-22T05:35Z,
-- docs/evidence/d1/phase1/d2-caller-evidence-verification.md:
--
--   admin_delete_auth_user            edge only (delete-my-account:80, delete-user:71)
--   admin_purge_orphan_user_data      edge only (delete-my-account:168, delete-user:157)
--   create_pending_deposit            edge only (submit-deposit:70)
--   expire_gift_credit                edge only (expire-gift-credits:63)
--   soft_void_wallet_transactions     edge only (hard-delete-competition:385,429)
--   wallet_ledger_apply_v2            edge only (4 sites, ZERO in src/)
--
-- and four DO have real authenticated callers:
--
--   admin_reject_wallet_transaction   src/components/admin/AdminTransactions.tsx:514
--   admin_wallet_credit               AdminGiftCredit.tsx:212, AdminWalletTab.tsx:121 (+2 edge)
--   approve_deposit                   src/components/admin/AdminTransactions.tsx:486
--   wallet_transaction                src/hooks/wallet/useWallet.ts:66,79 (+7 edge)
--
-- Revoking `authenticated` from the first six would be a correct tightening
-- and it is NOT DONE HERE, for two reasons stated rather than assumed:
-- (1) it is outside this unit's gate, and §17 says a defect outside the unit
--     is recorded, not fixed;
-- (2) the asymmetry of being wrong. An unnecessary `authenticated` grant
--     leaves the anon gate closed and breaks nothing; a wrongly removed one
--     breaks an admin screen with a 42501 and no warning. "Revoking a grant
--     the app still calls turns a security fix into an outage."
-- RECORDED for the Auditor as a candidate follow-up unit with its own gate.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 · admin_delete_auth_user — edge (service_role) callers only.
REVOKE ALL ON FUNCTION public.admin_delete_auth_user(_uid uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_auth_user(_uid uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_auth_user(_uid uuid) TO authenticated, service_role;

-- 2 · admin_purge_orphan_user_data — edge (service_role) callers only.
REVOKE ALL ON FUNCTION public.admin_purge_orphan_user_data(_uid uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_purge_orphan_user_data(_uid uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_orphan_user_data(_uid uuid) TO authenticated, service_role;

-- 3 · admin_reject_wallet_transaction — authenticated admin UI caller.
REVOKE ALL ON FUNCTION public.admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text) TO authenticated, service_role;

-- 4 · admin_wallet_credit — authenticated admin UI + edge callers.
REVOKE ALL ON FUNCTION public.admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) TO authenticated, service_role;

-- 5 · approve_deposit — authenticated admin UI caller.
REVOKE ALL ON FUNCTION public.approve_deposit(_admin_id uuid, _txn_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_deposit(_admin_id uuid, _txn_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_deposit(_admin_id uuid, _txn_id uuid) TO authenticated, service_role;

-- 6 · create_pending_deposit — edge (service_role) caller only.
REVOKE ALL ON FUNCTION public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text) TO authenticated, service_role;

-- 7 · expire_gift_credit — edge (service_role) caller only.
REVOKE ALL ON FUNCTION public.expire_gift_credit(_gift_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_gift_credit(_gift_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_gift_credit(_gift_id uuid) TO authenticated, service_role;

-- 8 · soft_void_wallet_transactions — edge (service_role) callers only.
REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid) TO authenticated, service_role;

-- 9 · wallet_ledger_apply_v2 — four edge callers, ZERO references in src/.
--     #274 recorded that a plan document claimed this was already
--     service_role-only and the live catalogue disagreed (Standing Rule 21).
--     Re-measured 2026-09-22T06:45Z: PUBLIC and anon both still hold EXECUTE.
REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean) TO authenticated, service_role;

-- 10 · wallet_transaction — authenticated member hooks + edge callers, and
--      eight other SECURITY DEFINER functions call it internally. Those inner
--      calls run AS THE DEFINER and never consult the caller's grant, so this
--      revoke cannot break them.
REVOKE ALL ON FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) TO authenticated, service_role;

COMMIT;
