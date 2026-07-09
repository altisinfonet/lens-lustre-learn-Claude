-- Fire the missing notification for the stuck pending row
DO $$
DECLARE
  _entry_title text;
  _comp_title text;
  _participant_name text;
  _admin_id uuid;
  _row record;
  _action_url text;
  _emit_id uuid;
BEGIN
  SELECT * INTO _row FROM public.photo_verification_requests
  WHERE id = 'c6a16757-42c1-4dc8-a68b-993c7853f3e9';

  IF _row IS NULL THEN
    RAISE NOTICE 'No row found';
    RETURN;
  END IF;

  _action_url := 'https://www.50mmretina.com/dashboard?verify=' || _row.id::text;

  SELECT e.title, c.title INTO _entry_title, _comp_title
  FROM public.competition_entries e
  LEFT JOIN public.competitions c ON c.id = e.competition_id
  WHERE e.id = _row.entry_id;

  SELECT COALESCE(full_name, 'there') INTO _participant_name
  FROM public.profiles WHERE id = _row.participant_id;

  -- Participant
  _emit_id := public.emit_notification(
    'verification_request_created', _row.id, _row.round_number, _row.participant_id,
    'verification_required', 'Verification needed for your photo',
    'A judge requested verification for one of your photos in "' || COALESCE(_comp_title, 'the competition') || '". Please upload the original/RAW file.',
    _row.entry_id,
    'photo-verification-request',
    jsonb_build_object(
      'participantName', _participant_name,
      'entryTitle', _entry_title,
      'competitionTitle', _comp_title,
      'roundNumber', _row.round_number,
      'verificationUrl', _action_url
    ),
    _action_url
  );
  RAISE NOTICE 'Participant emit_id: %', _emit_id;

  -- Admin fan-out (in-app only)
  FOR _admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.emit_notification(
      'verification_request_created_admin', _row.id, _row.round_number, _admin_id,
      'admin_verification_pending', 'Verification request sent',
      'A verification request was sent to ' || _participant_name || ' for entry "' || COALESCE(_entry_title, 'untitled') || '".',
      _row.id,
      NULL, NULL, NULL
    );
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public._diag_emit_test();