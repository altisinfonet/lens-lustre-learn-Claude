-- 1) Add 'pending_verification' to the allowed progression_decision values.
ALTER TABLE public.competition_entries
  DROP CONSTRAINT IF EXISTS progression_decision_valid;

ALTER TABLE public.competition_entries
  ADD CONSTRAINT progression_decision_valid
  CHECK (
    progression_decision IS NULL OR progression_decision = ANY (ARRAY[
      'shortlisted','qualified','accept','needs_review','reject',
      'winner','finalist','pending_verification'
    ])
  );

-- 2) Extend the INSERT trigger so the hold-flip is automatic and atomic.
CREATE OR REPLACE FUNCTION public.notify_verification_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _entry_title text;
  _comp_title text;
  _participant_name text;
  _admin_id uuid;
  _action_url text := 'https://www.50mmretina.com/dashboard?verify=' || NEW.id::text;
  _current_decision text;
BEGIN
  SELECT e.title, c.title, e.progression_decision
    INTO _entry_title, _comp_title, _current_decision
  FROM public.competition_entries e
  LEFT JOIN public.competitions c ON c.id = e.competition_id
  WHERE e.id = NEW.entry_id;

  SELECT COALESCE(full_name, 'there') INTO _participant_name
  FROM public.profiles WHERE id = NEW.participant_id;

  -- Atomic hold. Preserve terminal states (winner/finalist/reject).
  IF _current_decision IS NULL OR _current_decision IN (
    'qualified','shortlisted','needs_review','accept'
  ) THEN
    UPDATE public.competition_entries
       SET progression_decision = 'pending_verification'
     WHERE id = NEW.entry_id;
  END IF;

  PERFORM public.emit_notification(
    'verification_request_created', NEW.id, NEW.round_number, NEW.participant_id,
    'verification_required', 'Verification needed for your photo',
    'A judge requested verification for one of your photos in "' || COALESCE(_comp_title, 'the competition') || '". Please upload the original/RAW file.',
    NEW.entry_id,
    'photo-verification-request',
    jsonb_build_object(
      'participantName', _participant_name,
      'entryTitle', _entry_title,
      'competitionTitle', _comp_title,
      'roundNumber', NEW.round_number,
      'verificationUrl', _action_url
    ),
    _action_url
  );

  FOR _admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.emit_notification(
      'verification_request_created_admin', NEW.id, NEW.round_number, _admin_id,
      'admin_verification_pending', 'Verification request sent',
      'A verification request was sent to ' || _participant_name || ' for entry "' || COALESCE(_entry_title, 'untitled') || '".',
      NEW.id,
      NULL, NULL, NULL
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 3) Apply the missing hold to the one stuck row.
UPDATE public.competition_entries
   SET progression_decision = 'pending_verification'
 WHERE id = '51768229-864b-48fc-b4f3-da6d456b096b'
   AND EXISTS (
     SELECT 1 FROM public.photo_verification_requests
     WHERE entry_id = '51768229-864b-48fc-b4f3-da6d456b096b'
       AND status = 'pending'
   );