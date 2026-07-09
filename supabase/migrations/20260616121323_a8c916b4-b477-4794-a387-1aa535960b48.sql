
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reengagement_sends_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reengagement_sent_at TIMESTAMPTZ;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS email_reengagement BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_profiles_reengagement_scan
  ON public.profiles (last_active_at, reengagement_sends_count, last_reengagement_sent_at)
  WHERE reengagement_sends_count < 4;
