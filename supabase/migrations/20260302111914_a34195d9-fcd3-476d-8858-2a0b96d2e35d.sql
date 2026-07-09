
-- User notifications table for ticket reply alerts etc.
CREATE TABLE public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'ticket_reply',
  title text NOT NULL,
  message text NOT NULL,
  reference_id uuid NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.user_notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications" ON public.user_notifications
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "System can insert notifications" ON public.user_notifications
  FOR INSERT WITH CHECK (true);

-- Trigger: notify user when admin replies to their ticket
CREATE OR REPLACE FUNCTION public.notify_user_ticket_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ticket_user_id uuid;
  _ticket_subject text;
BEGIN
  -- Only fire for admin replies
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
    '50mm Retina Support replied to: ' || _ticket_subject,
    NEW.ticket_id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_admin_ticket_reply
  AFTER INSERT ON public.ticket_replies
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_user_ticket_reply();
