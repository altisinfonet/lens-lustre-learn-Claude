CREATE OR REPLACE FUNCTION public.enforce_post_caption_only_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.user_id THEN
    -- Author may only change `content`. Counter columns
    -- (likes_count, comments_count, shares_count) are intentionally
    -- excluded because they are maintained by server-side triggers,
    -- not by the author's UPDATE statement.
    IF NEW.user_id        IS DISTINCT FROM OLD.user_id        OR
       NEW.image_url      IS DISTINCT FROM OLD.image_url      OR
       NEW.image_urls     IS DISTINCT FROM OLD.image_urls     OR
       NEW.thumbnail_url  IS DISTINCT FROM OLD.thumbnail_url  OR
       NEW.thumbnail_urls IS DISTINCT FROM OLD.thumbnail_urls OR
       NEW.privacy        IS DISTINCT FROM OLD.privacy        OR
       NEW.created_at     IS DISTINCT FROM OLD.created_at     OR
       NEW.content_hash   IS DISTINCT FROM OLD.content_hash   THEN
      RAISE EXCEPTION 'Only the caption can be edited'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;