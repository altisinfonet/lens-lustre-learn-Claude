CREATE OR REPLACE FUNCTION public.sync_competition_result_state_from_round_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.round_number = 4 THEN
    IF NEW.published_at IS NOT NULL THEN
      UPDATE public.competitions
      SET
        current_round = '4',
        phase = 'result',
        status = 'result',
        judging_completed = true,
        updated_at = now()
      WHERE id = NEW.competition_id
        AND (
          current_round IS DISTINCT FROM '4'
          OR phase IS DISTINCT FROM 'result'
          OR status IS DISTINCT FROM 'result'
          OR judging_completed IS DISTINCT FROM true
        );
    ELSE
      UPDATE public.competitions c
      SET
        phase = 'judging',
        status = 'judging',
        judging_completed = false,
        updated_at = now()
      WHERE c.id = NEW.competition_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.competition_round_publish crp
          WHERE crp.competition_id = NEW.competition_id
            AND crp.round_number = 4
            AND crp.published_at IS NOT NULL
        )
        AND c.phase = 'result'
        AND c.status = 'result'
        AND c.judging_completed = true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_competition_result_state_from_round_publish ON public.competition_round_publish;

CREATE TRIGGER trg_sync_competition_result_state_from_round_publish
AFTER INSERT OR UPDATE OF published_at ON public.competition_round_publish
FOR EACH ROW
EXECUTE FUNCTION public.sync_competition_result_state_from_round_publish();

UPDATE public.competitions c
SET
  current_round = '4',
  phase = 'result',
  status = 'result',
  judging_completed = true,
  updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM public.competition_round_publish crp
  WHERE crp.competition_id = c.id
    AND crp.round_number = 4
    AND crp.published_at IS NOT NULL
)
AND (
  c.current_round IS DISTINCT FROM '4'
  OR c.phase IS DISTINCT FROM 'result'
  OR c.status IS DISTINCT FROM 'result'
  OR c.judging_completed IS DISTINCT FROM true
);