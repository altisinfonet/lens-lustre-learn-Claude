-- Function to get mutual friends count between two users
CREATE OR REPLACE FUNCTION public.mutual_friends_count(_user_a uuid, _user_b uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM friendships f1
  JOIN friendships f2 ON (
    CASE WHEN f1.requester_id = _user_a THEN f1.addressee_id ELSE f1.requester_id END
    =
    CASE WHEN f2.requester_id = _user_b THEN f2.addressee_id ELSE f2.requester_id END
  )
  WHERE f1.status = 'accepted'
    AND f2.status = 'accepted'
    AND (f1.requester_id = _user_a OR f1.addressee_id = _user_a)
    AND (f2.requester_id = _user_b OR f2.addressee_id = _user_b)
    AND CASE WHEN f1.requester_id = _user_a THEN f1.addressee_id ELSE f1.requester_id END != _user_a
    AND CASE WHEN f1.requester_id = _user_a THEN f1.addressee_id ELSE f1.requester_id END != _user_b;
$$;

-- Function to get mutual friend user IDs (limited)
CREATE OR REPLACE FUNCTION public.mutual_friend_ids(_user_a uuid, _user_b uuid, _limit integer DEFAULT 5)
RETURNS TABLE(friend_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN f1.requester_id = _user_a THEN f1.addressee_id ELSE f1.requester_id END AS friend_id
  FROM friendships f1
  JOIN friendships f2 ON (
    CASE WHEN f1.requester_id = _user_a THEN f1.addressee_id ELSE f1.requester_id END
    =
    CASE WHEN f2.requester_id = _user_b THEN f2.addressee_id ELSE f2.requester_id END
  )
  WHERE f1.status = 'accepted'
    AND f2.status = 'accepted'
    AND (f1.requester_id = _user_a OR f1.addressee_id = _user_a)
    AND (f2.requester_id = _user_b OR f2.addressee_id = _user_b)
    AND CASE WHEN f1.requester_id = _user_a THEN f1.addressee_id ELSE f1.requester_id END != _user_a
    AND CASE WHEN f1.requester_id = _user_a THEN f1.addressee_id ELSE f1.requester_id END != _user_b
  LIMIT _limit;
$$;