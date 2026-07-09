
CREATE OR REPLACE FUNCTION public.notify_new_follower()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_name text;
BEGIN
  IF NEW.follower_id = NEW.following_id THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.follower_id;
  INSERT INTO public.user_notifications (user_id, actor_id, type, title, message, reference_id)
  VALUES (NEW.following_id, NEW.follower_id, 'new_follower', 'New Follower', _actor_name || ' started following you', NEW.follower_id::uuid);
  RETURN NEW;
END;
$function$;
