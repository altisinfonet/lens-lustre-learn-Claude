
-- Rate limit image_comments: max 15 per user per hour
CREATE OR REPLACE FUNCTION public.rate_limit_image_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.image_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 15 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 15 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rate_limit_image_comments
  BEFORE INSERT ON public.image_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.rate_limit_image_comments();

-- Rate limit post_comments: max 15 per user per hour
CREATE OR REPLACE FUNCTION public.rate_limit_post_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.post_comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 15 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 15 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rate_limit_post_comments
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.rate_limit_post_comments();

-- Rate limit article comments: max 15 per user per hour
CREATE OR REPLACE FUNCTION public.rate_limit_comments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.comments
  WHERE user_id = NEW.user_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 15 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 15 comments per hour';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rate_limit_comments
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.rate_limit_comments();
