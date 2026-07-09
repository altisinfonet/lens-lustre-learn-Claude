-- Add per-photo scoping to admin vote adjustments to enforce 'One Image, One Vote' policy.
-- photo_index is NOT NULL with default 0 so legacy rows map to the first photo.

ALTER TABLE public.admin_vote_adjustments
  ADD COLUMN IF NOT EXISTS photo_index integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_admin_vote_adjustments_entry_photo
  ON public.admin_vote_adjustments (entry_id, photo_index);