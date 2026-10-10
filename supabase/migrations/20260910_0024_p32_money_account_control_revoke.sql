-- P32 · money and account control — close 11 anon-executable VOLATILE
-- SECURITY DEFINER functions to `public`/`anon`. First named batch of P32.
--
-- =============================================================================
-- THE GATE — docs/ADDENDUM_A_EXECUTION_MASTER.md, P32, verbatim:
--
--   "the eight unauthenticated volatile functions each closed, rate-limited,
--    or justified with a test."
--
-- ⚠ "EIGHT" IS THE ADDENDUM'S ORIGINAL PLANNING ESTIMATE AND IT IS STALE. The
-- Auditor's own frozen list already corrected it once: docs/gates/
-- P1-revocation-list.md §0, correction C-58, 2026-09-04 — "D1 measured 33
-- VOLATILE anon-executable functions where the register says eight... A sweep
-- sized for eight leaves twenty-five behind." That correction is eleven days
-- old. A fresh count against the live staging catalogue today (2026-09-17)
-- finds the true RPC-reachable figure has grown again, to 88 — filtering
-- prokind='f' AND anon-executable AND provolatile='v' AND prorettype is not
-- trigger, which is the same method the 2026-09-15 census used and which this
-- file re-confirms rather than trusts:
--
--   {"total_anon_volatile":225,"trigger_fns":137,"rpc_reachable":88}
--
-- 137 of the 225 are trigger functions — Postgres does not EXECUTE-check a
-- trigger firing, so a grant on one is inert for this gate and counting it
-- would be a class-based, not per-function, measurement (forbidden by
-- P1-revocation-list.md §1). The growth from 33 to 88 is not a mystery: F-65
-- (docs project, Revision-3 draft §3.2) found `ALTER DEFAULT PRIVILEGES` can
-- only add to or retract its own additions from Postgres's BUILT-IN default
-- ACL, never subtract from it — so every function created since without an
-- explicit REVOKE in its own migration lands anon-executable by default,
-- regardless of what any earlier "fix" claimed to close. THIS FILE therefore
-- follows "the actual staging catalogue/call-site inventory" over the
-- Addendum's original headcount, which is exactly what the Auditor's own C-58
-- correction already did once.
--
-- SO: this is not a sweep against a named eight. It is the first of several
-- named-group migrations against the current 88, worked in the order the
-- 2026-09-15 census grouped them (docs project:
-- 2026-09-15-p32-census-and-root-cause.md) — money/account control, then
-- identity/enumeration, mail, competition-integrity, the three needing D2's
-- ruling, and a written disposition for the 24 with zero callers anywhere in
-- the tree. NOT a blind mass revoke: every function below was inspected for
-- callers before being placed in this file, not after.
--
-- =============================================================================
-- WHY THIS GROUP, AND WHY THESE ELEVEN
--
-- Every function below moves money, credits, debits, or destroys account
-- data. None has a legitimate anon path — a logged-out visitor has no
-- business calling any of them — and that classification is re-derived here,
-- not copied from the census:
--
--   admin_delete_auth_user(uuid)              admin UI only
--   admin_purge_orphan_user_data(uuid)         admin UI only
--   admin_reject_wallet_transaction(uuid,uuid,text)   admin UI only
--   admin_wallet_credit(uuid,uuid,numeric,text,text,uuid,text,jsonb)  admin UI only
--   approve_deposit(uuid,uuid)                 admin UI only
--   create_pending_deposit(uuid,numeric,text,text,jsonb,text)  service_role edge fn only
--   expire_gift_credit(uuid)                   service_role edge fn only
--   request_withdrawal(numeric,jsonb)          authenticated member hook only
--   soft_void_wallet_transactions(uuid[],text,uuid)  admin UI only
--   wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)  service_role edge fn only
--   wallet_transaction(uuid,text,numeric,text,uuid,text,jsonb)  admin UI + authenticated member hook
--
-- Fresh `grep -rn` today across src/, supabase/functions/ and functions/,
-- 2026-09-17, matches the census's classification exactly for this group:
--
--   admin_delete_auth_user / admin_purge_orphan_user_data / admin_wallet_credit /
--   admin_reject_wallet_transaction / approve_deposit
--     src/components/AdminGiftCredit.tsx, src/components/admin/AdminTransactions.tsx,
--     src/components/admin/AdminWalletTab.tsx, supabase/functions/send-gift-credit/index.ts,
--     supabase/functions/delete-user/index.ts, supabase/functions/delete-my-account/index.ts,
--     supabase/functions/ad-reward-credit/index.ts
--
--   wallet_transaction (18 references)
--     src/components/admin/AdminTransactions.tsx, WalletReconciliationAudit.tsx,
--     AdminAnalytics.tsx, AdminVoteRewardLedger.tsx, WalletLedgerV2DiffAudit.tsx,
--     src/hooks/wallet/useWallet.ts (member-facing, authenticated)
--
--   request_withdrawal / create_pending_deposit / soft_void_wallet_transactions /
--   expire_gift_credit
--     src/hooks/wallet/useWalletWithdrawals.ts,
--     supabase/functions/expire-gift-credits/index.ts,
--     supabase/functions/admin-process-withdrawal/index.ts,
--     supabase/functions/submit-deposit/index.ts,
--     supabase/functions/hard-delete-competition/index.ts
--
--   wallet_ledger_apply_v2
--     supabase/functions/expire-gift-credits/index.ts,
--     supabase/functions/razorpay-verify-payment/index.ts,
--     supabase/functions/cast-photo-vote/index.ts,
--     supabase/functions/paypal-capture-order/index.ts
--     ZERO references in src/ — service_role only, confirmed.
--
-- No caller reachable by a logged-out visitor exists for any of the eleven.
--
-- ⚠ A DOCUMENT DISAGREED WITH THE LIVE CATALOGUE, AND THE LIVE CATALOGUE WON.
-- docs/fix-sprints/phase-1a-wallet-authority-backlog.md:271 (a PLAN-ONLY
-- document, "Zero database queries executed. Zero migrations. Zero deploys.")
-- states `wallet_ledger_apply_v2`'s "GRANT EXECUTE [is] restricted to
-- service_role". The live staging catalogue, queried today, shows otherwise —
-- PUBLIC and anon both still hold EXECUTE. Standing Rule 21: "an instructing
-- comment is a control; when a comment and its code disagree, that is a
-- finding, not cosmetics." Asserted from the system, not the document — this
-- is exactly why the function is in this file rather than skipped as
-- already-closed.
--
-- ⚠ THE SEPARATE, LARGER "PHASE 1A CANONICAL WALLET AUTHORITY CONVERGENCE"
-- PLAN (docs/fix-sprints/phase-1a-canonical-wallet-authority-plan.md) is not
-- touched, superseded, or assumed by this file. That plan is PLAN ONLY,
-- unexecuted, and aims eventually to revoke `wallet_transaction` from
-- authenticated/anon/service_role entirely (step 1A-E-1) once a new canonical
-- `_apply_wallet_delta` helper exists — a structural rewrite, not a grant fix.
-- This file does not build toward or against that plan; it is strictly
-- narrower (public/anon only, on the functions as they exist today) and does
-- not conflict with it in either direction — the Phase 1A convergence, if and
-- when it proceeds, still has authenticated/service_role EXECUTE to revoke
-- from, exactly as it planned.
--
-- =============================================================================
-- F-62 — MEASURED, NOT ASSUMED, PER FUNCTION, TODAY (2026-09-17), STAGING
-- fpszggreishhuvdpkmdr:
--
-- All eleven carry the IDENTICAL acl shape:
--
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
--
--   aclexplode grantee=0 (PUBLIC) EXECUTE entries = 1, for every one of the
--   eleven. prosecdef=true, provolatile='v', for every one of the eleven.
--
-- ⚠ THE LEADING `=X/postgres` IS THE PUBLIC GRANT. As with P31's
-- search_certificates, `REVOKE … FROM anon` alone would be a no-op here —
-- anon inherits EXECUTE through PUBLIC. Every statement below revokes PUBLIC
-- first.
--
-- =============================================================================
-- NOT TOUCHED BY THIS FILE, each for a stated reason
--
--   authenticated, service_role     RETAINED on all eleven. wallet_transaction
--                                   and request_withdrawal have real
--                                   authenticated callers (member wallet
--                                   hooks); the rest are admin-UI or
--                                   service_role edge-function callers, all of
--                                   which authenticate through a different
--                                   layer (has_role checks in the admin UI's
--                                   own gating, or the service_role key
--                                   itself) that this file does not alter.
--                                   Revoking authenticated as well is exactly
--                                   the eventual scope of the separate,
--                                   unexecuted Phase 1A convergence plan
--                                   (1A-E-1) — deliberately NOT done here,
--                                   because it would break the very
--                                   authenticated member flows (useWallet.ts,
--                                   useWalletWithdrawals.ts) that this file's
--                                   own call-site inventory just confirmed are
--                                   real and legitimate.
--
--   admin_wallet_credit's body, admin_reject_wallet_transaction's body, etc.
--                                   Not touched. This is a grant change only.
--                                   Whatever internal has_role gating already
--                                   exists in these bodies is unaffected and
--                                   unrelied-upon: the anon/public door is
--                                   closed at the grant layer regardless of
--                                   what the body does or does not check.
--
--   the remaining 77 of the 88 anon-executable VOLATILE functions
--                                   Separate, later, named-group migrations:
--                                   identity/enumeration (9), mail (5),
--                                   competition-integrity (10), the three
--                                   needing D2's ruling (get_broadcast_feed ×3
--                                   overloads, log_client_error,
--                                   log_app_event — increment_managed_page_view
--                                   was struck from this group by the
--                                   Revision-3 draft §2.2, its original
--                                   blocking premise having been false since
--                                   PR #148 / commit 01fdf16), and a written
--                                   disposition for the 24 with zero callers
--                                   anywhere in the tree. None of those are
--                                   this file's scope and this file does not
--                                   pretend to close them.
--
-- =============================================================================
-- SEQUENCE — BEHAVIOUR step. Nothing is dropped, no body is touched, and the
-- rollback restores the prior grants, so a redeploy can undo it. Not using
-- DROP+CREATE is itself the F-66 mitigation: there is no moment at which the
-- built-in EXECUTE-to-PUBLIC default is re-applied.
--
-- FILENAME — the migrations directory's highest sequential Phase 1 ordinal is
-- `_0022`. `_0019` has two files sharing it (a pre-existing, Auditor-flagged
-- duplicate — F-105d and F-93's backfill — not this file's to resolve) and
-- `_0023` is absent from the tree (flagged by the Revision-3 draft §6 as
-- possibly withdrawn/burned, also not this file's to resolve; reusing either
-- would compound an already-open ordering ambiguity rather than avoid one).
-- `_0002` is reserved and owed a re-cut per P1-revocation-list.md §4.2/§4 item
-- 2 (`recompute_entry_from_tag_assignments`'s false justification comment).
-- This unit takes the first genuinely free slot, `_0024`, leaving all three
-- open items exactly as open as they were.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Both statements per function are idempotent and safe to re-run on an
-- already-closed lane. Order matters (F-62): PUBLIC first, then anon.

REVOKE ALL ON FUNCTION public.admin_delete_auth_user(uuid) FROM public;
REVOKE ALL ON FUNCTION public.admin_delete_auth_user(uuid) FROM anon;

REVOKE ALL ON FUNCTION public.admin_purge_orphan_user_data(uuid) FROM public;
REVOKE ALL ON FUNCTION public.admin_purge_orphan_user_data(uuid) FROM anon;

REVOKE ALL ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) FROM anon;

REVOKE ALL ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) FROM anon;

REVOKE ALL ON FUNCTION public.approve_deposit(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.approve_deposit(uuid, uuid) FROM anon;

REVOKE ALL ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) FROM public;
REVOKE ALL ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) FROM anon;

REVOKE ALL ON FUNCTION public.expire_gift_credit(uuid) FROM public;
REVOKE ALL ON FUNCTION public.expire_gift_credit(uuid) FROM anon;

REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, jsonb) FROM anon;

REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) FROM anon;

REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) FROM anon;

REVOKE ALL ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) FROM anon;

-- `authenticated` and `service_role` keep EXECUTE via their explicit ACL
-- entries, which the PUBLIC revoke does not disturb. See "NOT TOUCHED BY THIS
-- FILE" above for why each is retained on this function specifically.

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
