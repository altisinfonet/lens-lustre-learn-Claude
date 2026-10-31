CREATE OR REPLACE FUNCTION public.mirror_system_tag_to_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass        text;
  v_tag_id        uuid;
  v_tag_label     text;
  v_stage         public.v3_stage_catalog%ROWTYPE;
  v_entry_id      uuid;
  v_judge_id      uuid;
  v_round         integer;
  v_photo_idx     integer;
  v_op            text := TG_OP;
BEGIN
  BEGIN
    v_bypass := current_setting('app.bypass_mirror_trigger', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, entry_id, judge_id, round_number, photo_index)
    VALUES (
      v_op, 'bypassed',
      COALESCE(NEW.id, OLD.id),
      COALESCE(NEW.tag_id, OLD.tag_id),
      COALESCE(NEW.entry_id, OLD.entry_id),
      COALESCE(NEW.judge_id, OLD.judge_id),
      COALESCE(NEW.round_number, OLD.round_number),
      COALESCE(NEW.photo_index, OLD.photo_index, 0)
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_op = 'DELETE' THEN
    v_tag_id    := OLD.tag_id;
    v_entry_id  := OLD.entry_id;
    v_judge_id  := OLD.judge_id;
    v_round     := OLD.round_number;
    v_photo_idx := COALESCE(OLD.photo_index, 0);
  ELSE
    v_tag_id    := NEW.tag_id;
    v_entry_id  := NEW.entry_id;
    v_judge_id  := NEW.judge_id;
    v_round     := NEW.round_number;
    v_photo_idx := COALESCE(NEW.photo_index, 0);
  END IF;

  SELECT label INTO v_tag_label FROM public.judging_tags WHERE id = v_tag_id;

  IF v_tag_label IS NULL THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, entry_id, judge_id, round_number, photo_index, error_message)
    VALUES (v_op, 'noop', COALESCE(NEW.id, OLD.id), v_tag_id,
            v_entry_id, v_judge_id, v_round, v_photo_idx,
            'tag row not found in judging_tags');
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO v_stage
  FROM public.v3_stage_catalog
  WHERE is_active = true
    AND round_number = v_round
    AND lower(trim(tag_label_canonical)) = lower(trim(v_tag_label))
  LIMIT 1;

  IF v_stage.stage_key IS NULL THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, tag_label, entry_id, judge_id, round_number, photo_index)
    VALUES (v_op, 'noop', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
            v_entry_id, v_judge_id, v_round, v_photo_idx);
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_op = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.judge_tag_assignments other_jta
      JOIN public.judging_tags other_t ON other_t.id = other_jta.tag_id
      JOIN public.v3_stage_catalog other_s
        ON other_s.is_active = true
       AND other_s.round_number = other_jta.round_number
       AND lower(trim(other_s.tag_label_canonical)) = lower(trim(other_t.label))
      WHERE other_jta.entry_id = v_entry_id
        AND other_jta.judge_id = v_judge_id
        AND other_jta.round_number = v_round
        AND COALESCE(other_jta.photo_index, 0) = v_photo_idx
        AND other_jta.id <> OLD.id
    ) THEN
      DELETE FROM public.judge_decisions
       WHERE entry_id = v_entry_id
         AND judge_id = v_judge_id
         AND round_number = v_round
         AND COALESCE(photo_index, 0) = v_photo_idx;

      INSERT INTO public.v3_mirror_log
        (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
         entry_id, judge_id, round_number, photo_index, decision_token)
      VALUES (v_op, 'delete', OLD.id, v_tag_id, v_tag_label, v_stage.stage_key,
              v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);
    ELSE
      INSERT INTO public.v3_mirror_log
        (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
         entry_id, judge_id, round_number, photo_index, error_message)
      VALUES (v_op, 'noop', OLD.id, v_tag_id, v_tag_label, v_stage.stage_key,
              v_entry_id, v_judge_id, v_round, v_photo_idx,
              'sibling system tag still present; preserving decision');
    END IF;

    RETURN OLD;
  END IF;

  -- ============================================================
  -- Phase 2 change: also persist canonical stage_key
  -- ============================================================
  INSERT INTO public.judge_decisions
    (entry_id, judge_id, round_number, photo_index, decision, stage_key)
  VALUES
    (v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token, v_stage.stage_key)
  ON CONFLICT (entry_id, judge_id, round_number, photo_index)
  DO UPDATE
    SET decision   = EXCLUDED.decision,
        stage_key  = EXCLUDED.stage_key,
        updated_at = now();

  INSERT INTO public.v3_mirror_log
    (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
     entry_id, judge_id, round_number, photo_index, decision_token)
  VALUES (v_op, 'upsert', NEW.id, v_tag_id, v_tag_label, v_stage.stage_key,
          v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.v3_mirror_log
    (trigger_op, action, source_tag_id, tag_id, tag_label,
     entry_id, judge_id, round_number, photo_index, error_message)
  VALUES (v_op, 'error', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
          v_entry_id, v_judge_id, v_round, v_photo_idx, SQLERRM);
  RETURN COALESCE(NEW, OLD);
END;
$function$;