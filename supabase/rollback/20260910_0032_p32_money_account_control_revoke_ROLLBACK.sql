-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0032_p32_money_account_control_revoke.sql
-- Identical stem, as required. Eleven objects.
--
-- ⚠ READ THIS BEFORE RUNNING IT.
--
-- EXECUTING THIS FILE REOPENS anon EXECUTE ON ELEVEN MONEY AND ACCOUNT
-- CONTROL FUNCTIONS.
--
--   admin_delete_auth_user            admin_purge_orphan_user_data
--   admin_reject_wallet_transaction   admin_wallet_credit
--   approve_deposit                   create_pending_deposit
--   expire_gift_credit                request_withdrawal
--   soft_void_wallet_transactions     wallet_ledger_apply_v2
--   wallet_transaction
--
-- Every one of them is SECURITY DEFINER, so it runs with its owner's rights,
-- and `postgres` on Supabase is BYPASSRLS. Every one of them is VOLATILE and
-- moves money, credits, debits, or destroys account data. After this file
-- runs, an unauthenticated visitor holds EXECUTE on all eleven, and the only
-- thing between them and the effect is whatever check each body happens to
-- perform. That is the state this rollback restores. It is the state staging
-- is in today, and it is not a state production has ever been asked to be in.
--
-- THE STAGING LANE GUARD BELOW IS THEREFORE MANDATORY, AND IT IS NOT
-- DECORATION.
--
-- ── WHY THE APPLY IS TWO-LANE AND THIS FILE IS NOT ────────────────────────
--
-- 0032 closes a door, so it is meant for staging AND production, and its
-- assertion accepts either. This file OPENS that door, so it is meant for
-- staging only and its guard accepts nothing else. The two files deliberately
-- carry different assertions, and neither form should be copied into the
-- other.
--
-- The production hazard is concrete, not theoretical. The Auditor's two-lane
-- diff records that ten of the eleven are ALREADY closed to anon on
-- production, and that the eleventh — request_withdrawal(numeric, jsonb) —
-- never held PUBLIC there at all. Running this file on production would grant
-- anon EXECUTE on functions that have never had it. That is the recorded
-- UNAPPLIED_0023 hazard, on eleven money functions.
--
-- ── WHAT IT RESTORES, AND WHAT IT DOES NOT ────────────────────────────────
--
-- Restores: EXECUTE to `anon`, BY NAME, on the eleven.
--
-- NEVER `TO PUBLIC`. 0032's postcondition asserts zero PUBLIC ACL entries, and
-- this file's postcondition asserts the same thing again after granting. A
-- PUBLIC grant here would not restore the pre-state — it would recreate the
-- very F-62 shape that made `REVOKE … FROM anon` a no-op in the first place,
-- and it would be invisible to any future revoke that named anon alone.
--
-- Does not touch: `authenticated` · `service_role` · `postgres` · any
-- function body · any COMMENT. 0032 granted authenticated and service_role
-- explicitly and this file leaves those grants exactly where it found them,
-- because they were never what 0032 took away.
--
-- ── RE-RUNNABLE, AND IT REFUSES WHEN THERE IS NOTHING TO UNDO ─────────────
--
-- The precondition requires 0032's post-state: anon without EXECUTE, no
-- PUBLIC entry, authenticated and service_role holding EXECUTE. Run against
-- the pre-0032 state it refuses rather than silently granting something that
-- is already granted, so "it did nothing" and "it did its job" are never the
-- same outcome.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. STAGING ONLY. ──────────────
-- Mechanism byte-identical to the #280-verified form; only the quoted
-- explanatory sentence is written for this file.
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback reopens anon EXECUTE on eleven SECURITY DEFINER money and '
      'account-control functions. On production ten of the eleven are already '
      'closed and the eleventh never held PUBLIC, so running it there would '
      'create an exposure that lane has never had. The file cannot detect its '
      'own lane, so it refuses unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — 0032's post-state must actually be in place. ───────────
DO $preconditions$
DECLARE
  sig   text;
  oid_  oid;
  pub_n int;
  n     int := 0;
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
      RAISE EXCEPTION 'P32-0032-RB-PRE-001: % does not exist with that exact signature', sig
        USING ERRCODE = 'raise_exception';
    END IF;

    IF has_function_privilege('anon', oid_, 'EXECUTE') THEN
      RAISE EXCEPTION
        'P32-0032-RB-PRE-002: anon already holds EXECUTE on %, so 0032 is not in '
        'effect and there is nothing for this file to roll back', sig
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT count(*) INTO pub_n
      FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = oid_ AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-0032-RB-PRE-003: % still has a PUBLIC ACL entry', sig
        USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT has_function_privilege('authenticated', oid_, 'EXECUTE')
    OR NOT has_function_privilege('service_role', oid_, 'EXECUTE') THEN
      RAISE EXCEPTION
        'P32-0032-RB-PRE-004: authenticated or service_role is missing EXECUTE on %, '
        'which is not 0032''s post-state', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 11 THEN
    RAISE EXCEPTION 'P32-0032-RB-PRE-005: expected 11 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE RESTORATION — anon, by name. Never TO PUBLIC. ─────────────────────

GRANT EXECUTE ON FUNCTION public.admin_delete_auth_user(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_orphan_user_data(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.approve_deposit(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.expire_gift_credit(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) TO anon;

-- ── POSTCONDITION — anon has EXECUTE, and PUBLIC still has nothing. ───────
-- The second half is the one that catches a TO PUBLIC slip: a PUBLIC entry
-- would satisfy "anon can execute" and would be wrong.
DO $postconditions$
DECLARE
  sig   text;
  oid_  oid;
  pub_n int;
  n     int := 0;
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

    IF NOT has_function_privilege('anon', oid_, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0032-RB-POST-001: anon did not regain EXECUTE on %', sig
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT count(*) INTO pub_n
      FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = oid_ AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION
        'P32-0032-RB-POST-002: % acquired a PUBLIC ACL entry. This file grants to '
        'anon BY NAME and must never grant to PUBLIC', sig
        USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT has_function_privilege('authenticated', oid_, 'EXECUTE')
    OR NOT has_function_privilege('service_role', oid_, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0032-RB-POST-003: authenticated or service_role lost EXECUTE on %', sig
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 11 THEN
    RAISE EXCEPTION 'P32-0032-RB-POST-004: expected 11 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
