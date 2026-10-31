
-- Trigger function: auto-subscribe new users to newsletter on registration
CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _email text;
BEGIN
  -- Get email from auth.users
  SELECT email INTO _email FROM auth.users WHERE id = NEW.id;
  
  IF _email IS NOT NULL THEN
    INSERT INTO public.newsletter_subscribers (email, source, user_id, is_active)
    VALUES (lower(trim(_email)), 'registration', NEW.id, true)
    ON CONFLICT (email) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      is_active = true;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on profiles table (fires after new profile is inserted)
DROP TRIGGER IF EXISTS trg_auto_subscribe_newsletter ON public.profiles;
CREATE TRIGGER trg_auto_subscribe_newsletter
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_subscribe_newsletter();

-- Backfill: insert all existing registered users who are not yet in newsletter_subscribers
INSERT INTO public.newsletter_subscribers (email, source, user_id, is_active)
SELECT lower(trim(au.email)), 'registration', au.id, true
FROM auth.users au
WHERE au.email IS NOT NULL
ON CONFLICT (email) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  source = CASE WHEN newsletter_subscribers.source = 'registration' THEN 'registration' ELSE newsletter_subscribers.source END;
