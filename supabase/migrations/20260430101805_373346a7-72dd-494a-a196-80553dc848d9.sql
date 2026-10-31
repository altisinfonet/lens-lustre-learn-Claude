-- Step 1.3 — Mirror trigger: judge_tag_assignments → judge_decisions
-- Phase R1 of the Judging v3 forensic plan.
--
-- The trigger reads v3_stage_catalog (Step 1.2) and writes a matching
-- judge_decisions row whenever a system tag (one of the 16 catalog rows)
-- is added/removed/changed.
--
-- Bypass mechanism: set_config('app.bypass_mirror_trigger','on',true)
-- inside a transaction skips the trigger body. Used by Step 1.4 backfill
-- and any future quarantine maintenance.
--
-- Idempotent / safe to re-run: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.

-- ============ AUDIT TABLE ============
CREATE TABLE IF NOT EXISTS public.v3_mirror_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  trigger_op      text NOT NULL,                 -- 'INSERT' | 'UPDATE' | 'DELETE'
  action          text NOT NULL,                 -- 'upsert' | 'delete' | 'noop' | 'bypassed' | 'error'
  source_tag_id   uuid,                          -- judge_tag_assignments.id (NEW for INS/UPD, OLD for DEL)
  tag_id          uuid,                          -- judging_tags.id
  tag_label       text,                          -- snapshot of label for forensics
  matched_stage   text,                          -- v3_stage_catalog.stage_key (or NULL)
  entry_id        uuid,
  judge_id        uuid,
  round_number    integer,
  photo_index     integer,
  decision_token  text,                          -- what was written (NULL if noop/bypassed)
  error_message   text,
  CONSTRAINT v3_mirror_log_action_chk
    CHECK (action IN ('upsert','delete','noop','bypassed','error'))
);

CREATE INDEX IF NOT EXISTS v3_mirror_log_occurred_idx
  ON public.v3_mirror_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS v3_mirror_log_entry_judge_idx
  ON public.v3_mirror_log (entry_id, judge_id, round_number);

ALTER TABLE public.v3_mirror_log ENABLE ROW LEVEL SECURITY;

-- Admins can read; no one can write from client (only the trigger writes,
-- and SECURITY DEFINER functions bypass RLS).
DROP POLICY IF EXISTS "v3_mirror_log_read_admin" ON public.v3_mirror_log;
CREATE POLICY "v3_mirror_log_read_admin"
  ON public.v3_mirror_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies → blocked from PostgREST entirely.

COMMENT ON TABLE public.v3_mirror_log IS
  'Phase R1 Step 1.3 (2026-04-30): forensic log of every mirror_system_tag_to_decision action. Append-only; admins read only.';


-- ============ TRIGGER FUNCTION ============
CREATE OR REPLACE FUNCTION public.mirror_system_tag_to_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  -- ---- Honour the session-level bypass ----
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

  -- ---- Resolve the relevant tag (NEW for INS/UPD, OLD for DEL) ----
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

  -- ---- Look up the canonical label & catalog stage ----
  SELECT label INTO v_tag_label
  FROM public.judging_tags
  WHERE id = v_tag_id;

  IF v_tag_label IS NULL THEN
    -- Tag was deleted before we could read it; safe no-op.
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

  -- ---- Unrecognised system tag → no-op (intentional: free-form admin tags) ----
  IF v_stage.stage_key IS NULL THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, tag_label, entry_id, judge_id, round_number, photo_index)
    VALUES (v_op, 'noop', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
            v_entry_id, v_judge_id, v_round, v_photo_idx);
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- ---- DELETE → drop the matching decision row (only if no other tag still maps to it) ----
  IF v_op = 'DELETE' THEN
    -- Don't delete if another active system-tag row still references the same triplet.
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

  -- ---- INSERT or UPDATE → upsert the decision row ----
  INSERT INTO public.judge_decisions
    (entry_id, judge_id, round_number, photo_index, decision)
  VALUES
    (v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token)
  ON CONFLICT (entry_id, judge_id, round_number, photo_index)
  DO UPDATE
    SET decision   = EXCLUDED.decision,
        updated_at = now();

  INSERT INTO public.v3_mirror_log
    (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
     entry_id, judge_id, round_number, photo_index, decision_token)
  VALUES (v_op, 'upsert', NEW.id, v_tag_id, v_tag_label, v_stage.stage_key,
          v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Never block the user write; record and move on.
  INSERT INTO public.v3_mirror_log
    (trigger_op, action, source_tag_id, tag_id, tag_label,
     entry_id, judge_id, round_number, photo_index, error_message)
  VALUES (v_op, 'error', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
          v_entry_id, v_judge_id, v_round, v_photo_idx, SQLERRM);
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

COMMENT ON FUNCTION public.mirror_system_tag_to_decision() IS
  'Phase R1 Step 1.3 (2026-04-30): mirrors judge_tag_assignments → judge_decisions via v3_stage_catalog. Bypass with set_config(''app.bypass_mirror_trigger'',''on'',true).';

-- ============ TRIGGER ============
DROP TRIGGER IF EXISTS tr_mirror_system_tag_to_decision ON public.judge_tag_assignments;
CREATE TRIGGER tr_mirror_system_tag_to_decision
  AFTER INSERT OR UPDATE OR DELETE ON public.judge_tag_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.mirror_system_tag_to_decision();

COMMENT ON TRIGGER tr_mirror_system_tag_to_decision ON public.judge_tag_assignments IS
  'Phase R1 Step 1.3: keeps judge_decisions in lock-step with judge_tag_assignments for catalog-mapped system tags.';