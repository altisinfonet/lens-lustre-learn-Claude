
-- Add actor_id and email_sent columns to user_notifications
ALTER TABLE public.user_notifications 
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS email_sent boolean NOT NULL DEFAULT false;

-- Trigger: Notify on post reactions (someone reacts to your post)
CREATE OR REPLACE FUNCTION public.notify_post_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _post_owner uuid;
  _actor_name text;
BEGIN
  SELECT user_id INTO _post_owner FROM public.posts WHERE id = NEW.post_id;
  IF _post_owner IS NULL OR _post_owner = NEW.user_id THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
  VALUES (_post_owner, NEW.user_id, 'post_reaction', 'New Reaction', _actor_name || ' reacted to your post', NEW.post_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_post_reaction ON public.post_reactions;
CREATE TRIGGER trg_notify_post_reaction AFTER INSERT ON public.post_reactions
FOR EACH ROW EXECUTE FUNCTION public.notify_post_reaction();

-- Trigger: Notify on post comments (someone comments on your post)
CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _post_owner uuid;
  _actor_name text;
  _parent_author uuid;
BEGIN
  SELECT user_id INTO _post_owner FROM public.posts WHERE id = NEW.post_id;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.user_id;
  
  -- Notify post owner
  IF _post_owner IS NOT NULL AND _post_owner != NEW.user_id THEN
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
    VALUES (_post_owner, NEW.user_id, 'post_comment', 'New Comment', _actor_name || ' commented on your post', NEW.post_id);
  END IF;
  
  -- Notify parent comment author (reply)
  IF NEW.parent_id IS NOT NULL THEN
    SELECT user_id INTO _parent_author FROM public.post_comments WHERE id = NEW.parent_id;
    IF _parent_author IS NOT NULL AND _parent_author != NEW.user_id AND _parent_author != _post_owner THEN
      INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
      VALUES (_parent_author, NEW.user_id, 'comment_reply', 'New Reply', _actor_name || ' replied to your comment', NEW.post_id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_post_comment ON public.post_comments;
CREATE TRIGGER trg_notify_post_comment AFTER INSERT ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_post_comment();

-- Trigger: Notify on image reactions (gallery/entry photo reactions)
CREATE OR REPLACE FUNCTION public.notify_image_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _owner_id uuid;
  _actor_name text;
BEGIN
  IF NEW.image_type = 'entry' THEN
    SELECT user_id INTO _owner_id FROM public.competition_entries WHERE id = NEW.image_id::uuid;
  ELSIF NEW.image_type = 'portfolio' THEN
    SELECT uploaded_by INTO _owner_id FROM public.portfolio_images WHERE id = NEW.image_id::uuid;
  END IF;
  
  IF _owner_id IS NULL OR _owner_id = NEW.user_id THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.user_id;
  
  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
  VALUES (_owner_id, NEW.user_id, 'image_reaction', 'New Reaction', _actor_name || ' reacted to your photo', NEW.image_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_image_reaction ON public.image_reactions;
CREATE TRIGGER trg_notify_image_reaction AFTER INSERT ON public.image_reactions
FOR EACH ROW EXECUTE FUNCTION public.notify_image_reaction();

-- Trigger: Notify on image comments
CREATE OR REPLACE FUNCTION public.notify_image_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _owner_id uuid;
  _actor_name text;
  _parent_author uuid;
BEGIN
  IF NEW.image_type = 'entry' THEN
    SELECT user_id INTO _owner_id FROM public.competition_entries WHERE id = NEW.image_id::uuid;
  ELSIF NEW.image_type = 'portfolio' THEN
    SELECT uploaded_by INTO _owner_id FROM public.portfolio_images WHERE id = NEW.image_id::uuid;
  END IF;
  
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.user_id;
  
  -- Notify photo owner
  IF _owner_id IS NOT NULL AND _owner_id != NEW.user_id THEN
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
    VALUES (_owner_id, NEW.user_id, 'image_comment', 'New Comment', _actor_name || ' commented on your photo', NEW.image_id);
  END IF;
  
  -- Notify parent comment author (reply)
  IF NEW.parent_id IS NOT NULL THEN
    SELECT user_id INTO _parent_author FROM public.image_comments WHERE id = NEW.parent_id;
    IF _parent_author IS NOT NULL AND _parent_author != NEW.user_id AND (_owner_id IS NULL OR _parent_author != _owner_id) THEN
      INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
      VALUES (_parent_author, NEW.user_id, 'comment_reply', 'New Reply', _actor_name || ' replied to your comment', NEW.image_id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_image_comment ON public.image_comments;
CREATE TRIGGER trg_notify_image_comment AFTER INSERT ON public.image_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_image_comment();

-- Trigger: Notify on competition entry status change
CREATE OR REPLACE FUNCTION public.notify_entry_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _comp_title text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  
  SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;
  
  IF NEW.status = 'approved' THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
    VALUES (NEW.user_id, 'entry_approved', 'Entry Approved', 'Your entry in "' || COALESCE(_comp_title, 'competition') || '" has been approved!', NEW.competition_id);
  ELSIF NEW.status = 'rejected' THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
    VALUES (NEW.user_id, 'entry_rejected', 'Entry Rejected', 'Your entry in "' || COALESCE(_comp_title, 'competition') || '" was not accepted.', NEW.competition_id);
  ELSIF NEW.status = 'winner' THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
    VALUES (NEW.user_id, 'competition_winner', 'Congratulations!', 'You won in "' || COALESCE(_comp_title, 'competition') || '"! 🏆', NEW.competition_id);
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_entry_status ON public.competition_entries;
CREATE TRIGGER trg_notify_entry_status AFTER UPDATE ON public.competition_entries
FOR EACH ROW EXECUTE FUNCTION public.notify_entry_status_change();

-- Trigger: Notify on new follower
CREATE OR REPLACE FUNCTION public.notify_new_follower()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _actor_name text;
BEGIN
  IF NEW.follower_id = NEW.following_id THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.follower_id;
  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
  VALUES (NEW.following_id, NEW.follower_id, 'new_follower', 'New Follower', _actor_name || ' started following you', NEW.follower_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_follower ON public.follows;
CREATE TRIGGER trg_notify_new_follower AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.notify_new_follower();

-- Trigger: Notify on competition vote (someone voted for your entry)
CREATE OR REPLACE FUNCTION public.notify_competition_vote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _entry_owner uuid;
  _actor_name text;
BEGIN
  SELECT user_id INTO _entry_owner FROM public.competition_entries WHERE id = NEW.entry_id;
  IF _entry_owner IS NULL OR _entry_owner = NEW.user_id THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
  VALUES (_entry_owner, NEW.user_id, 'competition_vote', 'New Vote', _actor_name || ' voted for your entry', NEW.entry_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_competition_vote ON public.competition_votes;
CREATE TRIGGER trg_notify_competition_vote AFTER INSERT ON public.competition_votes
FOR EACH ROW EXECUTE FUNCTION public.notify_competition_vote();
