-- ============================================================================
-- Phase 3 — Trigger Hardening (Master Fix Plan)
-- Adds a server-side alias resolver mirroring the client LABEL_ALIASES map.
-- ============================================================================

-- 1. Alias table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v3_tag_label_alias (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alias_label          text        NOT NULL,
  round_number         integer     NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  canonical_stage_key  text        NOT NULL REFERENCES public.v3_stage_catalog(stage_key) ON UPDATE CASCADE,
  notes                text        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS v3_tag_label_alias_unique
  ON public.v3_tag_label_alias (round_number, lower(trim(alias_label)));

CREATE INDEX IF NOT EXISTS v3_tag_label_alias_lookup_idx
  ON public.v3_tag_label_alias (lower(trim(alias_label)));

ALTER TABLE public.v3_tag_label_alias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v3_tag_label_alias_select_all   ON public.v3_tag_label_alias;
DROP POLICY IF EXISTS v3_tag_label_alias_admin_write  ON public.v3_tag_label_alias;

CREATE POLICY v3_tag_label_alias_select_all
  ON public.v3_tag_label_alias FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY v3_tag_label_alias_admin_write
  ON public.v3_tag_label_alias FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS trg_v3_tag_label_alias_touch ON public.v3_tag_label_alias;
CREATE TRIGGER trg_v3_tag_label_alias_touch
  BEFORE UPDATE ON public.v3_tag_label_alias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- 2. Seed aliases (mirrors src/hooks/judging/tagLabelToDecision.ts) ----------
-- Canonical labels themselves are NOT inserted here — direct catalog hit
-- handles them. Only legacy / shorthand strings.
INSERT INTO public.v3_tag_label_alias (alias_label, round_number, canonical_stage_key, notes) VALUES
  -- R1
  ('Reject',                       1, 'r1_rejected',        'shorthand'),
  ('Accept',                       1, 'r1_accepted',        'shorthand'),
  ('Accept for Round 1',           1, 'r1_accepted',        'judge button'),
  ('Shortlist for Round 2',        1, 'r1_shortlisted_r2',  'shorthand'),
  -- R2
  ('Accept for Round 2',           2, 'r2_accepted',        'judge button'),
  ('Shortlist for Round 3',        2, 'r2_qualified_r3',    'shorthand'),
  ('Qualified for R3',             2, 'r2_qualified_r3',    'shorthand'),
  ('Qualified for 3rd Round',      2, 'r2_qualified_r3',    'legacy label'),
  ('Not Selected for R3',          2, 'r2_not_selected_r3', 'shorthand'),
  ('Not Selected for Round 3',     2, 'r2_not_selected_r3', 'shorthand'),
  -- R3
  ('Shortlist for Final',          3, 'r3_qualified_final', 'shorthand'),
  ('Shortlisted for Final',        3, 'r3_qualified_final', 'shorthand'),
  ('Qualified for Final',          3, 'r3_qualified_final', 'legacy label'),
  ('Not Selected for Final',       3, 'r3_not_selected_final', 'shorthand')
ON CONFLICT (round_number, lower(trim(alias_label))) DO NOTHING;

-- 3. Harden mirror trigger ---------------------------------------------------
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
  v_alias_key     text;
  v_resolved_via  text := 'direct';
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

  -- Step A: direct catalog hit (unchanged behaviour) -----------------------
  SELECT * INTO v_stage
  FROM public.v3_stage_catalog
  WHERE is_active = true
    AND round_number = v_round
    AND lower(trim(tag_label_canonical)) = lower(trim(v_tag_label))
  LIMIT 1;

  -- Step B: alias fallback --------------------------------------------------
  IF v_stage.stage_key IS NULL THEN
    SELECT canonical_stage_key INTO v_alias_key
    FROM public.v3_tag_label_alias
    WHERE round_number = v_round
      AND lower(trim(alias_label)) = lower(trim(v_tag_label))
    LIMIT 1;

    IF v_alias_key IS NOT NULL THEN
      SELECT * INTO v_stage
      FROM public.v3_stage_catalog
      WHERE stage_key = v_alias_key
        AND is_active = true
      LIMIT 1;
      IF v_stage.stage_key IS NOT NULL THEN
        v_resolved_via := 'alias';
        INSERT INTO public.v3_mirror_log
          (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
           entry_id, judge_id, round_number, photo_index, decision_token)
        VALUES (v_op, 'alias_resolved', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
                v_stage.stage_key, v_entry_id, v_judge_id, v_round, v_photo_idx,
                v_stage.decision_token);
      END IF;
    END IF;
  END IF;

  IF v_stage.stage_key IS NULL THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, tag_label, entry_id, judge_id,
       round_number, photo_index, error_message)
    VALUES (v_op, 'noop_alias_miss', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
            v_entry_id, v_judge_id, v_round, v_photo_idx,
            'no direct catalog hit and no alias entry');
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_op = 'DELETE' THEN
    IF v_round = 4 THEN
      DELETE FROM public.judge_award_tags
       WHERE entry_id     = v_entry_id
         AND judge_id     = v_judge_id
         AND round_number = v_round
         AND photo_index  = v_photo_idx
         AND stage_key    = v_stage.stage_key;

      INSERT INTO public.v3_mirror_log
        (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
         entry_id, judge_id, round_number, photo_index, decision_token)
      VALUES (v_op, 'r4_award_delete', OLD.id, v_tag_id, v_tag_label, v_stage.stage_key,
              v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.judge_tag_assignments other_jta
      JOIN public.judging_tags other_t ON other_t.id = other_jta.tag_id
      LEFT JOIN public.v3_stage_catalog other_s
        ON other_s.is_active = true
       AND other_s.round_number = other_jta.round_number
       AND lower(trim(other_s.tag_label_canonical)) = lower(trim(other_t.label))
      LEFT JOIN public.v3_tag_label_alias other_a
        ON other_a.round_number = other_jta.round_number
       AND lower(trim(other_a.alias_label)) = lower(trim(other_t.label))
      WHERE other_jta.entry_id = v_entry_id
        AND other_jta.judge_id = v_judge_id
        AND other_jta.round_number = v_round
        AND COALESCE(other_jta.photo_index, 0) = v_photo_idx
        AND other_jta.id <> OLD.id
        AND (other_s.stage_key IS NOT NULL OR other_a.canonical_stage_key IS NOT NULL)
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

  IF v_round = 4 THEN
    INSERT INTO public.judge_award_tags
      (entry_id, judge_id, round_number, photo_index,
       stage_key, decision_token, tag_label, tag_id, source_assignment_id)
    VALUES
      (v_entry_id, v_judge_id, v_round, v_photo_idx,
       v_stage.stage_key, v_stage.decision_token, v_tag_label, v_tag_id, NEW.id)
    ON CONFLICT (entry_id, judge_id, round_number, photo_index, stage_key)
    DO UPDATE
      SET decision_token       = EXCLUDED.decision_token,
          tag_label            = EXCLUDED.tag_label,
          tag_id               = EXCLUDED.tag_id,
          source_assignment_id = EXCLUDED.source_assignment_id,
          updated_at           = now();

    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
       entry_id, judge_id, round_number, photo_index, decision_token)
    VALUES (v_op, 'r4_award_upsert', NEW.id, v_tag_id, v_tag_label, v_stage.stage_key,
            v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);
  END IF;

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
  VALUES (v_op,
          CASE WHEN v_resolved_via = 'alias' THEN 'upsert_via_alias' ELSE 'upsert' END,
          NEW.id, v_tag_id, v_tag_label, v_stage.stage_key,
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