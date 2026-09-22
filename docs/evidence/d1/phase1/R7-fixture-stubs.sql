-- Stub functions carrying the EXACT signatures the R-7 migrations target.
-- Bodies are irrelevant to an ACL test and are deliberately trivial: this
-- fixture proves grant mechanics, not behaviour.
CREATE OR REPLACE FUNCTION public.admin_delete_auth_user(_uid uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.admin_purge_orphan_user_data(_uid uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.admin_reject_wallet_transaction(_admin_id uuid, _txn_id uuid, _reason text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.admin_wallet_credit(_admin_id uuid, _target_user_id uuid, _amount numeric, _type text, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT gen_random_uuid() $$;
CREATE OR REPLACE FUNCTION public.approve_deposit(_admin_id uuid, _txn_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT gen_random_uuid() $$;
CREATE OR REPLACE FUNCTION public.expire_gift_credit(_gift_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 0 $$;
CREATE OR REPLACE FUNCTION public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT gen_random_uuid() $$;
CREATE OR REPLACE FUNCTION public.request_withdrawal(_amount numeric, _bank_details jsonb) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT gen_random_uuid() $$;
CREATE OR REPLACE FUNCTION public.admin_list_certificates(_query text, _type text, _limit integer, _offset integer) RETURNS SETOF record LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE OR REPLACE FUNCTION public.admin_search_certificate_recipients(_query text, _limit integer) RETURNS SETOF record LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE OR REPLACE FUNCTION public.admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer) RETURNS SETOF record LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE OR REPLACE FUNCTION public.generate_custom_url(_full_name text, _user_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'x'::text $$;
CREATE OR REPLACE FUNCTION public.admin_search_users(search_query text, search_by text) RETURNS SETOF record LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
CREATE OR REPLACE FUNCTION public.password_verification_hook(event jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
-- CANARY — not in any R-7 unit. Its ACL must be byte-identical at every step.
-- This is how "no unrelated object affected" is proved rather than asserted.
CREATE OR REPLACE FUNCTION public.r7_canary_untouched(_x text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT _x $$;
