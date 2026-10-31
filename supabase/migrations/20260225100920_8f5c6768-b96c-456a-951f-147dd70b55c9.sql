
-- 1. Add registered_photographer to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'registered_photographer';

-- 2. Add social media columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS website_url text;
