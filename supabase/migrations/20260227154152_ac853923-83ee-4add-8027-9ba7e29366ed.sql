
-- Update competition entry rate limit: 500/hour
CREATE OR REPLACE FUNCTION public.rate_limit_competition_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.competition_entries
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 500 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 500 competition submissions per hour';
  END IF;

  RETURN NEW;
END;
$$;

-- Update image comments rate limit: 1500/hour
CREATE OR REPLACE FUNCTION public.rate_limit_image_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.image_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 1500 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 1500 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

-- Update post comments rate limit: 1500/hour
CREATE OR REPLACE FUNCTION public.rate_limit_post_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.post_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 1500 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 1500 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

-- Update article comments rate limit: 1500/hour
CREATE OR REPLACE FUNCTION public.rate_limit_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 1500 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 1500 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

-- Update wallet transaction rate limit: 2000/hour
CREATE OR REPLACE FUNCTION public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text DEFAULT NULL::text, _reference_id uuid DEFAULT NULL::uuid, _reference_type text DEFAULT NULL::text, _metadata jsonb DEFAULT NULL::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _wallet_id uuid;
  _new_balance numeric;
  _txn_id uuid;
  _recent_count integer;
BEGIN
  SELECT COUNT(*) INTO _recent_count
  FROM public.wallet_transactions
  WHERE user_id = _user_id
    AND created_at > now() - interval '1 hour';

  IF _recent_count >= 2000 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 2000 wallet transactions per hour';
  END IF;

  INSERT INTO public.wallets (user_id, balance)
  VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets
  SET balance = balance + _amount,
      updated_at = now()
  WHERE user_id = _user_id
  RETURNING balance INTO _new_balance;

  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, description, reference_id, reference_type, status, metadata)
  VALUES (_user_id, _type, _amount, _new_balance, _description, _reference_id, _reference_type, 'completed', _metadata)
  RETURNING id INTO _txn_id;

  RETURN _txn_id;
END;
$$;
