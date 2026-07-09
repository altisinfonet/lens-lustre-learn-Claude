
ALTER TABLE public.portfolio_images 
  ADD COLUMN IF NOT EXISTS active_from timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS active_until timestamp with time zone DEFAULT NULL;
