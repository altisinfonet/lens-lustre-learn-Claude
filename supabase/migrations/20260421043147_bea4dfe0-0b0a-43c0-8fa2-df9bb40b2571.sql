-- Drop the older 7-arg overload of admin_wallet_credit.
-- The 8-arg version (with _metadata jsonb) is retained as the canonical function.
-- This eliminates the PostgREST PGRST203 ambiguity that caused admin gift credits to silently no-op.
DROP FUNCTION IF EXISTS public.admin_wallet_credit(
  _admin_id uuid,
  _target_user_id uuid,
  _amount numeric,
  _type text,
  _description text,
  _reference_id uuid,
  _reference_type text
);