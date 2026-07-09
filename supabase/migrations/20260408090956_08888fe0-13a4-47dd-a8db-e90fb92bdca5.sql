
-- Trigger: Prevent self-voting at database level
CREATE OR REPLACE FUNCTION public.prevent_self_vote()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM competition_entries
    WHERE id = NEW.entry_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot vote on your own entry';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_vote ON public.competition_votes;
CREATE TRIGGER trg_prevent_self_vote
  BEFORE INSERT ON public.competition_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_vote();
