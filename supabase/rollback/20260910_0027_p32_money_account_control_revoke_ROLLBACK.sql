-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for the MERGED 20260910_0027_p32_money_account_control_revoke.sql
-- Identical stem, as required. Eleven objects.
--
-- ⚠ GAP-FILLING, NOT RECOVERY. The apply is merged on `staging` (`0869a94`,
-- PR #274) and has **never been dispatched** — `supabase_migrations
-- .schema_migrations` holds 8 rows, latest `20260915130151`, measured
-- 2026-09-22T08:42Z. There is no state to undo today. This file exists because
-- the apply shipped without it, and skill §3 is unconditional: "Every apply
-- file ships with its rollback file, in the same PR. No exceptions." That
-- omission is what the R-8 correction unit is closing.
--
-- **The merged apply file is NOT modified by this unit** (§8). Rollback only.
--
-- ═════════════════════════════════════════════════════════════════════════
-- WHAT THE APPLY ACTUALLY REMOVES — read from the merged file, not assumed
--
-- `0027` contains **no `GRANT` statements at all**. Per object it issues
-- exactly two: `REVOKE ALL … FROM public` and `REVOKE ALL … FROM anon`. It
-- retains `authenticated` and `service_role` **by not revoking them** —
-- retention by omission.
--
-- That works only if those roles hold entries of their own. Verified for all
-- eleven objects, staging, 2026-09-22T08:42Z:
--   authenticated NAMED = true · service_role NAMED = true · PUBLIC entries = 1
-- so the apply is safe as written. **It is safe by the shape of today's ACL,
-- not by construction** — the same reasoning that failed in the withdrawn
-- `0029`, where the role in question (`supabase_auth_admin`) held no named
-- entry. Recorded for the Auditor in the object reservation; not a defect today.
--
-- Therefore this rollback restores exactly one thing per object: **`anon`**.
-- `authenticated` and `service_role` never left, so re-granting them would
-- misrepresent what is being undone.
--
-- ═════════════════════════════════════════════════════════════════════════
-- PUBLIC IS NEVER RE-GRANTED, ON ANY LANE, EVER
--
--   STAGING, measured 2026-09-22T08:42Z — all eleven:
--     =X/postgres | postgres=X/postgres | anon=X/postgres |
--     authenticated=X/postgres | service_role=X/postgres      PUBLIC: held
--   PRODUCTION — RELAYED from the Auditor's two-lane diff, not measured here:
--     the nine Set C objects are already closed;
--     `request_withdrawal(numeric, jsonb)` reads
--     `postgres | authenticated | service_role | anon`         PUBLIC: NOT held
--
-- Restoring staging's PUBLIC grant on production would create an exposure that
-- has never existed there, on eleven money-and-account-control functions. That
-- is the recorded UNAPPLIED_0023 hazard. So this rollback under-restores on
-- staging, deliberately, and the difference is documented rather than closed
-- silently.
--
-- ⚠ AN ADJACENT HAZARD, RAISED AND NOT SOLVED HERE — see BLOCKER-C in
-- docs/evidence/d1/phase1/R8-BLOCKERS-20260922.md.
-- Nine of these eleven are ALREADY CLOSED to `anon` on production (relayed).
-- Running this rollback there would GRANT `anon` EXECUTE on functions that do
-- not have it today. The file cannot detect its own lane: `current_database()`
-- is `postgres` on both, and the session-pooler username `apply-migration.yml`
-- inspects is not visible to SQL.
--
-- `0038` solves its own version of this by having its APPLY write a marker for
-- its rollback to read. **That option is not available here**: `0027` is merged
-- and §8 forbids editing it, so it cannot be made to record anything. A lane
-- interlock is an operating convention and conventions are the Auditor's.
--
--   **OPERATING CONSTRAINT UNTIL THE AUDITOR RULES: STAGING ONLY. Do not run
--   this rollback against production.**
--
-- IDEMPOTENCE — GRANT is idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.admin_delete_auth_user(_uid uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_orphan_user_data(_uid uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.approve_deposit(_admin_id uuid, _txn_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text) TO anon;
GRANT EXECUTE ON FUNCTION public.expire_gift_credit(_gift_id uuid) TO anon;
-- Set B — open on both lanes, but with different shapes. Same rule applies.
GRANT EXECUTE ON FUNCTION public.request_withdrawal(_amount numeric, _bank_details jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) TO anon;

DO $verify$
DECLARE r record; bad int := 0; missing int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'admin_delete_auth_user','admin_purge_orphan_user_data','admin_reject_wallet_transaction',
       'admin_wallet_credit','approve_deposit','create_pending_deposit','expire_gift_credit',
       'request_withdrawal','soft_void_wallet_transactions','wallet_ledger_apply_v2','wallet_transaction')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(p2.proacl) a
                WHERE p2.oid = r.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      bad := bad + 1; RAISE WARNING 'PUBLIC holds EXECUTE on public.% after rollback', r.proname;
    END IF;
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      missing := missing + 1;
      RAISE WARNING 'public.% lost authenticated and/or service_role — the apply retained them by omission, so their absence means something else removed them', r.proname;
    END IF;
  END LOOP;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  IF missing > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — % object(s) are missing a named authenticated/service_role grant. Restoring anon on top of that would leave the object reachable by anon and not by its real callers. Transaction aborted.', missing;
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED — anon restored on 11 objects, PUBLIC absent on all 11, authenticated and service_role intact.';
END $verify$;

COMMIT;
