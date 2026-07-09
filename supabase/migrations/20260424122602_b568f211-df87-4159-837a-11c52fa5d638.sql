CREATE OR REPLACE FUNCTION public._diag_emit_test()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _name text;
  _notif_id uuid;
  _msg_id text;
BEGIN
  SELECT email INTO _email FROM auth.users WHERE id = 'cc691988-699f-4da5-9b2e-f2346c7303be';
  SELECT COALESCE(full_name, 'there') INTO _name FROM public.profiles WHERE id = 'cc691988-699f-4da5-9b2e-f2346c7303be';

  INSERT INTO public.user_notifications (user_id, type, title, message, reference_id, email_sent)
  VALUES ('cc691988-699f-4da5-9b2e-f2346c7303be', 'verification_required', 'DIAG title', 'DIAG msg', '51768229-864b-48fc-b4f3-da6d456b096b', true)
  RETURNING id INTO _notif_id;

  _msg_id := 'diag-' || gen_random_uuid()::text;

  PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
    'message_id', _msg_id,
    'to', _email,
    'from', '50mm Retina World <noreply@www.50mmretina.com>',
    'sender_domain', 'notify.www.50mmretina.com',
    'subject', 'DIAG subject',
    'purpose', 'transactional',
    'label', 'photo-verification-request',
    'idempotency_key', _msg_id,
    'template_name', 'photo-verification-request',
    'template_data', jsonb_build_object('userName', _name),
    'queued_at', now()::text
  ));

  RETURN format('OK email=%s notif=%s msg=%s', _email, _notif_id, _msg_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public._diag_emit_test() TO anon, authenticated;