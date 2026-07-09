
-- 1. Allow users to view judge_comments on their own entries
CREATE POLICY "Users can view comments on own entries"
ON public.judge_comments FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.competition_entries
    WHERE competition_entries.id = judge_comments.entry_id
      AND competition_entries.user_id = auth.uid()
));

-- 2. Auto-generate certificate when entry status becomes 'winner'
CREATE OR REPLACE FUNCTION public.auto_certificate_on_winner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _comp_title text;
  _cert_exists boolean;
BEGIN
  IF NEW.status = 'winner' AND (OLD.status IS DISTINCT FROM 'winner') THEN
    SELECT EXISTS (
      SELECT 1 FROM public.certificates
      WHERE user_id = NEW.user_id
        AND reference_id = NEW.competition_id
        AND type = 'competition_winner'
    ) INTO _cert_exists;

    IF NOT _cert_exists THEN
      SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;

      INSERT INTO public.certificates (user_id, title, description, type, reference_id)
      VALUES (
        NEW.user_id,
        COALESCE(_comp_title, 'Competition') || ' — Winner Certificate',
        'Awarded winner in ' || COALESCE(_comp_title, 'competition'),
        'competition_winner',
        NEW.competition_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_certificate_winner
AFTER UPDATE ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.auto_certificate_on_winner();
