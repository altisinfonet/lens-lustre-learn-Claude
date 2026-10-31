-- 1) competition_orders table
CREATE SEQUENCE IF NOT EXISTS public.competition_order_no_seq;

CREATE TABLE IF NOT EXISTS public.competition_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  order_type text NOT NULL DEFAULT 'photo_competition',
  amount numeric NOT NULL,
  wallet_txn_id uuid REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competition_orders_user_created
  ON public.competition_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_competition_orders_competition
  ON public.competition_orders (competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_orders_status
  ON public.competition_orders (status);

ALTER TABLE public.competition_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_orders" ON public.competition_orders;
CREATE POLICY "users_read_own_orders"
  ON public.competition_orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins_read_all_orders" ON public.competition_orders;
CREATE POLICY "admins_read_all_orders"
  ON public.competition_orders FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- updated_at trigger (inline)
CREATE OR REPLACE FUNCTION public._set_competition_orders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_orders_updated_at ON public.competition_orders;
CREATE TRIGGER trg_competition_orders_updated_at
  BEFORE UPDATE ON public.competition_orders
  FOR EACH ROW EXECUTE FUNCTION public._set_competition_orders_updated_at();

-- 2) Order number generator
CREATE OR REPLACE FUNCTION public._gen_competition_order_no()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _seq bigint;
BEGIN
  _seq := nextval('public.competition_order_no_seq');
  RETURN 'ORD-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || lpad(_seq::text, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION public._gen_competition_order_no() FROM PUBLIC, anon, authenticated;

-- 3) Atomic submit_competition_entry RPC
CREATE OR REPLACE FUNCTION public.submit_competition_entry(
  _competition_id uuid,
  _title text,
  _description text,
  _photos text[],
  _photo_thumbnails text[],
  _photo_meta jsonb,
  _is_ai_generated boolean,
  _exif_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _entry_fee numeric;
  _comp_phase text;
  _wallet_balance numeric;
  _new_balance numeric;
  _txn_id uuid;
  _entry_id uuid;
  _order_id uuid;
  _order_no text;
  _n int;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  _n := COALESCE(array_length(_photos, 1), 0);
  IF _n = 0 THEN
    RAISE EXCEPTION 'At least one photo is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_photo_meta) <> _n THEN
    RAISE EXCEPTION 'photo_meta length (%) must match photos length (%)',
      jsonb_array_length(_photo_meta), _n USING ERRCODE = '22023';
  END IF;
  IF _photo_thumbnails IS NOT NULL
     AND COALESCE(array_length(_photo_thumbnails, 1), 0) <> _n THEN
    RAISE EXCEPTION 'photo_thumbnails length must match photos length' USING ERRCODE = '22023';
  END IF;

  SELECT entry_fee, phase INTO _entry_fee, _comp_phase
  FROM public.competitions
  WHERE id = _competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found' USING ERRCODE = '22023';
  END IF;
  IF _comp_phase <> 'submission_open' THEN
    RAISE EXCEPTION 'Submissions are closed for this competition' USING ERRCODE = '22023';
  END IF;

  _entry_fee := COALESCE(_entry_fee, 0);

  IF _entry_fee > 0 THEN
    INSERT INTO public.wallets (user_id, balance)
    VALUES (_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance INTO _wallet_balance
    FROM public.wallets
    WHERE user_id = _user_id
    FOR UPDATE;

    IF _wallet_balance < _entry_fee THEN
      RAISE EXCEPTION 'Insufficient wallet balance: need $% but have $%',
        _entry_fee, _wallet_balance USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.wallets
       SET balance = balance - _entry_fee,
           updated_at = now()
     WHERE user_id = _user_id
     RETURNING balance INTO _new_balance;

    INSERT INTO public.wallet_transactions
      (user_id, type, amount, balance_after, description, reference_id, reference_type, status, metadata)
    VALUES
      (_user_id, 'competition_fee', -_entry_fee, _new_balance,
       'Entry fee for competition',
       _competition_id, 'competition_entry_fee', 'completed',
       jsonb_build_object('source', 'submit_competition_entry'))
    RETURNING id INTO _txn_id;
  END IF;

  INSERT INTO public.competition_entries
    (competition_id, user_id, title, description, photos, photo_thumbnails,
     photo_meta, is_ai_generated, exif_data, is_ai_advisory, ai_detection_result)
  VALUES
    (_competition_id, _user_id, _title, _description, _photos, _photo_thumbnails,
     _photo_meta, COALESCE(_is_ai_generated, false), _exif_data, false, NULL)
  RETURNING id INTO _entry_id;

  _order_no := public._gen_competition_order_no();
  INSERT INTO public.competition_orders
    (order_no, user_id, competition_id, entry_id, order_type, amount, wallet_txn_id, status, metadata)
  VALUES
    (_order_no, _user_id, _competition_id, _entry_id, 'photo_competition',
     _entry_fee, _txn_id, 'completed',
     jsonb_build_object('phase', _comp_phase))
  RETURNING id INTO _order_id;

  RETURN jsonb_build_object(
    'entry_id',  _entry_id,
    'order_id',  _order_id,
    'order_no',  _order_no,
    'wallet_txn_id', _txn_id,
    'amount',    _entry_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_competition_entry(uuid, text, text, text[], text[], jsonb, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_competition_entry(uuid, text, text, text[], text[], jsonb, boolean, jsonb) TO authenticated;