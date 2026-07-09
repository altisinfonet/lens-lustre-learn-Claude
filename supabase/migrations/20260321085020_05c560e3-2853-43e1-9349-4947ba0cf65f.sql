
-- Add slug column to competitions
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS slug text;

-- Generate slugs from existing titles
UPDATE public.competitions 
SET slug = lower(regexp_replace(regexp_replace(title, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'))
WHERE slug IS NULL;

-- Make slug unique and not null with a default
ALTER TABLE public.competitions ALTER COLUMN slug SET DEFAULT '';
ALTER TABLE public.competitions ADD CONSTRAINT competitions_slug_unique UNIQUE (slug);

-- Create a function to auto-generate slug on insert/update
CREATE OR REPLACE FUNCTION public.generate_competition_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 0;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base_slug := lower(regexp_replace(regexp_replace(NEW.title, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
    final_slug := base_slug;
    
    LOOP
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.competitions WHERE slug = final_slug AND id != NEW.id);
      counter := counter + 1;
      final_slug := base_slug || '-' || counter;
    END LOOP;
    
    NEW.slug := final_slug;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_competition_slug
BEFORE INSERT OR UPDATE ON public.competitions
FOR EACH ROW
EXECUTE FUNCTION public.generate_competition_slug();
