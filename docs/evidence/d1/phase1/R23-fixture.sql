-- ── R-23 fixture · scratch PostgreSQL 17 only. ────────────────────────────
-- Eleven stub functions carrying the EXACT signatures measured on staging on
-- 2026-09-24, each SECURITY DEFINER and VOLATILE, each ending up with the
-- measured staging ACL:
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
-- The bodies are stubs on purpose: this unit is a grant change, and a body
-- that did real work would let a test pass or fail for a reason that has
-- nothing to do with the grant.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- A table only a definer function can reach, so "anon executed it" is
-- observable as an effect rather than only as a return value.
-- `who`    = the CALLER, read from the `role` GUC. current_user is deliberately
--            NOT used: inside a SECURITY DEFINER function current_user is the
--            OWNER, which is the whole property this unit is closing, so a
--            probe keyed on current_user records 'postgres' for every caller
--            and can never tell anon from anyone else.
-- `ran_as` = current_user, kept precisely to demonstrate that.
CREATE TABLE public.money_probe (id serial primary key, who text, ran_as text, fn text, at timestamptz default now());
REVOKE ALL ON TABLE public.money_probe FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_delete_auth_user(_uid uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'admin_delete_auth_user'); RETURN true; END $f$;

CREATE FUNCTION public.admin_purge_orphan_user_data(_uid uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'admin_purge_orphan_user_data'); RETURN true; END $f$;

CREATE FUNCTION public.admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'admin_reject_wallet_transaction'); RETURN true; END $f$;

CREATE FUNCTION public.admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'admin_wallet_credit'); RETURN true; END $f$;

CREATE FUNCTION public.approve_deposit(_admin_id uuid, _txn_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'approve_deposit'); RETURN true; END $f$;

CREATE FUNCTION public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'create_pending_deposit'); RETURN true; END $f$;

CREATE FUNCTION public.expire_gift_credit(_gift_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'expire_gift_credit'); RETURN true; END $f$;

CREATE FUNCTION public.request_withdrawal(_amount numeric, _bank_details jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'request_withdrawal'); RETURN true; END $f$;

CREATE FUNCTION public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'soft_void_wallet_transactions'); RETURN true; END $f$;

CREATE FUNCTION public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'wallet_ledger_apply_v2'); RETURN true; END $f$;

CREATE FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.money_probe(who, ran_as, fn) VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'wallet_transaction'); RETURN true; END $f$;

-- Reproduce the measured staging ACL exactly, granted AS postgres so every
-- grantor is postgres. CREATE FUNCTION already leaves EXECUTE to PUBLIC by the
-- built-in default (F-65), which is the '=X/postgres' entry; naming the three
-- roles materialises the rest.
DO $g$
DECLARE sig text;
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
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', sig);
  END LOOP;
END $g$;
