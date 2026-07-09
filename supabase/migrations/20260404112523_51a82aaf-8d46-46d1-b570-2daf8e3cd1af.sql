
-- FIX 1: Missing indexes on post_reactions
CREATE INDEX IF NOT EXISTS idx_post_reactions_post_id ON public.post_reactions (post_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_post_user ON public.post_reactions (post_id, user_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON public.post_comments (post_id);

-- FIX 3: Consolidated candidate query RPC
CREATE OR REPLACE FUNCTION public.get_feed_candidates(
  _network_ids uuid[],
  _recent_limit integer DEFAULT 120,
  _network_limit integer DEFAULT 150,
  _popular_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  content text,
  image_url text,
  image_urls text[],
  privacy text,
  created_at timestamptz,
  likes_count integer,
  comments_count integer,
  shares_count integer,
  source_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH recent AS (
    SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count,
           'recent'::text AS source_type
    FROM public.posts p
    WHERE p.privacy = 'public'
      AND p.created_at >= now() - interval '48 hours'
    ORDER BY p.created_at DESC
    LIMIT _recent_limit
  ),
  network AS (
    SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count,
           'network'::text AS source_type
    FROM public.posts p
    WHERE p.user_id = ANY(_network_ids)
    ORDER BY p.created_at DESC
    LIMIT _network_limit
  ),
  popular AS (
    SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count,
           'popular'::text AS source_type
    FROM public.posts p
    WHERE p.privacy = 'public'
      AND p.created_at >= now() - interval '7 days'
    ORDER BY p.created_at DESC
    LIMIT _popular_limit
  ),
  combined AS (
    SELECT * FROM recent
    UNION ALL
    SELECT * FROM network
    UNION ALL
    SELECT * FROM popular
  )
  SELECT DISTINCT ON (c.id) c.*
  FROM combined c
  ORDER BY c.id, c.created_at DESC;
$$;

-- Anti-spam: Rate limit post_reactions (200/hr)
CREATE OR REPLACE FUNCTION public.rate_limit_post_reactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.post_reactions
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF recent_count >= 200 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 200 reactions per hour';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_post_reactions ON public.post_reactions;
CREATE TRIGGER trg_rate_limit_post_reactions
BEFORE INSERT ON public.post_reactions
FOR EACH ROW EXECUTE FUNCTION public.rate_limit_post_reactions();

-- Anti-spam: Rate limit posts creation (30/hr)
CREATE OR REPLACE FUNCTION public.rate_limit_posts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.posts
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 30 posts per hour';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_posts ON public.posts;
CREATE TRIGGER trg_rate_limit_posts
BEFORE INSERT ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.rate_limit_posts();

-- Reduce comment rate limits from 1500 to 100
CREATE OR REPLACE FUNCTION public.rate_limit_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF recent_count >= 100 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 100 comments per hour';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rate_limit_post_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.post_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF recent_count >= 100 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 100 comments per hour';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rate_limit_image_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.image_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF recent_count >= 100 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 100 comments per hour';
  END IF;
  RETURN NEW;
END;
$$;
