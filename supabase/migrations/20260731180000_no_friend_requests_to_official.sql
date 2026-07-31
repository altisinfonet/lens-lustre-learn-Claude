-- ============================================================================
-- POLICY: the official / admin account is FOLLOW-ONLY. It can never be sent a
-- friend request. (Owner’s standing rule; reported broken 2026-07-31.)
--
-- WHY THIS EXISTS AT THE DATABASE LEVEL
--   The rule was implemented only in `useFriendFollow` (the profile buttons).
--   The feed’s new "Add friend" button called the mutation directly and skipped
--   that check, so real friend requests reached the official account. A UI-only
--   rule is not a rule. This trigger is the final authority — every path,
--   present and future, now hits it.
--
-- Defence in depth: UI hides the button (friend_state = 'unavailable'),
-- the mutation refuses to send, and this trigger rejects the row.
--
-- Adds one function + one trigger. Nothing is dropped, no data is modified.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.block_friend_requests_to_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = NEW.addressee_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'This account is follow-only and does not accept friend requests'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_friend_requests_to_admins ON public.friendships;
CREATE TRIGGER trg_block_friend_requests_to_admins
BEFORE INSERT ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.block_friend_requests_to_admins();

-- ---------------------------------------------------------------------------
-- OPTIONAL CLEANUP — READ BEFORE RUNNING. This DELETES data.
--
-- Friend requests that already reached the official account while the rule was
-- unenforced. Run the SELECT first to see exactly what would go; run the DELETE
-- only if the owner agrees. It is commented out on purpose — nothing is deleted
-- by applying this migration.
--
--   SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_at
--   FROM public.friendships f
--   JOIN public.user_roles r ON r.user_id = f.addressee_id AND r.role = 'admin';
--
--   DELETE FROM public.friendships f
--   USING public.user_roles r
--   WHERE r.user_id = f.addressee_id AND r.role = 'admin';
--
-- Note: following is unaffected — follows live in a different table and the
-- official account is meant to be followed.
-- ---------------------------------------------------------------------------
