DROP TRIGGER IF EXISTS protect_system_tags ON public.judging_tags;

INSERT INTO public.judging_tags (label, is_system, is_active, is_visible, visible_in_round, sort_order, created_by)
SELECT 'Needs Review', true, true, false, ARRAY[1]::int[], 13,
       (SELECT created_by FROM public.judging_tags WHERE is_system = true AND created_by IS NOT NULL LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.judging_tags WHERE lower(label) = 'needs review'
);

UPDATE public.judging_tags
SET is_active = false, is_visible = false
WHERE label = 'Qualified for R3 Final';

CREATE OR REPLACE FUNCTION public.protect_system_tags_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'System tags cannot be deleted (label=%)', OLD.label;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system AND NEW.label IS DISTINCT FROM OLD.label THEN
    IF current_setting('app.allow_system_tag_rename', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'System tag labels cannot be renamed via UI (label=%)', OLD.label;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER protect_system_tags
BEFORE UPDATE OR DELETE ON public.judging_tags
FOR EACH ROW EXECUTE FUNCTION public.protect_system_tags_fn();