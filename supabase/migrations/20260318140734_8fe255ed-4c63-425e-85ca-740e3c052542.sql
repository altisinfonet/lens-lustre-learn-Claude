
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS user_type text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
