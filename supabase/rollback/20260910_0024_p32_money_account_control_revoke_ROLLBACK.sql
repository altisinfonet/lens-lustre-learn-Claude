-- ROLLBACK for 20260910_0024_p32_money_account_control_revoke.sql — P32,
-- money/account-control batch.
--
-- Restores PUBLIC and anon EXECUTE on all eleven functions, i.e. REOPENS every
-- money-moving and account-destroying RPC in this batch to any holder of the
-- public anon key.
--
-- =============================================================================
-- ⚠ WHAT RUNNING THIS COSTS — and it is the most expensive rollback in Phase 1
-- so far
--
-- This is not a directory leak or an enumeration surface like P30/P31. This
-- puts back anonymous EXECUTE on functions that delete an auth user, purge a
-- user's data, credit or debit a wallet, approve a deposit, create a pending
-- deposit, expire a gift credit, request a withdrawal, void a batch of
-- transactions, and write to the canonical wallet ledger. Every one of them is
-- SECURITY DEFINER, so RLS does not apply once the grant is open — whatever
-- internal has_role check exists in the body (and several of these have one)
-- becomes the ONLY control, and P32's own finding is that a grant a browser
-- can still reach is not a closed door, it is a smaller one.
--
-- ⚠ AND, LIKE P31, IT RE-GRANTS **PUBLIC**, NOT JUST anon. That is what the
-- measured pre-revoke state was on all eleven, so a faithful restore recreates
-- it — but PUBLIC means every role in the database, present and future,
-- including any role added after today. Restoring accurately and restoring
-- narrowly are different things; this file restores accurately. A narrower
-- restore (anon line only, drop the PUBLIC line) is a decision to record, not
-- a tidy-up, exactly as the P31 rollback says.
--
-- =============================================================================
-- WHEN IT IS ACTUALLY NEEDED — AND WHEN IT IS NOT
--
-- The apply is a pure grant restriction: no body, volatility, or SECURITY
-- DEFINER flag changes, and every caller this migration's own inventory found
-- (admin UI, authenticated member hooks, service_role edge functions) keeps
-- EXECUTE through its unchanged authenticated/service_role grant. So there is
-- no equivalent of P31's "the client collapses error and empty" precondition
-- here — nothing legitimate was calling through anon or public before the
-- revoke, and nothing legitimate loses access after it.
--
-- THE HONEST TRIGGER FOR THIS FILE: a caller this migration's inventory missed
-- — some path, not found by the 2026-09-17 grep across src/, supabase/
-- functions/ and functions/, that genuinely needs anon or public EXECUTE on
-- one of these eleven. If that surfaces, the correct fix is USUALLY narrower
-- than this file: grant EXECUTE back to the one function and role actually
-- needed, not run this rollback and reopen all eleven. This file exists for
-- the case where that is not fast enough and the whole batch must reopen
-- while the real fix is worked out.
--
-- What is NOT a trigger: an admin-panel or wallet-hook 403/42501. That is
-- authenticated or service_role's own grant, which this file does not touch
-- and this migration did not revoke — a 403 there means something else
-- changed, not that P32 closed too much.
--
-- =============================================================================
-- FIDELITY — measured, not assumed
--
-- Pre-revoke ACL, read by D1 2026-09-17, SELECT only, staging
-- fpszggreishhuvdpkmdr, IDENTICAL across all eleven functions:
--
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
--   aclexplode grantee=0 (PUBLIC) EXECUTE entries = 1, on every one
--
-- The leading `=X/postgres` is the PUBLIC grant. Both GRANT lines below are
-- required per function to restore it faithfully — PUBLIC and anon were BOTH
-- present, and re-granting only anon would leave a function in a state it was
-- never actually in.
--
-- ⚠ THE RESTORE IS PRIVILEGE-EQUIVALENT, NOT BYTE-EQUAL, exactly as P31's
-- rollback states and for the same reason: REVOKE removes an aclitem and
-- GRANT appends a new one, so element ORDER differs while the grants are
-- identical. `proacl::text` string equality is the wrong instrument; use
-- aclexplode, per function:
--
--   SELECT a.grantee::regrole::text, a.privilege_type
--     FROM pg_proc p, aclexplode(p.proacl) a
--    WHERE p.pronamespace='public'::regnamespace AND p.proname='<fn>'
--    ORDER BY 1, 2;
--
--   expect: PUBLIC (grantee 0) present, plus anon, authenticated, postgres,
--           service_role — all EXECUTE — for each of the eleven names below.
--
-- =============================================================================
-- VERIFY AFTER RUNNING — run once per function, substituting proname
--
--   SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          (SELECT count(*) FROM aclexplode(p.proacl) a
--            WHERE a.grantee = 0 AND a.privilege_type='EXECUTE') AS public_entries
--     FROM pg_proc p
--    WHERE p.pronamespace='public'::regnamespace AND p.proname='<fn>';
--
--   expect anon_exec = true, public_entries = 1, for every one of the eleven.
--
-- ⚠ PROBE_p32_money_account_control_closed.sql WILL FAIL AFTER THIS RUNS, and
-- that is correct: it is the gate assertion and the gate is deliberately
-- reopened. A failing probe here means the rollback worked. Do not "fix" the
-- probe.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.admin_delete_auth_user(uuid) TO public;
GRANT EXECUTE ON FUNCTION public.admin_delete_auth_user(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.admin_purge_orphan_user_data(uuid) TO public;
GRANT EXECUTE ON FUNCTION public.admin_purge_orphan_user_data(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) TO public;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) TO anon;

GRANT EXECUTE ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) TO public;
GRANT EXECUTE ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) TO anon;

GRANT EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) TO public;
GRANT EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) TO public;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) TO anon;

GRANT EXECUTE ON FUNCTION public.expire_gift_credit(uuid) TO public;
GRANT EXECUTE ON FUNCTION public.expire_gift_credit(uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, jsonb) TO public;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, jsonb) TO anon;

GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) TO public;
GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) TO anon;

GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) TO public;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) TO anon;

GRANT EXECUTE ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) TO public;
GRANT EXECUTE ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) TO anon;

COMMENT ON FUNCTION public.admin_delete_auth_user(uuid) IS
  'Deletes an auth user. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql once the reason for the rollback is resolved, and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.admin_purge_orphan_user_data(uuid) IS
  'Purges orphaned data for a deleted user. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) IS
  'Rejects a pending wallet transaction. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) IS
  'Credits a member wallet. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.approve_deposit(uuid, uuid) IS
  'Approves a pending deposit. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) IS
  'Creates a pending deposit record. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.expire_gift_credit(uuid) IS
  'Expires a gift-credit balance. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.request_withdrawal(numeric, jsonb) IS
  'Requests a member withdrawal. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) IS
  'Soft-voids a batch of wallet transactions. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) IS
  'Phase 1A canonical wallet-ledger writer, dry-run shadow phase. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';

COMMENT ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) IS
  'Records a wallet transaction. ⚠ P32 was ROLLED BACK — anon-executable and PUBLIC-granted again. Re-apply supabase/migrations/20260910_0024_p32_money_account_control_revoke.sql and re-prove with PROBE_p32_money_account_control_closed.sql.';
