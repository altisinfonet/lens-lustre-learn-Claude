
-- Auto-create 4 fixed judging rounds when a competition is inserted
CREATE OR REPLACE FUNCTION public.auto_create_judging_rounds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.judging_rounds (competition_id, round_number, name, status)
  VALUES
    (NEW.id, 1, 'Initial Screening', 'pending'),
    (NEW.id, 2, 'Round 2', 'pending'),
    (NEW.id, 3, 'Round 3', 'pending'),
    (NEW.id, 4, 'Final Round', 'pending');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_rounds ON public.competitions;
CREATE TRIGGER trg_auto_create_rounds
  AFTER INSERT ON public.competitions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_judging_rounds();
