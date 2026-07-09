
-- ============================================================================
-- Phase 1: scheduled_posts (additive only, fully reversible)
-- ============================================================================

CREATE TABLE public.scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text,
  image_urls text[] NOT NULL DEFAULT '{}',
  image_url text,
  tagged_user_ids uuid[] NOT NULL DEFAULT '{}',
  scheduled_for timestamptz NOT NULL,
  original_scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','publishing','published','failed','cancelled')),
  attempt_count int NOT NULL DEFAULT 0,
  shifted_count int NOT NULL DEFAULT 0,
  last_shift_reason text,
  last_error text,
  published_post_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- GRANTs (required — PostgREST needs explicit privileges)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_posts TO authenticated;
GRANT ALL ON public.scheduled_posts TO service_role;

-- RLS
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sp_select_own"
  ON public.scheduled_posts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "sp_insert_own"
  ON public.scheduled_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sp_update_own_pending"
  ON public.scheduled_posts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sp_delete_own_pending"
  ON public.scheduled_posts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

-- Window-validation trigger (5 min .. 90 days)
CREATE OR REPLACE FUNCTION public.validate_scheduled_post_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scheduled_for < now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'scheduled_for must be at least 5 minutes in the future';
    END IF;
    IF NEW.scheduled_for > now() + interval '90 days' THEN
      RAISE EXCEPTION 'scheduled_for cannot be more than 90 days in the future';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for THEN
    IF NEW.scheduled_for < now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'Rescheduled time must be at least 5 minutes in the future';
    END IF;
    IF NEW.scheduled_for > now() + interval '90 days' THEN
      RAISE EXCEPTION 'Rescheduled time cannot be more than 90 days in the future';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_scheduled_post_window
  BEFORE INSERT OR UPDATE ON public.scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_scheduled_post_window();

-- updated_at trigger (reuses existing shared helper)
CREATE TRIGGER trg_scheduled_posts_updated_at
  BEFORE UPDATE ON public.scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_column();

-- Indexes
CREATE INDEX idx_scheduled_posts_pending_due
  ON public.scheduled_posts (scheduled_for)
  WHERE status = 'pending';

CREATE INDEX idx_scheduled_posts_user_status_time
  ON public.scheduled_posts (user_id, status, scheduled_for DESC);
