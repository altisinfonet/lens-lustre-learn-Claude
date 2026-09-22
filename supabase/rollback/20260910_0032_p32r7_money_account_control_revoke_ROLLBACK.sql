-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0032_p32r7_money_account_control_revoke.sql
-- Identical stem, as required. Ten Set C objects.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor allocation R-7.
--
-- ⚠ THIS FILE EXISTS BECAUSE ITS ABSENCE IS WHY #274 WAS RE-CUT. Skill §3:
-- "Every apply file ships with its rollback file, in the same PR. No
-- exceptions." #274 shipped `0027`, `0028` and `0029` with none.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS ROLLBACK RESTORES, AND WHAT IT DELIBERATELY DOES NOT
--
-- The apply removed exactly two things per object: the PUBLIC grant and the
-- `anon` named grant. It re-granted `authenticated` and `service_role`
-- explicitly, so those never left.
--
--   RESTORED   : `anon` EXECUTE — the named grant the apply removed.
--   NOT RESTORED: **PUBLIC EXECUTE. Never. On any lane.**
--
-- ⚠ THE ROLLBACK IS THEREFORE NOT A PERFECT INVERSE ON STAGING, AND THAT IS
-- INTENTIONAL, NOT AN OVERSIGHT. Staging's measured starting ACL carried
-- `=X/postgres` (the PUBLIC grant) on all ten, 2026-09-22T06:45Z. Production
-- does not carry it (RELAYED — production is not attached to this session's
-- connector). A rollback that faithfully restored staging's starting state
-- would, run on production, CREATE a PUBLIC EXECUTE grant that has never
-- existed there. That is the recorded UNAPPLIED_0023 hazard, and a rollback
-- file is precisely the artefact most likely to be run in a hurry on the wrong
-- lane. So PUBLIC is never re-granted, and the residual difference on staging
-- is documented here rather than closed silently.
--
-- ⚠⚠ A SECOND, ADJACENT HAZARD THE WORK ORDER DOES NOT NAME — RAISED, NOT
-- SOLVED HERE. See BLOCKER-C in
-- docs/evidence/d1/phase1/R7-BLOCKERS-20260922.md.
--
-- Work order §10 makes the PUBLIC hazard explicit for the Set B units (`0033`,
-- `0035`). The same hazard class exists here in a different currency:
-- **on production these ten objects are ALREADY CLOSED to `anon`** (relayed).
-- Running this rollback on production would GRANT `anon` EXECUTE on ten
-- money-and-account-control functions that do not have it today — an exposure
-- created by a rollback, on the lane that matters most.
--
-- This file cannot detect its own lane. `current_database()` is `postgres` on
-- both; the session-pooler username that `apply-migration.yml` inspects is not
-- visible to SQL. D1 has NOT invented an interlock for it: a lane guard is an
-- operating convention and conventions are the Auditor's, not D1's — the same
-- reason §10 forbids inventing `_STAGING`/`_PRODUCTION` file variants.
--
--   **OPERATING CONSTRAINT UNTIL THE AUDITOR RULES: this rollback is for
--   STAGING ONLY. Do not run it against production.**
--
-- The exposure is currently hypothetical — this unit is Set C and is not
-- authorized for dispatch at all — which is exactly why it should be ruled on
-- before that changes rather than after.
--
-- IDEMPOTENCE — GRANT is idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Restores ONLY the `anon` named grant removed by the apply. No PUBLIC.
GRANT EXECUTE ON FUNCTION public.admin_delete_auth_user(_uid uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_orphan_user_data(_uid uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.approve_deposit(_admin_id uuid, _txn_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text) TO anon;
GRANT EXECUTE ON FUNCTION public.expire_gift_credit(_gift_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) TO anon;

-- `authenticated` and `service_role` are NOT re-granted here: the apply never
-- removed them. Granting them again would be harmless but would misrepresent
-- what this rollback undoes.

-- Post-condition, inside the transaction, so a violation rolls the whole file
-- back rather than leaving a half-restored ACL.
DO $verify$
DECLARE r record; bad int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'admin_delete_auth_user','admin_purge_orphan_user_data','admin_reject_wallet_transaction',
       'admin_wallet_credit','approve_deposit','create_pending_deposit','expire_gift_credit',
       'soft_void_wallet_transactions','wallet_ledger_apply_v2','wallet_transaction')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p2, aclexplode(p2.proacl) a
                WHERE p2.oid = r.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      bad := bad + 1;
      RAISE WARNING 'PUBLIC holds EXECUTE on public.% after rollback', r.proname;
    END IF;
  END LOOP;
  IF bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — PUBLIC EXECUTE present on % object(s). This rollback must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', bad;
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED — anon restored on 10 objects, PUBLIC absent on all 10.';
END $verify$;

COMMIT;
