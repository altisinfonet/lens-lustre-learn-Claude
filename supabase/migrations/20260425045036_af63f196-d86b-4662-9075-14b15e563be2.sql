
-- =========================================================================
-- Phase R1 (retry) — Tag → Decision mirror with round-lock bypass for sync
-- =========================================================================

-- 1. Mapping table
CREATE TABLE IF NOT EXISTS public.system_tag_decision_map (
  tag_id        uuid PRIMARY KEY REFERENCES public.judging_tags(id) ON DELETE CASCADE,
  round_number  integer NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  decision      text    NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_tag_decision_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_tag_decision_map readable by authenticated"
  ON public.system_tag_decision_map;
CREATE POLICY "system_tag_decision_map readable by authenticated"
  ON public.system_tag_decision_map
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.system_tag_decision_map (tag_id, round_number, decision) VALUES
  ('4f1805d5-0a86-4abf-bb27-496da58bd0b2', 1, 'accept'),
  ('13f2d1bd-06cd-40e8-a086-64762d6fa372', 1, 'shortlist'),
  ('4b440411-1efe-49c4-a9ee-a491a78bdb4d', 1, 'reject'),
  ('67d446d4-fec6-4f45-8643-03c3ff2d462f', 2, 'shortlist'),
  ('bce0e662-76cb-4196-9798-e7d14bd1d782', 2, 'reject'),
  ('df11381a-1d96-4c46-8439-747ed3a7b0c6', 3, 'shortlist'),
  ('15012bbe-9d46-42e1-8e38-a639a3f5769f', 3, 'reject'),
  ('ec03eecf-800d-4028-909c-a11a75033327', 1, 'needs_verification'),
  ('c570fc9f-043b-4ee2-8591-fa2389c55812', 2, 'needs_verification'),
  ('16f90d24-10d8-46a8-8024-202d1fdd80a0', 3, 'needs_verification'),
  ('7ba445d6-fae5-46b4-8656-f281a6b22159', 4, 'needs_verification')
ON CONFLICT (tag_id) DO UPDATE
  SET round_number = EXCLUDED.round_number, decision = EXCLUDED.decision;

-- 2. Patch enforce_round_lock to honor a trusted bypass flag.
--    Only DB-internal sync paths (mirror trigger, backfills) set this flag.
CREATE OR REPLACE FUNCTION public.enforce_round_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _comp_id uuid;
  _round_status text;
  _round_number int;
  _entry_id uuid;
  _row jsonb;
  _current_round_text text;
BEGIN
  -- Trusted internal sync bypass (e.g. tag→decision mirror, backfills).
  IF current_setting('app.bypass_round_lock', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN _row := to_jsonb(OLD); ELSE _row := to_jsonb(NEW); END IF;

  _entry_id := NULLIF(_row->>'entry_id','')::uuid;
  IF _entry_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF _row ? 'round_number' AND NULLIF(_row->>'round_number','') IS NOT NULL THEN
    _round_number := (_row->>'round_number')::int;
  END IF;

  IF _round_number IS NULL AND _row ? 'round_id' AND NULLIF(_row->>'round_id','') IS NOT NULL THEN
    SELECT round_number INTO _round_number
    FROM public.judging_rounds WHERE id = (_row->>'round_id')::uuid;
  END IF;

  IF _round_number IS NULL THEN
    SELECT competition_id, current_round
      INTO _comp_id, _current_round_text
    FROM public.competition_entries WHERE id = _entry_id;
    _round_number := NULLIF(regexp_replace(COALESCE(_current_round_text, ''), '\D', '', 'g'), '')::int;
  ELSE
    SELECT competition_id INTO _comp_id
    FROM public.competition_entries WHERE id = _entry_id;
  END IF;

  IF _round_number IS NOT NULL AND _comp_id IS NOT NULL THEN
    SELECT status INTO _round_status
    FROM public.judging_rounds
    WHERE competition_id = _comp_id AND round_number = _round_number;

    IF _round_status = 'completed' THEN
      RAISE EXCEPTION 'This round has been completed. Scoring is locked.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- 3. Mirror trigger function — sets bypass GUC so reconciliation always succeeds.
CREATE OR REPLACE FUNCTION public.mirror_system_tag_to_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map public.system_tag_decision_map%ROWTYPE;
BEGIN
  PERFORM set_config('app.bypass_round_lock', 'on', true);

  IF (TG_OP = 'INSERT') THEN
    SELECT * INTO v_map FROM public.system_tag_decision_map WHERE tag_id = NEW.tag_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    INSERT INTO public.judge_decisions
      (entry_id, judge_id, round_number, photo_index, decision, created_at, updated_at)
    VALUES
      (NEW.entry_id, NEW.judge_id, v_map.round_number, COALESCE(NEW.photo_index, 0),
       v_map.decision, now(), now())
    ON CONFLICT (entry_id, judge_id, round_number, photo_index)
      DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();

    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    SELECT * INTO v_map FROM public.system_tag_decision_map WHERE tag_id = OLD.tag_id;
    IF NOT FOUND THEN RETURN OLD; END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.judge_tag_assignments jta
        JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
       WHERE jta.entry_id = OLD.entry_id
         AND jta.judge_id = OLD.judge_id
         AND COALESCE(jta.photo_index, 0) = COALESCE(OLD.photo_index, 0)
         AND m.round_number = v_map.round_number
         AND jta.tag_id <> OLD.tag_id
    ) THEN
      DELETE FROM public.judge_decisions
       WHERE entry_id = OLD.entry_id
         AND judge_id = OLD.judge_id
         AND round_number = v_map.round_number
         AND photo_index = COALESCE(OLD.photo_index, 0)
         AND decision = v_map.decision;
    END IF;

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_system_tag_to_decision_ins ON public.judge_tag_assignments;
CREATE TRIGGER trg_mirror_system_tag_to_decision_ins
AFTER INSERT ON public.judge_tag_assignments
FOR EACH ROW EXECUTE FUNCTION public.mirror_system_tag_to_decision();

DROP TRIGGER IF EXISTS trg_mirror_system_tag_to_decision_del ON public.judge_tag_assignments;
CREATE TRIGGER trg_mirror_system_tag_to_decision_del
AFTER DELETE ON public.judge_tag_assignments
FOR EACH ROW EXECUTE FUNCTION public.mirror_system_tag_to_decision();

-- 4. One-time backfill of drifted rows (bypass round lock for this sync only).
DO $$
BEGIN
  PERFORM set_config('app.bypass_round_lock', 'on', true);

  INSERT INTO public.judge_decisions
    (entry_id, judge_id, round_number, photo_index, decision, created_at, updated_at)
  SELECT
    jta.entry_id, jta.judge_id, m.round_number, COALESCE(jta.photo_index, 0),
    m.decision, COALESCE(jta.created_at, now()), now()
  FROM public.judge_tag_assignments jta
  JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
  ON CONFLICT (entry_id, judge_id, round_number, photo_index)
    DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();

  PERFORM set_config('app.bypass_round_lock', 'off', true);
END$$;
