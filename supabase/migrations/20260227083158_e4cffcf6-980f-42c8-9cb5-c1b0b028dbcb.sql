
-- Add pinning, view counts, and trending to portfolio_images
ALTER TABLE public.portfolio_images 
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_trending boolean NOT NULL DEFAULT false;

-- Add pinning, view counts, and trending to competition_entries
ALTER TABLE public.competition_entries 
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_trending boolean NOT NULL DEFAULT false;

-- Add seed/pinned flags to image_comments
ALTER TABLE public.image_comments 
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_admin_seed boolean NOT NULL DEFAULT false;

-- Create scheduled engagement boosts table
CREATE TABLE IF NOT EXISTS public.scheduled_boosts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  image_id uuid NOT NULL,
  image_type text NOT NULL,
  reaction_type text NOT NULL DEFAULT 'like',
  total_amount integer NOT NULL DEFAULT 10,
  applied_amount integer NOT NULL DEFAULT 0,
  increment_per_hour integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  starts_at timestamp with time zone NOT NULL DEFAULT now(),
  ends_at timestamp with time zone,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_boosts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage boosts" ON public.scheduled_boosts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
