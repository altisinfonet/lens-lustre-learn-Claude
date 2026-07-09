
-- Photo of the Day table
CREATE TABLE public.photo_of_the_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text NOT NULL,
  photographer_name text,
  photographer_id uuid,
  source_type text NOT NULL DEFAULT 'custom', -- 'competition_entry' or 'custom'
  source_entry_id uuid,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  featured_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.photo_of_the_day ENABLE ROW LEVEL SECURITY;

-- Anyone can view active POTD
CREATE POLICY "Anyone can view active POTD"
  ON public.photo_of_the_day FOR SELECT
  USING (is_active = true);

-- Admins can manage POTD
CREATE POLICY "Admins can manage POTD"
  ON public.photo_of_the_day FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));
