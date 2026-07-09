-- Internal schema/backfill migration: bypass only the round-lock trigger while
-- attaching explicit round ownership to historical judge tag rows.
SELECT set_config('app.bypass_round_lock', 'on', true);

ALTER TABLE public.judge_tag_assignments
  ADD COLUMN IF NOT EXISTS round_number integer;

UPDATE public.judge_tag_assignments jta
SET round_number = COALESCE(
  m.round_number,
  CASE
    WHEN array_length(t.visible_in_round, 1) = 1 THEN t.visible_in_round[1]
    ELSE NULL
  END
)
FROM public.judging_tags t
LEFT JOIN public.system_tag_decision_map m ON m.tag_id = t.id
WHERE jta.tag_id = t.id
  AND jta.round_number IS NULL;

UPDATE public.judge_tag_assignments
SET round_number = 1
WHERE round_number IS NULL;

ALTER TABLE public.judge_tag_assignments
  ALTER COLUMN round_number SET NOT NULL;

ALTER TABLE public.judge_tag_assignments
  DROP CONSTRAINT IF EXISTS judge_tag_assignments_photo_index_check;

ALTER TABLE public.judge_tag_assignments
  ADD CONSTRAINT judge_tag_assignments_photo_index_check CHECK (photo_index >= 0);

ALTER TABLE public.judge_tag_assignments
  DROP CONSTRAINT IF EXISTS judge_tag_assignments_round_number_check;

ALTER TABLE public.judge_tag_assignments
  ADD CONSTRAINT judge_tag_assignments_round_number_check CHECK (round_number BETWEEN 1 AND 4);

ALTER TABLE public.judge_tag_assignments
  DROP CONSTRAINT IF EXISTS judge_tag_assignments_entry_tag_judge_photo_key;

DROP INDEX IF EXISTS public.uq_judge_tag_assignments_quad;

ALTER TABLE public.judge_tag_assignments
  ADD CONSTRAINT judge_tag_assignments_entry_tag_judge_round_photo_key
  UNIQUE (entry_id, tag_id, judge_id, round_number, photo_index);

CREATE OR REPLACE FUNCTION public.mirror_system_tag_to_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_map public.system_tag_decision_map%ROWTYPE;
  v_round_number integer;
BEGIN
  PERFORM set_config('app.bypass_round_lock', 'on', true);

  IF (TG_OP = 'INSERT') THEN
    SELECT * INTO v_map FROM public.system_tag_decision_map WHERE tag_id = NEW.tag_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    v_round_number := COALESCE(NEW.round_number, v_map.round_number);

    INSERT INTO public.judge_decisions
      (entry_id, judge_id, round_number, photo_index, decision, created_at, updated_at)
    VALUES
      (NEW.entry_id, NEW.judge_id, v_round_number, COALESCE(NEW.photo_index, 0),
       v_map.decision, now(), now())
    ON CONFLICT (entry_id, judge_id, round_number, photo_index)
      DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();

    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    SELECT * INTO v_map FROM public.system_tag_decision_map WHERE tag_id = OLD.tag_id;
    IF NOT FOUND THEN RETURN OLD; END IF;

    v_round_number := COALESCE(OLD.round_number, v_map.round_number);

    IF NOT EXISTS (
      SELECT 1
        FROM public.judge_tag_assignments jta
        JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
       WHERE jta.entry_id = OLD.entry_id
         AND jta.judge_id = OLD.judge_id
         AND COALESCE(jta.photo_index, 0) = COALESCE(OLD.photo_index, 0)
         AND COALESCE(jta.round_number, m.round_number) = v_round_number
         AND jta.tag_id <> OLD.tag_id
    ) THEN
      DELETE FROM public.judge_decisions
       WHERE entry_id = OLD.entry_id
         AND judge_id = OLD.judge_id
         AND round_number = v_round_number
         AND photo_index = COALESCE(OLD.photo_index, 0)
         AND decision = v_map.decision;
    END IF;

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;