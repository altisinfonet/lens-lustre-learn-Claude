-- Fix existing expiry records stored as UTC midnight to end-of-day UTC
UPDATE public.gift_credits
SET expires_at = expires_at + INTERVAL '23 hours 59 minutes 59 seconds'
WHERE expires_at IS NOT NULL
  AND expires_at::time = '00:00:00';

UPDATE public.gift_announcements
SET expires_at = expires_at + INTERVAL '23 hours 59 minutes 59 seconds'
WHERE expires_at IS NOT NULL
  AND expires_at::time = '00:00:00';