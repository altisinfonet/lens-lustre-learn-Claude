-- Phase H: auto-expire & escalation for photo verification requests
-- Add expires_at column. Defaults to creation time + 72 hours.
ALTER TABLE public.photo_verification_requests
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill existing pending/submitted rows: created_at + 72h
UPDATE public.photo_verification_requests
SET expires_at = created_at + interval '72 hours'
WHERE expires_at IS NULL;

-- Default for future inserts
ALTER TABLE public.photo_verification_requests
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '72 hours');

-- Add expired_at + auto_expired flag for traceability
ALTER TABLE public.photo_verification_requests
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_expired boolean NOT NULL DEFAULT false;

-- Index to make sweep query cheap
CREATE INDEX IF NOT EXISTS idx_pvr_expires_at_pending
  ON public.photo_verification_requests (expires_at)
  WHERE status IN ('pending');

-- Allow 'expired' as valid status (no enum used; column is text — no constraint change needed)
COMMENT ON COLUMN public.photo_verification_requests.expires_at IS
  'Phase H: deadline for participant to upload original. Sweeper auto-rejects pending rows past this.';
COMMENT ON COLUMN public.photo_verification_requests.auto_expired IS
  'true when the row was rejected by the auto-expire sweeper, not by an admin.';