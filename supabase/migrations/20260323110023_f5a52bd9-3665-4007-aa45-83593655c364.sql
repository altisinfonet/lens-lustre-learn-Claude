
CREATE OR REPLACE FUNCTION public.send_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user_email text;
  _user_name text;
  _site_url text := 'https://www.50mmretina.com';
  _action_url text;
  _unsubscribe_token text;
  _html text;
  _plain_text text;
  _subject text;
  _message_id text;
  _notification_type text;
  _notification_message text;
BEGIN
  SELECT email INTO _user_email FROM auth.users WHERE id = NEW.user_id;
  IF _user_email IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.suppressed_emails
    WHERE email = lower(_user_email)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'there') INTO _user_name
  FROM public.profiles WHERE id = NEW.user_id;

  _notification_type := COALESCE(NEW.title, 'Notification');
  _notification_message := COALESCE(NEW.message, 'You have a new update on your account.');
  _message_id := gen_random_uuid()::text;

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

  SELECT token INTO _unsubscribe_token
  FROM public.email_unsubscribe_tokens
  WHERE email = lower(_user_email) AND used_at IS NULL
  LIMIT 1;

  IF _unsubscribe_token IS NULL THEN
    _unsubscribe_token := encode(gen_random_bytes(32), 'hex');
    INSERT INTO public.email_unsubscribe_tokens (token, email)
    VALUES (_unsubscribe_token, lower(_user_email))
    ON CONFLICT (email) DO NOTHING;
    SELECT token INTO _unsubscribe_token
    FROM public.email_unsubscribe_tokens
    WHERE email = lower(_user_email) AND used_at IS NULL
    LIMIT 1;
  END IF;

  _subject := _notification_type || E' \u2014 50mm Retina World';

  _html := '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"/></head>'
    || '<body style="background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;">'
    || '<div style="padding:32px 24px;max-width:480px;margin:0 auto;">'
    || '<h1 style="font-size:20px;font-weight:700;color:#1c2d41;margin:0 0 8px;">Hi ' || _user_name || ',</h1>'
    || '<p style="font-size:11px;font-weight:600;color:#0284c7;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">'
    || _notification_type || '</p>'
    || '<p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px;">'
    || _notification_message || '</p>'
    || '<a href="' || _action_url || '" style="display:inline-block;background-color:#0284c7;color:#f0f9ff;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">View Now</a>'
    || '<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;"/>'
    || '<p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">You are receiving this because you have an account on 50mm Retina World.</p>'
    || '</div></body></html>';

  _plain_text := 'Hi ' || _user_name || ',' || E'\n\n'
    || _notification_type || E'\n\n'
    || _notification_message || E'\n\n'
    || 'View Now: ' || _action_url || E'\n\n'
    || '---' || E'\n'
    || 'You are receiving this because you have an account on 50mm Retina World.';

  INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status)
  VALUES (_message_id, 'notification-alert', _user_email, 'pending');

  PERFORM enqueue_email('transactional_emails', jsonb_build_object(
    'message_id', _message_id,
    'to', _user_email,
    'from', '50mm Retina World <noreply@www.50mmretina.com>',
    'sender_domain', 'notify.www.50mmretina.com',
    'subject', _subject,
    'html', _html,
    'text', _plain_text,
    'purpose', 'transactional',
    'label', 'notification-alert',
    'idempotency_key', 'notif-' || NEW.id,
    'unsubscribe_token', _unsubscribe_token,
    'queued_at', now()::text
  ));

  UPDATE public.user_notifications SET email_sent = true WHERE id = NEW.id;

  RETURN NEW;
END;
$function$
