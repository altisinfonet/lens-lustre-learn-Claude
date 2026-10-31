
-- A. Per-round publish flag
CREATE TABLE IF NOT EXISTS public.competition_round_publish (
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number   int  NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  closed_at      timestamptz,
  closed_by      uuid,
  published_at   timestamptz,
  published_by   uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, round_number)
);
ALTER TABLE public.competition_round_publish ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read round publish state"
ON public.competition_round_publish FOR SELECT TO authenticated USING (true);

CREATE POLICY "Public can read published rounds"
ON public.competition_round_publish FOR SELECT TO anon USING (published_at IS NOT NULL);

CREATE POLICY "Admins can manage round publish state"
ON public.competition_round_publish FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_round_publish_updated()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_round_publish_updated
BEFORE UPDATE ON public.competition_round_publish
FOR EACH ROW EXECUTE FUNCTION public.touch_round_publish_updated();

-- B. System tags column
ALTER TABLE public.judging_tags
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- B1. Promote matching labels to system tags (BEFORE installing the protection trigger)
UPDATE public.judging_tags
SET is_system = true,
    visible_in_round = CASE label
      WHEN 'Rejected' THEN ARRAY[1]
      WHEN 'Qualified for Round 2' THEN ARRAY[2]
      WHEN 'Qualified for Round 3' THEN ARRAY[3]
      WHEN 'Qualified for Final Round' THEN ARRAY[4]
    END
WHERE label IN ('Rejected','Qualified for Round 2','Qualified for Round 3','Qualified for Final Round');

-- B2. Insert any system tags that don't yet exist
DO $$
DECLARE admin_id uuid;
BEGIN
  SELECT user_id INTO admin_id FROM public.user_roles WHERE role='admin' LIMIT 1;
  IF admin_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.judging_tags (label, color, icon, is_system, visible_in_round, created_by, sort_order, is_active)
  SELECT v.label, v.color, v.icon, true, v.vir, admin_id, v.so, true
  FROM (VALUES
    ('Rejected',                  '#dc2626', 'x-circle',    ARRAY[1], 1),
    ('Qualified for Round 2',     '#10b981', 'arrow-right', ARRAY[2], 2),
    ('Qualified for Round 3',     '#3b82f6', 'arrow-right', ARRAY[3], 3),
    ('Qualified for Final Round', '#f59e0b', 'award',       ARRAY[4], 4)
  ) AS v(label, color, icon, vir, so)
  WHERE NOT EXISTS (SELECT 1 FROM public.judging_tags t WHERE t.label = v.label);
END $$;

-- B3. Install protection trigger AFTER promotion
CREATE OR REPLACE FUNCTION public.protect_system_tags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'System tags cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.label <> OLD.label OR NEW.is_system <> OLD.is_system OR NEW.visible_in_round <> OLD.visible_in_round THEN
      RAISE EXCEPTION 'System tag label/visibility/system flag cannot be changed';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_protect_system_tags ON public.judging_tags;
CREATE TRIGGER trg_protect_system_tags
BEFORE UPDATE OR DELETE ON public.judging_tags
FOR EACH ROW EXECUTE FUNCTION public.protect_system_tags();

-- C. Seed publish rows
INSERT INTO public.competition_round_publish (competition_id, round_number)
SELECT c.id, r FROM public.competitions c CROSS JOIN generate_series(1,4) r
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_round_publish_rows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.competition_round_publish (competition_id, round_number)
  SELECT NEW.id, r FROM generate_series(1,4) r
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_round_publish ON public.competitions;
CREATE TRIGGER trg_seed_round_publish
AFTER INSERT ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.seed_round_publish_rows();

-- D. Anchor backfill
CREATE UNIQUE INDEX IF NOT EXISTS uq_judge_tag_assignments_quad
ON public.judge_tag_assignments (entry_id, judge_id, tag_id, photo_index);

INSERT INTO public.judge_tag_assignments (entry_id, tag_id, judge_id, photo_index)
SELECT jd.entry_id, t.id, jd.judge_id, jd.photo_index
FROM public.judge_decisions jd
JOIN public.judging_tags t ON t.label='Qualified for Round 2' AND t.is_system=true
WHERE jd.round_number = 2 AND jd.decision IN ('shortlist','qualified')
ON CONFLICT DO NOTHING;

-- E. Public-status view
CREATE OR REPLACE VIEW public.entry_public_status AS
SELECT
  e.id AS entry_id,
  e.competition_id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL
    ) THEN e.status
    ELSE 'judging_in_progress'
  END AS public_status,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.competition_round_publish p
      WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL
    ) THEN e.current_round
    ELSE NULL
  END AS public_round
FROM public.competition_entries e;

GRANT SELECT ON public.entry_public_status TO anon, authenticated;

-- F. Privacy: photographers can no longer read judge marks
DROP POLICY IF EXISTS "Users can view scores on own entries" ON public.judge_scores;

-- G. Lock down judge tag creation
DROP POLICY IF EXISTS "Judges can create quality tags" ON public.judging_tags;
