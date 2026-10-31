
-- FIX 7: Reaction velocity control (20 in 1 min = blocked)
-- FIX 1 addon: Toggle protection (3s gap on same post)
-- Replace existing rate limiter with enhanced version
CREATE OR REPLACE FUNCTION public.rate_limit_post_reactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  hourly_count integer;
  minute_count integer;
  last_on_post timestamptz;
BEGIN
  -- Velocity check: 20 in 1 minute = temporary block
  SELECT COUNT(*) INTO minute_count
  FROM public.post_reactions
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 minute';
  IF minute_count >= 20 THEN
    RAISE EXCEPTION 'Slow down: too many reactions in a short time. Please wait a moment.';
  END IF;

  -- Hourly rate limit: 200/hr
  SELECT COUNT(*) INTO hourly_count
  FROM public.post_reactions
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';
  IF hourly_count >= 200 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 200 reactions per hour';
  END IF;

  -- Toggle protection: 3s minimum gap on same post
  SELECT MAX(created_at) INTO last_on_post
  FROM public.post_reactions
  WHERE user_id = NEW.user_id
    AND post_id = NEW.post_id;
  IF last_on_post IS NOT NULL AND (now() - last_on_post) < interval '3 seconds' THEN
    RAISE EXCEPTION 'Please wait a moment before reacting to this post again.';
  END IF;

  RETURN NEW;
END;
$$;

-- FIX 4: Validate feed_events author_id server-side
CREATE OR REPLACE FUNCTION public.validate_feed_event_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  real_author uuid;
BEGIN
  -- Look up the actual author from the posts table
  SELECT user_id INTO real_author
  FROM public.posts
  WHERE id = NEW.post_id::uuid;

  IF real_author IS NULL THEN
    -- Post doesn't exist, reject the event
    RAISE EXCEPTION 'Invalid post_id: post does not exist';
  END IF;

  -- Override client-provided author_id with real value
  NEW.author_id := real_author;

  -- Prevent self-interaction boosting for ranking-relevant events
  IF NEW.user_id = real_author AND NEW.event_type IN ('like', 'share', 'comment') THEN
    -- Allow the event but neutralize it (won't boost own ranking)
    NEW.event_type := 'self_' || NEW.event_type;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_feed_event_author ON public.feed_events;
CREATE TRIGGER trg_validate_feed_event_author
BEFORE INSERT ON public.feed_events
FOR EACH ROW EXECUTE FUNCTION public.validate_feed_event_author();

-- FIX 5: Duplicate post detection via content hash
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS idx_posts_content_hash ON public.posts (content_hash) WHERE content_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.detect_duplicate_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  hash_val text;
  dupe_exists boolean;
BEGIN
  -- Generate hash from content + image URLs
  hash_val := md5(
    COALESCE(NEW.content, '') || '|' ||
    COALESCE(array_to_string(NEW.image_urls, ','), '') || '|' ||
    COALESCE(NEW.image_url, '')
  );

  NEW.content_hash := hash_val;

  -- Check for duplicate by same user within 10 minutes
  SELECT EXISTS (
    SELECT 1 FROM public.posts
    WHERE user_id = NEW.user_id
      AND content_hash = hash_val
      AND created_at > now() - interval '10 minutes'
  ) INTO dupe_exists;

  IF dupe_exists THEN
    RAISE EXCEPTION 'Duplicate post detected. Please wait before posting similar content.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detect_duplicate_post ON public.posts;
CREATE TRIGGER trg_detect_duplicate_post
BEFORE INSERT ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.detect_duplicate_post();

-- FIX 6: Blocked keywords check on posts
CREATE OR REPLACE FUNCTION public.moderate_post_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  blocked_word text;
BEGIN
  -- Check post content against blocked keywords
  SELECT keyword INTO blocked_word
  FROM public.blocked_keywords
  WHERE is_active = true
    AND severity IN ('high', 'critical')
    AND NEW.content ILIKE '%' || keyword || '%'
  LIMIT 1;

  IF blocked_word IS NOT NULL THEN
    RAISE EXCEPTION 'Post contains restricted content and cannot be published.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moderate_post_content ON public.posts;
CREATE TRIGGER trg_moderate_post_content
BEFORE INSERT OR UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.moderate_post_content();
