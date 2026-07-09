-- Caption-only update guard for public.posts
-- Authors may only modify `content` (and `updated_at`); admins are exempt.

CREATE OR REPLACE FUNCTION public.enforce_post_caption_only_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins can change anything (matches existing "Admins can manage posts" policy)
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- For the author, lock down every column except `content` and `updated_at`
  IF auth.uid() = OLD.user_id THEN
    IF NEW.user_id        IS DISTINCT FROM OLD.user_id        OR
       NEW.image_url      IS DISTINCT FROM OLD.image_url      OR
       NEW.image_urls     IS DISTINCT FROM OLD.image_urls     OR
       NEW.thumbnail_url  IS DISTINCT FROM OLD.thumbnail_url  OR
       NEW.thumbnail_urls IS DISTINCT FROM OLD.thumbnail_urls OR
       NEW.privacy        IS DISTINCT FROM OLD.privacy        OR
       NEW.created_at     IS DISTINCT FROM OLD.created_at     OR
       NEW.likes_count    IS DISTINCT FROM OLD.likes_count    OR
       NEW.comments_count IS DISTINCT FROM OLD.comments_count OR
       NEW.shares_count   IS DISTINCT FROM OLD.shares_count   OR
       NEW.content_hash   IS DISTINCT FROM OLD.content_hash   THEN
      RAISE EXCEPTION 'Only the caption can be edited'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Always refresh updated_at on author edits
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Anyone else attempting an update falls through to RLS (which will deny)
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_post_caption_only_update ON public.posts;
CREATE TRIGGER trg_enforce_post_caption_only_update
BEFORE UPDATE ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_post_caption_only_update();