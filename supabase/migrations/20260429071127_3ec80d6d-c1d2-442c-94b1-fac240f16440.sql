-- =====================================================================
-- Phase R1 — REPAIR: Tag→Decision mirror trigger (no backfill)
-- =====================================================================
-- The mapping table system_tag_decision_map is already seeded.
-- Drift between judge_tag_assignments and judge_decisions is currently 0,
-- so no backfill is necessary. From now on, this trigger keeps them
-- mathematically in sync.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mirror_system_tag_to_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision text;
  v_old_decision text;
  v_surviving_decision text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT decision INTO v_decision
      FROM public.system_tag_decision_map
     WHERE tag_id = NEW.tag_id
       AND round_number = NEW.round_number;

    IF v_decision IS NULL OR v_decision = 'needs_review' THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.judge_decisions
      (entry_id, judge_id, round_number, photo_index, decision)
    VALUES
      (NEW.entry_id, NEW.judge_id, NEW.round_number, NEW.photo_index, v_decision)
    ON CONFLICT (entry_id, judge_id, round_number, photo_index)
      DO UPDATE SET decision = EXCLUDED.decision,
                    updated_at = now();
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    SELECT decision INTO v_old_decision
      FROM public.system_tag_decision_map
     WHERE tag_id = OLD.tag_id
       AND round_number = OLD.round_number;

    IF v_old_decision IS NULL OR v_old_decision = 'needs_review' THEN
      RETURN OLD;
    END IF;

    SELECT m.decision INTO v_surviving_decision
      FROM public.judge_tag_assignments jta
      JOIN public.system_tag_decision_map m
        ON m.tag_id = jta.tag_id
       AND m.round_number = jta.round_number
     WHERE jta.entry_id = OLD.entry_id
       AND jta.judge_id = OLD.judge_id
       AND jta.round_number = OLD.round_number
       AND jta.photo_index = OLD.photo_index
       AND jta.id <> OLD.id
       AND m.decision <> 'needs_review'
     ORDER BY jta.created_at DESC
     LIMIT 1;

    IF v_surviving_decision IS NOT NULL THEN
      UPDATE public.judge_decisions
         SET decision = v_surviving_decision,
             updated_at = now()
       WHERE entry_id = OLD.entry_id
         AND judge_id = OLD.judge_id
         AND round_number = OLD.round_number
         AND photo_index = OLD.photo_index;
    ELSE
      DELETE FROM public.judge_decisions
       WHERE entry_id = OLD.entry_id
         AND judge_id = OLD.judge_id
         AND round_number = OLD.round_number
         AND photo_index = OLD.photo_index;
    END IF;
    RETURN OLD;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.tag_id IS DISTINCT FROM NEW.tag_id
       OR OLD.entry_id IS DISTINCT FROM NEW.entry_id
       OR OLD.judge_id IS DISTINCT FROM NEW.judge_id
       OR OLD.round_number IS DISTINCT FROM NEW.round_number
       OR OLD.photo_index IS DISTINCT FROM NEW.photo_index
    THEN
      SELECT decision INTO v_decision
        FROM public.system_tag_decision_map
       WHERE tag_id = NEW.tag_id
         AND round_number = NEW.round_number;

      IF v_decision IS NOT NULL AND v_decision <> 'needs_review' THEN
        INSERT INTO public.judge_decisions
          (entry_id, judge_id, round_number, photo_index, decision)
        VALUES
          (NEW.entry_id, NEW.judge_id, NEW.round_number, NEW.photo_index, v_decision)
        ON CONFLICT (entry_id, judge_id, round_number, photo_index)
          DO UPDATE SET decision = EXCLUDED.decision,
                        updated_at = now();
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_system_tag_to_decision ON public.judge_tag_assignments;
CREATE TRIGGER trg_mirror_system_tag_to_decision
AFTER INSERT OR UPDATE OR DELETE ON public.judge_tag_assignments
FOR EACH ROW EXECUTE FUNCTION public.mirror_system_tag_to_decision();