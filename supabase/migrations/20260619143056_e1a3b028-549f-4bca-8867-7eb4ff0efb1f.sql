
-- 1. Additive columns (safe — default false, NOT NULL)
ALTER TABLE public.competitions     ADD COLUMN IF NOT EXISTS notification_sent boolean NOT NULL DEFAULT false;
ALTER TABLE public.journal_articles  ADD COLUMN IF NOT EXISTS notification_sent boolean NOT NULL DEFAULT false;
ALTER TABLE public.courses           ADD COLUMN IF NOT EXISTS notification_sent boolean NOT NULL DEFAULT false;

-- 2. Backfill: mark all EXISTING rows as already-notified so triggers do not re-blast users.
UPDATE public.competitions    SET notification_sent = true WHERE notification_sent = false;
UPDATE public.journal_articles SET notification_sent = true WHERE notification_sent = false;
UPDATE public.courses          SET notification_sent = true WHERE notification_sent = false;

-- 3. Competition trigger: fire on INSERT or UPDATE; gated by notification_sent.
CREATE OR REPLACE FUNCTION public.notify_new_competition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'open' AND NEW.notification_sent = false THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
    SELECT p.id, 'new_competition', 'New Competition! 🏆',
           '''' || NEW.title || ''' is now open for submissions!', NEW.id
    FROM public.profiles p
    WHERE p.is_suspended = false AND p.id != NEW.created_by;

    NEW.notification_sent := true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_new_competition ON public.competitions;
CREATE TRIGGER trg_notify_new_competition
  BEFORE INSERT OR UPDATE OF status ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_competition();

-- 4. Journal trigger: keep existing publish-transition guard + idempotency flag.
CREATE OR REPLACE FUNCTION public.notify_journal_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (OLD.status IS DISTINCT FROM 'published') AND NEW.status = 'published'
     AND NEW.notification_sent = false THEN
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
    SELECT p.id, NEW.author_id, 'journal_published', 'New Article! 📰',
           '''' || NEW.title || ''' has been published in the Journal', NEW.id
    FROM public.profiles p
    WHERE p.is_suspended = false AND p.id != NEW.author_id;

    NEW.notification_sent := true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_journal_published ON public.journal_articles;
CREATE TRIGGER trg_notify_journal_published
  BEFORE UPDATE ON public.journal_articles
  FOR EACH ROW EXECUTE FUNCTION public.notify_journal_published();

-- 5. Course trigger: same idempotency hardening.
CREATE OR REPLACE FUNCTION public.notify_course_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (OLD.status IS DISTINCT FROM 'published') AND NEW.status = 'published'
     AND NEW.notification_sent = false THEN
    INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
    SELECT p.id, NEW.author_id, 'course_published', 'New Course! 📚',
           '''' || NEW.title || ''' is now available', NEW.id
    FROM public.profiles p
    WHERE p.is_suspended = false AND p.id != NEW.author_id;

    NEW.notification_sent := true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_course_published ON public.courses;
CREATE TRIGGER trg_notify_course_published
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.notify_course_published();
