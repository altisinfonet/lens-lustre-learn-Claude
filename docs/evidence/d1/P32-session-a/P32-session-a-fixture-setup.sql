-- Disposable fixture: create anon/authenticated/service_role/supabase_auth_admin
-- roles and stub tables/functions reproducing the MEASURED live ACL shape
-- (PUBLIC holds EXECUTE, same as every one of these on live staging today)
-- for all 18 functions touched by 0027/0028/0029, so the migration files can
-- be run and probed exactly as they will run in CI, with a real fail-before /
-- pass-after transcript. Bodies are stubs; only signature, SECURITY DEFINER,
-- volatility, and the starting ACL matter for this test (F-62/F-65/F-66 are
-- grant-layer, not body-layer, findings).

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, supabase_auth_admin;

CREATE TABLE public.auth_login_attempts (
  user_id uuid PRIMARY KEY, failed_count int DEFAULT 0, last_attempt timestamptz, locked_until timestamptz
);
CREATE TABLE public.user_roles (user_id uuid, role text);

-- 0027 money/account-control (11)
CREATE FUNCTION public.admin_delete_auth_user(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.admin_purge_orphan_user_data(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.admin_reject_wallet_transaction(uuid, uuid, text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.approve_deposit(uuid, uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.create_pending_deposit(uuid, numeric, text, text, jsonb, text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.expire_gift_credit(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.request_withdrawal(numeric, jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.soft_void_wallet_transactions(uuid[], text, uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;

-- 0028 identity group part 2 (5)
CREATE FUNCTION public.admin_search_users(text, text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.admin_search_users_v2(text, text, text, text, integer, integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.admin_list_certificates(text, text, integer, integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.admin_search_certificate_recipients(text, integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE FUNCTION public.generate_custom_url(text, uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;

-- 0029 auth-hook + role enum (2)
CREATE FUNCTION public.password_verification_hook(jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.get_public_role_user_ids(text) RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF $1 NOT IN ('admin','judge') THEN RAISE EXCEPTION 'role % is not enumerable', $1 USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT ur.user_id FROM public.user_roles ur WHERE ur.role::text = $1;
END; $$;

-- Reproduce the MEASURED starting state: PUBLIC + anon + authenticated (+
-- supabase_auth_admin for the hook) all hold EXECUTE, matching every one of
-- the 18 live proacl reads taken this session (2026-09-21).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'admin_delete_auth_user','admin_purge_orphan_user_data','admin_reject_wallet_transaction',
        'admin_wallet_credit','approve_deposit','create_pending_deposit','expire_gift_credit',
        'request_withdrawal','soft_void_wallet_transactions','wallet_ledger_apply_v2','wallet_transaction',
        'admin_search_users','admin_search_users_v2','admin_list_certificates',
        'admin_search_certificate_recipients','generate_custom_url',
        'password_verification_hook','get_public_role_user_ids')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION public.password_verification_hook(jsonb) TO supabase_auth_admin;

-- Confirm the fail-before state exists (would make PROBE files fail if run now).
SELECT 'fixture ready, starting ACL:' AS note;
SELECT proname, proacl FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
  ('admin_delete_auth_user','password_verification_hook','get_public_role_user_ids') ORDER BY 1;

-- Correction: on LIVE staging, service_role holds its OWN named grant on the
-- 11 money-group functions, separate from PUBLIC (confirmed via the live
-- proacl string quoted in 20260910_0027's own header:
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
--  service_role=X/postgres}). The first fixture pass omitted this explicit
-- grant and only let service_role inherit through PUBLIC, which is why the
-- money-group PROBE's C4 (no-over-revoke) assertion correctly caught a
-- MISMATCH BETWEEN THE FIXTURE AND LIVE REALITY, not a defect in the
-- migration. Re-stating it here to match measured live reality.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'admin_delete_auth_user','admin_purge_orphan_user_data','admin_reject_wallet_transaction',
        'admin_wallet_credit','approve_deposit','create_pending_deposit','expire_gift_credit',
        'request_withdrawal','soft_void_wallet_transactions','wallet_ledger_apply_v2','wallet_transaction')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$$;
