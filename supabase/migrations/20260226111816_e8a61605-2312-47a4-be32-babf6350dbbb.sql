
CREATE OR REPLACE FUNCTION public.admin_wallet_credit(
  _admin_id uuid,
  _target_user_id uuid,
  _amount numeric,
  _type text,
  _description text DEFAULT NULL,
  _reference_id uuid DEFAULT NULL,
  _reference_type text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can credit wallets';
  END IF;

  RETURN wallet_transaction(_target_user_id, _type, _amount, _description, _reference_id, _reference_type, _metadata);
END;
$$;
