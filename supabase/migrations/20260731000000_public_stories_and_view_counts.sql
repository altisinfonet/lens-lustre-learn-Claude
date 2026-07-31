-- ============================================================================
-- STORIES: PUBLIC + RECENCY-ORDERED, PLUS VIEW COUNTS (owner-approved spec)
--
--   1. Stories are PUBLIC: every user with an active (non-expired) story
--      appears in every viewer's stories bar — not only accounts the viewer
--      follows. (The stories table RLS already allowed anyone to read
--      non-expired stories; only this function was restricting the bar.)
--   2. Ordering is purely "last update first" — most recently posted story
--      first, exactly like the feed. The previous "official account always
--      pinned first" rule is REMOVED per the spec; the official account still
--      appears, in its normal recency position.
--   3. New get_my_story_view_counts(): lets an author see HOW MANY people
--      viewed each of their own stories. It returns counts ONLY — viewer
--      identities are never selectable through it, by construction.
--
-- Adds/replaces only. Nothing is dropped. The 24h expiry, story_views RLS,
-- and the stories table itself are untouched.
-- ============================================================================

-- Counting every viewer of a story needs an index on story_id (story_views was
-- only indexed by viewer_id).
CREATE INDEX IF NOT EXISTS idx_story_views_story ON public.story_views(story_id);

-- 1) PUBLIC, recency-ordered stories bar.
CREATE OR REPLACE FUNCTION public.get_feed_stories_bar()
 RETURNS TABLE(
   user_id uuid,
   full_name text,
   avatar_url text,
   is_official boolean,
   latest_story_at timestamptz,
   story_count integer,
   has_unseen boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  official AS (SELECT public.get_primary_admin_user_id() AS oid),
  active AS (
    -- Every user with at least one live story. No follow/friend filter:
    -- stories are public to the whole community.
    SELECT s.user_id,
           max(s.created_at) AS latest_story_at,
           count(*)::int      AS story_count,
           bool_or(sv.story_id IS NULL) AS has_unseen
    FROM public.stories s
    LEFT JOIN public.story_views sv
      ON sv.story_id = s.id AND sv.viewer_id = (SELECT uid FROM me)
    WHERE s.expires_at > now()
      AND s.user_id <> (SELECT uid FROM me)   -- own stories live in the "Your Story" bubble
    GROUP BY s.user_id
  )
  SELECT a.user_id,
         p.full_name,
         p.avatar_url,
         (a.user_id = (SELECT oid FROM official)) AS is_official,
         a.latest_story_at,
         a.story_count,
         a.has_unseen
  FROM active a
  JOIN public.profiles_public_data p ON p.id = a.user_id
  ORDER BY a.latest_story_at DESC
  LIMIT 100;
$function$;

GRANT EXECUTE ON FUNCTION public.get_feed_stories_bar() TO authenticated;

-- 2) View COUNTS for the caller's own stories. Count only — no viewer ids,
--    no names. Restricted to stories owned by the caller.
CREATE OR REPLACE FUNCTION public.get_my_story_view_counts()
 RETURNS TABLE(story_id uuid, view_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id AS story_id,
         (SELECT count(*)::int
            FROM public.story_views sv
           WHERE sv.story_id = s.id
             AND sv.viewer_id <> s.user_id)   -- don't count the author's own opens
  FROM public.stories s
  WHERE s.user_id = auth.uid()
    AND s.expires_at > now();
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_story_view_counts() TO authenticated;
