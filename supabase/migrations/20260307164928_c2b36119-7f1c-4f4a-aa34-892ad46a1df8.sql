CREATE OR REPLACE FUNCTION public.notify_user_ticket_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ticket_user_id uuid;
  _ticket_subject text;
BEGIN
  IF NEW.is_admin = false THEN
    RETURN NEW;
  END IF;

  SELECT user_id, subject INTO _ticket_user_id, _ticket_subject
  FROM public.support_tickets WHERE id = NEW.ticket_id;

  INSERT INTO public.user_notifications (user_id, type, title, message, reference_id)
  VALUES (
    _ticket_user_id,
    'ticket_reply',
    'Support Reply',
    '50mm Retina World Support replied to: ' || _ticket_subject,
    NEW.ticket_id
  );

  RETURN NEW;
END;
$function$;