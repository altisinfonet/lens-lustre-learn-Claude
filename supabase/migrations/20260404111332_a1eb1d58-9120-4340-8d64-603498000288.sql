
-- FIX 1: Database indexes for feed performance
CREATE INDEX IF NOT EXISTS idx_posts_created_at_desc ON public.posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON public.posts (user_id);
CREATE INDEX IF NOT EXISTS idx_posts_privacy_created_at ON public.posts (privacy, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_id_created_at ON public.posts (user_id, created_at DESC);

-- Index for feed_events lookups
CREATE INDEX IF NOT EXISTS idx_feed_events_user_created ON public.feed_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_events_author ON public.feed_events (author_id);

-- FIX 2: Precomputed engagement counts on posts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS likes_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS comments_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS shares_count integer NOT NULL DEFAULT 0;

-- Backfill existing counts
UPDATE public.posts p SET
  likes_count = COALESCE((SELECT COUNT(*) FROM public.post_reactions pr WHERE pr.post_id = p.id), 0),
  comments_count = COALESCE((SELECT COUNT(*) FROM public.post_comments pc WHERE pc.post_id = p.id), 0),
  shares_count = COALESCE((SELECT COUNT(*) FROM public.post_shares ps WHERE ps.post_id = p.id), 0);

-- Trigger: increment likes_count on reaction insert
CREATE OR REPLACE FUNCTION public.update_post_likes_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_post_likes_count ON public.post_reactions;
CREATE TRIGGER trg_update_post_likes_count
AFTER INSERT OR DELETE ON public.post_reactions
FOR EACH ROW EXECUTE FUNCTION public.update_post_likes_count();

-- Trigger: increment comments_count on comment insert
CREATE OR REPLACE FUNCTION public.update_post_comments_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_post_comments_count ON public.post_comments;
CREATE TRIGGER trg_update_post_comments_count
AFTER INSERT OR DELETE ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.update_post_comments_count();

-- Trigger: increment shares_count on share insert
CREATE OR REPLACE FUNCTION public.update_post_shares_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET shares_count = shares_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET shares_count = GREATEST(shares_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_post_shares_count ON public.post_shares;
CREATE TRIGGER trg_update_post_shares_count
AFTER INSERT OR DELETE ON public.post_shares
FOR EACH ROW EXECUTE FUNCTION public.update_post_shares_count();
