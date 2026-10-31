-- Top Contributors must rank COMMUNITY members only.
--
-- Problem (verified 2026-07-25): get_top_contributors_v1 grouped every public
-- post from the last 30 days with no role filter, so the platform's own brand
-- account "50mm Retina World" (holds the `admin` role) ranked #3 on the home
-- page with 2 posts — i.e. the house was competing in its own leaderboard and
-- would be counted for an award.
--
-- Fix: exclude any account holding a staff role (admin / moderator) from the
-- ranking. Everything else — the 30-day window, the public-only filter, the
-- 2/1/1.5 weighting and the LIMIT 3 — is unchanged.
--
-- Verified before applying: with this filter the top 3 become
--   Anindya Phani (7 posts, 24.5) / Payel Kundu Basu (3, 7.0) / Saptarshi Sengupta (2, 5.0)
-- and the brand account no longer appears.
CREATE OR REPLACE FUNCTION public.get_top_contributors_v1()
RETURNS TABLE (
  user_id uuid,
  posts_count bigint,
  likes_received bigint,
  comments_received bigint,
  score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.user_id,
    COUNT(DISTINCT p.id)                AS posts_count,
    COUNT(DISTINCT pr.id)               AS likes_received,
    COUNT(DISTINCT pc.id)               AS comments_received,
    (COUNT(DISTINCT p.id) * 2
     + COUNT(DISTINCT pr.id) * 1
     + COUNT(DISTINCT pc.id) * 1.5)     AS score
  FROM posts p
  LEFT JOIN post_reactions pr ON pr.post_id = p.id
  LEFT JOIN post_comments pc ON pc.post_id = p.id
  WHERE p.privacy = 'public'
    AND p.created_at > now() - interval '30 days'
    -- Staff / brand accounts are not community contributors and are not
    -- eligible for contributor awards.
    AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = p.user_id
        AND ur.role::text IN ('admin', 'moderator')
    )
  GROUP BY p.user_id
  ORDER BY score DESC
  LIMIT 3;
$$;
