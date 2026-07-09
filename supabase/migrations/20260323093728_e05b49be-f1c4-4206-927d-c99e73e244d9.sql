
-- Create a function that triggers email sending for new notifications
-- This uses pg_net to call the send-transactional-email edge function
CREATE OR REPLACE FUNCTION public.send_notification_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _user_email text;
  _user_name text;
  _site_url text := 'https://www.50mmretina.com';
  _action_url text;
BEGIN
  -- Get user email from auth.users
  SELECT email INTO _user_email FROM auth.users WHERE id = NEW.user_id;
  IF _user_email IS NULL THEN RETURN NEW; END IF;
  
  -- Get user name
  SELECT COALESCE(full_name, 'there') INTO _user_name FROM public.profiles WHERE id = NEW.user_id;
  
  -- Determine action URL based on type
  _action_url := CASE
    WHEN NEW.type IN ('post_reaction', 'post_comment') THEN _site_url || '/feed'
    WHEN NEW.type IN ('image_reaction', 'image_comment', 'comment_reply') THEN _site_url || '/discover'
    WHEN NEW.type IN ('competition_vote', 'entry_approved', 'entry_rejected', 'competition_winner') THEN 
      CASE WHEN NEW.reference_id IS NOT NULL THEN _site_url || '/competitions/' || NEW.reference_id ELSE _site_url || '/competitions' END
    WHEN NEW.type = 'new_follower' THEN 
      CASE WHEN NEW.reference_id IS NOT NULL THEN _site_url || '/profile/' || NEW.reference_id ELSE _site_url || '/friends' END
    WHEN NEW.type = 'ticket_reply' THEN _site_url || '/help-support'
    ELSE _site_url || '/dashboard'
  END;
  
  -- Enqueue the email
  PERFORM enqueue_email('transactional_emails', jsonb_build_object(
    'message_id', gen_random_uuid()::text,
    'to', _user_email,
    'from', '50mm Retina World <noreply@www.50mmretina.com>',
    'sender_domain', 'notify.www.50mmretina.com',
    'subject', NEW.title || ' — 50mm Retina World',
    'purpose', 'transactional',
    'label', 'notification-alert',
    'idempotency_key', 'notif-' || NEW.id,
    'template_name', 'notification-alert',
    'template_data', jsonb_build_object(
      'userName', _user_name,
      'notificationType', NEW.title,
      'message', NEW.message,
      'actionUrl', _action_url,
      'actionLabel', 'View Now'
    ),
    'queued_at', now()::text
  ));
  
  -- Mark email as sent
  UPDATE public.user_notifications SET email_sent = true WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_send_notification_email ON public.user_notifications;
CREATE TRIGGER trg_send_notification_email AFTER INSERT ON public.user_notifications
FOR EACH ROW EXECUTE FUNCTION public.send_notification_email();
