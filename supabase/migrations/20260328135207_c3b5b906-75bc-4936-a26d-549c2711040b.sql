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
  GROUP BY p.user_id
  ORDER BY score DESC
  LIMIT 3;
$$;