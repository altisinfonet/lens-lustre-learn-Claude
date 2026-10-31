-- ============================================================================
-- REAL POST VIEW COUNTS (replaces simulated engagement — owner decision 2026-07-31)
--
-- The app was showing FAKE view/reach numbers generated from a hash of the post
-- id (src/lib/simulatedEngagement.ts, range 2,000–100,000). On a platform with
-- 74 members those numbers are arithmetically impossible and damage trust in
-- every other figure shown. They are being removed.
--
-- Real impressions already exist in feed_events (written by the feed's viewport
-- tracker: >=2s = 'view', 0.5-2s = 'skip', <0.5s not recorded at all). Users can
-- only read their OWN feed_events rows under RLS, so this SECURITY DEFINER
-- function exposes COUNTS ONLY — never viewer identities.
--
-- Adds one function. Nothing is dropped or modified.
-- ============================================================================

-- Counting viewers per post needs this; created earlier for the broadcast feed
-- but repeated here so this migration stands alone.
CREATE INDEX IF NOT EXISTS idx_feed_events_post ON public.feed_events (post_id);

CREATE OR REPLACE FUNCTION public.get_post_view_counts(_post_ids uuid[])
RETURNS TABLE(post_id uuid, views integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT p.id AS post_id,
         (SELECT count(DISTINCT fe.user_id)::int
            FROM public.feed_events fe
           WHERE fe.post_id = p.id
             AND fe.event_type IN ('view', 'skip')
             AND fe.user_id <> p.user_id)      -- the author's own opens don't count
  FROM public.posts p
  WHERE p.id = ANY(_post_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_post_view_counts(uuid[]) TO authenticated;
