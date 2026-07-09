
CREATE TABLE public.user_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  badge_type text NOT NULL,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_type)
);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- Anyone can view badges (they're public)
CREATE POLICY "Anyone can view badges"
  ON public.user_badges
  FOR SELECT
  USING (true);

-- Only admins can manage badges
CREATE POLICY "Admins can manage badges"
  ON public.user_badges
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));
