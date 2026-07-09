BEGIN;

-- 1) Add is_visible flag
ALTER TABLE public.judging_tags
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

-- 2) Drop the protect_system_tags trigger so we can rename system rows
DROP TRIGGER IF EXISTS trg_protect_system_tags ON public.judging_tags;

-- 3) Hide all system tags from the Admin Judging Tags editor
UPDATE public.judging_tags SET is_visible = false WHERE is_system = true;

-- 4) Rename system tag labels to Spec v3 wording
UPDATE public.judging_tags SET label = 'Accept'                  WHERE label = 'Accepted'                   AND is_system = true;
UPDATE public.judging_tags SET label = 'Shortlist for R2'        WHERE label = 'Qualified for 2nd Round'    AND is_system = true;
UPDATE public.judging_tags SET label = 'Reject'                  WHERE label = 'Rejected'                   AND is_system = true;
UPDATE public.judging_tags SET label = 'Qualified for R3'        WHERE label = 'Qualified for 3rd Round'    AND is_system = true;
UPDATE public.judging_tags SET label = 'Qualified for R2'        WHERE label = 'Not Selected for 3rd Round' AND is_system = true;
UPDATE public.judging_tags SET label = 'Shortlisted for Final'   WHERE label = 'Qualified for Final Round'  AND is_system = true;
UPDATE public.judging_tags SET label = 'Qualified for R3 Final'  WHERE label = 'Not Selected for Final Round' AND is_system = true;

-- 5) Rename existing R4 award tags to Spec v3 wording
UPDATE public.judging_tags SET label = '1st Runner-Up'  WHERE label = '1st Runner Up';
UPDATE public.judging_tags SET label = '2nd Runner-Up'  WHERE label = '2nd Runner Up';
UPDATE public.judging_tags SET label = 'Special Jury'   WHERE label = 'Special Jury Award';

-- 6) Recreate the protect_system_tags trigger
CREATE OR REPLACE FUNCTION public.protect_system_tags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'System tags cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    IF NEW.label <> OLD.label
       OR NEW.is_system <> OLD.is_system
       OR NEW.visible_in_round <> OLD.visible_in_round THEN
      RAISE EXCEPTION 'System tag label/round/system flag cannot be changed';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE TRIGGER trg_protect_system_tags
  BEFORE DELETE OR UPDATE ON public.judging_tags
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_tags();

-- 7) Add the 4 missing R4 award tags from Spec v3 §4.3 / §4.2
INSERT INTO public.judging_tags (label, color, icon, visible_in_round, is_system, is_visible, created_by)
SELECT v.label, v.color, v.icon, ARRAY[4], false, true, '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'::uuid
FROM (VALUES
  ('Top 100',             '#9CA3AF', 'medal'),
  ('Top 50',              '#F59E0B', 'medal'),
  ('Honorary Mention',    '#A78BFA', 'award'),
  ('Qualified for Final', '#10B981', 'check')
) AS v(label, color, icon)
WHERE NOT EXISTS (
  SELECT 1 FROM public.judging_tags t WHERE LOWER(t.label) = LOWER(v.label)
);

COMMIT;