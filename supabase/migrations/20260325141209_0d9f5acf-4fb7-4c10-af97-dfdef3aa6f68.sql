
-- 1. Friend request RECEIVED (pending) → notify addressee
CREATE OR REPLACE FUNCTION public.notify_friend_request_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _actor_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.requester_id;
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
    VALUES (NEW.addressee_id, NEW.requester_id, 'friend_request', 'Friend Request', _actor_name || ' sent you a friend request', NEW.requester_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_friend_request
AFTER INSERT ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.notify_friend_request_received();

-- 2. Badge awarded → notify user
CREATE OR REPLACE FUNCTION public.notify_badge_awarded()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _badge_label text;
BEGIN
  SELECT label INTO _badge_label FROM public.badge_definitions WHERE type_key = NEW.badge_type LIMIT 1;
  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
  VALUES (NEW.user_id, NEW.assigned_by, 'badge_awarded', 'New Badge!', 'You''ve been awarded the "' || COALESCE(_badge_label, NEW.badge_type) || '" badge! 🏅', NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_badge_awarded
AFTER INSERT ON public.user_badges
FOR EACH ROW EXECUTE FUNCTION public.notify_badge_awarded();

-- 3. Certificate issued → notify user
CREATE OR REPLACE FUNCTION public.notify_certificate_issued()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
  VALUES (NEW.user_id, 'certificate_issued', 'New Certificate!', 'You''ve earned: "' || NEW.title || '" 🎓', NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_certificate_issued
AFTER INSERT ON public.certificates
FOR EACH ROW EXECUTE FUNCTION public.notify_certificate_issued();

-- 4. Photo of the Day → notify photographer
CREATE OR REPLACE FUNCTION public.notify_potd_featured()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.photographer_id IS NOT NULL AND NEW.is_active = true THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
    VALUES (NEW.photographer_id, 'potd_featured', 'Photo of the Day! 📸', 'Your photo "' || NEW.title || '" has been selected as Photo of the Day!', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_potd_featured
AFTER INSERT ON public.photo_of_the_day
FOR EACH ROW EXECUTE FUNCTION public.notify_potd_featured();

-- 5. New competition created → notify all active users
CREATE OR REPLACE FUNCTION public.notify_new_competition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'open' THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
    SELECT p.id, 'new_competition', 'New Competition! 🏆', '''' || NEW.title || ''' is now open for submissions!', NEW.id
    FROM public.profiles p
    WHERE p.is_suspended = false AND p.id != NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_competition
AFTER INSERT ON public.competitions
FOR EACH ROW EXECUTE FUNCTION public.notify_new_competition();

-- 6. Journal article published → notify all active users
CREATE OR REPLACE FUNCTION public.notify_journal_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF (OLD.status IS DISTINCT FROM 'published') AND NEW.status = 'published' THEN
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
    SELECT p.id, NEW.author_id, 'journal_published', 'New Article! 📰', '''' || NEW.title || ''' has been published in the Journal', NEW.id
    FROM public.profiles p
    WHERE p.is_suspended = false AND p.id != NEW.author_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_journal_published
AFTER UPDATE ON public.journal_articles
FOR EACH ROW EXECUTE FUNCTION public.notify_journal_published();

-- 7. New course published → notify all active users
CREATE OR REPLACE FUNCTION public.notify_course_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF (OLD.status IS DISTINCT FROM 'published') AND NEW.status = 'published' THEN
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
    SELECT p.id, NEW.author_id, 'course_published', 'New Course! 📚', '''' || NEW.title || ''' is now available', NEW.id
    FROM public.profiles p
    WHERE p.is_suspended = false AND p.id != NEW.author_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_course_published
AFTER UPDATE ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.notify_course_published();

-- 8. Featured artist published → notify the artist
CREATE OR REPLACE FUNCTION public.notify_featured_artist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _artist_user_id uuid;
BEGIN
  IF NEW.is_active = true THEN
    -- Try to find a user matching the artist name
    SELECT id INTO _artist_user_id FROM public.profiles WHERE full_name = NEW.artist_name LIMIT 1;
    IF _artist_user_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
      VALUES (_artist_user_id, 'featured_artist', 'You''re Featured! ⭐', 'You''ve been featured as an artist on 50mm Retina World!', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_featured_artist
AFTER INSERT ON public.featured_artists
FOR EACH ROW EXECUTE FUNCTION public.notify_featured_artist();
