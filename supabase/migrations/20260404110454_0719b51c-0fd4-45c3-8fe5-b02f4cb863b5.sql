
-- Step 1: Create feed_events table for tracking user behavior
CREATE TABLE public.feed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'like', 'skip', 'comment', 'share', 'click')),
  dwell_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by user + author (interaction scoring)
CREATE INDEX idx_feed_events_user_author ON public.feed_events (user_id, author_id);
-- Index for cleanup queries (old events)
CREATE INDEX idx_feed_events_created ON public.feed_events (created_at);
-- Index for per-user queries
CREATE INDEX idx_feed_events_user ON public.feed_events (user_id, created_at DESC);

-- RLS
ALTER TABLE public.feed_events ENABLE ROW LEVEL SECURITY;

-- Users can only insert their own events
CREATE POLICY "Users insert own feed events"
  ON public.feed_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own events (for client-side dedup)
CREATE POLICY "Users read own feed events"
  ON public.feed_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read all events
CREATE POLICY "Admins read all feed events"
  ON public.feed_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Rate limit trigger: max 500 events per user per hour
CREATE OR REPLACE FUNCTION public.rate_limit_feed_events()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.feed_events
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 500 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 500 feed events per hour';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rate_limit_feed_events
  BEFORE INSERT ON public.feed_events
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_feed_events();
