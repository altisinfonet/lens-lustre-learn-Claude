
ALTER TABLE public.gift_credits ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL;
ALTER TABLE public.gift_announcements ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT NULL;
