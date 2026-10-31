
-- Add is_expired flag to gift_announcements to track which gifts have been auto-deducted
ALTER TABLE public.gift_announcements ADD COLUMN IF NOT EXISTS is_expired boolean NOT NULL DEFAULT false;

-- Enable pg_cron and pg_net extensions for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
