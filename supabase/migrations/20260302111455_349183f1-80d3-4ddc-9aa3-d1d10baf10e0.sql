
-- Admin notifications table for system events like new support tickets
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'support_ticket',
  title text NOT NULL,
  message text NOT NULL,
  reference_id uuid NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage admin notifications
CREATE POLICY "Admins can manage admin notifications" ON public.admin_notifications FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger function: auto-create admin notification when a support ticket is created
CREATE OR REPLACE FUNCTION public.notify_admin_new_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user_name text;
BEGIN
  SELECT full_name INTO _user_name FROM public.profiles WHERE id = NEW.user_id;
  
  INSERT INTO public.admin_notifications (type, title, message, reference_id)
  VALUES (
    'support_ticket',
    'New Support Ticket',
    COALESCE(_user_name, 'A user') || ' submitted: ' || NEW.subject,
    NEW.id
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_new_support_ticket
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_new_ticket();
