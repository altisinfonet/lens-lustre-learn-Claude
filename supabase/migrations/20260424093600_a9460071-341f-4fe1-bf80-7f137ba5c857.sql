
-- ============================================================================
-- PHASE 1 — NOTIFICATION BACKBONE
-- ============================================================================

-- 1. FORENSIC LOG -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_emit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                       -- e.g. 'entry_shortlisted', 'verification_request_created'
  entity_id uuid NOT NULL,                  -- entry_id, verification_request_id, round_publish_id
  round_number integer,                     -- nullable for non-round events
  recipient_user_id uuid,                   -- nullable for admin-fanout events
  recipient_email text,
  email_template text,
  in_app_notification_id uuid,
  email_message_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency key: same (kind, entity, round, recipient) can never fire twice
CREATE UNIQUE INDEX IF NOT EXISTS notification_emit_log_idem
  ON public.notification_emit_log (kind, entity_id, COALESCE(round_number, -1), COALESCE(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS notification_emit_log_recipient_idx
  ON public.notification_emit_log (recipient_user_id, created_at DESC);

ALTER TABLE public.notification_emit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read notification_emit_log" ON public.notification_emit_log;
CREATE POLICY "admins read notification_emit_log"
  ON public.notification_emit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- No INSERT/UPDATE/DELETE policies — service role + SECURITY DEFINER only.

-- 2. CORE EMIT FUNCTION -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_notification(
  _kind text,
  _entity_id uuid,
  _round_number integer,
  _recipient_user_id uuid,
  _in_app_type text,
  _in_app_title text,
  _in_app_message text,
  _in_app_reference_id uuid,
  _email_template text,
  _email_data jsonb DEFAULT '{}'::jsonb,
  _action_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _existing_log_id uuid;
  _user_email text;
  _user_name text;
  _notif_id uuid;
  _msg_id text;
  _site_url text := 'https://www.50mmretina.com';
  _final_action_url text;
BEGIN
  -- Idempotency check
  SELECT id INTO _existing_log_id
  FROM public.notification_emit_log
  WHERE kind = _kind
    AND entity_id = _entity_id
    AND COALESCE(round_number, -1) = COALESCE(_round_number, -1)
    AND COALESCE(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF _existing_log_id IS NOT NULL THEN
    RETURN _existing_log_id; -- already emitted; do nothing
  END IF;

  -- Lookup recipient email + name (only if user-targeted)
  IF _recipient_user_id IS NOT NULL THEN
    SELECT email INTO _user_email FROM auth.users WHERE id = _recipient_user_id;
    SELECT COALESCE(full_name, 'there') INTO _user_name FROM public.profiles WHERE id = _recipient_user_id;
  END IF;

  _final_action_url := COALESCE(_action_url, _site_url || '/dashboard');

  -- 1) In-app notification (mark email_sent=true so the generic trigger does NOT also fire)
  IF _recipient_user_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id, email_sent)
    VALUES (_recipient_user_id, _in_app_type, _in_app_title, _in_app_message, _in_app_reference_id, true)
    RETURNING id INTO _notif_id;
  END IF;

  -- 2) Enqueue email (skip silently if no email or template)
  IF _user_email IS NOT NULL AND _email_template IS NOT NULL THEN
    _msg_id := _kind || '-' || _entity_id::text || '-' || COALESCE(_round_number::text, 'na') || '-' || COALESCE(_recipient_user_id::text, 'na');

    PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
      'message_id', _msg_id,
      'to', _user_email,
      'from', '50mm Retina World <noreply@www.50mmretina.com>',
      'sender_domain', 'notify.www.50mmretina.com',
      'subject', _in_app_title || ' — 50mm Retina World',
      'purpose', 'transactional',
      'label', _email_template,
      'idempotency_key', _msg_id,
      'template_name', _email_template,
      'template_data', _email_data || jsonb_build_object(
        'userName', _user_name,
        'actionUrl', _final_action_url
      ),
      'queued_at', now()::text
    ));
  END IF;

  -- 3) Forensic log
  INSERT INTO public.notification_emit_log (
    kind, entity_id, round_number, recipient_user_id, recipient_email,
    email_template, in_app_notification_id, email_message_id, payload
  ) VALUES (
    _kind, _entity_id, _round_number, _recipient_user_id, _user_email,
    _email_template, _notif_id, _msg_id, _email_data
  ) RETURNING id INTO _existing_log_id;

  RETURN _existing_log_id;

EXCEPTION WHEN OTHERS THEN
  -- Never block the parent transaction; log and continue
  RAISE WARNING 'emit_notification failed: kind=% entity=% err=%', _kind, _entity_id, SQLERRM;
  RETURN NULL;
END;
$$;

-- 3. ENTRY STATUS CHANGE TRIGGER (rewritten) ---------------------------------
CREATE OR REPLACE FUNCTION public.notify_entry_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _comp_title text;
  _comp_slug text;
  _round_num integer;
  _action_url text;
  _site_url text := 'https://www.50mmretina.com';
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT title, slug INTO _comp_title, _comp_slug FROM public.competitions WHERE id = NEW.competition_id;
  _round_num := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;
  _action_url := _site_url || '/dashboard?entry=' || NEW.id::text;

  -- shortlisted
  IF NEW.status ILIKE '%shortlist%' THEN
    PERFORM public.emit_notification(
      'entry_shortlisted', NEW.id, _round_num, NEW.user_id,
      'entry_shortlisted', 'Your entry was shortlisted',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been shortlisted.',
      NEW.competition_id,
      'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num),
      _action_url
    );

  -- qualified for next round
  ELSIF NEW.status ILIKE 'round%qualified' OR NEW.status = 'qualified' THEN
    PERFORM public.emit_notification(
      'entry_qualified_round', NEW.id, _round_num, NEW.user_id,
      'entry_qualified', 'You advanced to the next round',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" qualified for Round ' || COALESCE(_round_num + 1, 2) || '.',
      NEW.competition_id,
      'entry-qualified-round',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'nextRound', COALESCE(_round_num, 1) + 1),
      _action_url
    );

  -- rejected
  ELSIF NEW.status = 'rejected' THEN
    PERFORM public.emit_notification(
      'entry_rejected', NEW.id, _round_num, NEW.user_id,
      'entry_rejected', 'Update on your entry',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" did not advance.',
      NEW.competition_id,
      'entry-rejected',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num),
      _action_url
    );

  -- finalist
  ELSIF NEW.status = 'finalist' THEN
    PERFORM public.emit_notification(
      'entry_finalist', NEW.id, _round_num, NEW.user_id,
      'entry_finalist', 'You are a finalist!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" is a finalist.',
      NEW.competition_id,
      'entry-finalist',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title),
      _action_url
    );

  -- winner / runner-up / honorable
  ELSIF NEW.status IN ('winner','runner_up','honorable_mention') THEN
    PERFORM public.emit_notification(
      'entry_award', NEW.id, _round_num, NEW.user_id,
      'competition_winner', 'Congratulations on your award!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" received: ' || NEW.status || '.',
      NEW.competition_id,
      'entry-winner',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'placement', NEW.status),
      _action_url
    );

  -- approved (legacy)
  ELSIF NEW.status = 'approved' THEN
    PERFORM public.emit_notification(
      'entry_approved', NEW.id, _round_num, NEW.user_id,
      'entry_approved', 'Entry Approved',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been approved.',
      NEW.competition_id,
      'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title),
      _action_url
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4. VERIFICATION REQUEST TRIGGERS -------------------------------------------

-- 4a. Created → email participant + notify admins
CREATE OR REPLACE FUNCTION public.notify_verification_request_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _entry_title text;
  _comp_title text;
  _participant_name text;
  _admin_id uuid;
  _action_url text := 'https://www.50mmretina.com/dashboard?verify=' || NEW.id::text;
BEGIN
  SELECT e.title, c.title INTO _entry_title, _comp_title
  FROM public.competition_entries e
  LEFT JOIN public.competitions c ON c.id = e.competition_id
  WHERE e.id = NEW.entry_id;

  SELECT COALESCE(full_name, 'there') INTO _participant_name FROM public.profiles WHERE id = NEW.participant_id;

  -- Participant email
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

  -- Admin in-app fan-out (no email — admins use dashboard)
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
$$;

DROP TRIGGER IF EXISTS trg_notify_verification_request_created ON public.photo_verification_requests;
CREATE TRIGGER trg_notify_verification_request_created
  AFTER INSERT ON public.photo_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_verification_request_created();

-- 4b. Submitted (RAW uploaded) → notify admins (email + in-app)
CREATE OR REPLACE FUNCTION public.notify_verification_request_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _entry_title text;
  _comp_title text;
  _participant_name text;
  _admin_id uuid;
  _admin_url text := 'https://www.50mmretina.com/admin/verifications/' || NEW.id::text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status <> 'submitted' THEN
    RETURN NEW;
  END IF;

  SELECT e.title, c.title INTO _entry_title, _comp_title
  FROM public.competition_entries e
  LEFT JOIN public.competitions c ON c.id = e.competition_id
  WHERE e.id = NEW.entry_id;

  SELECT COALESCE(full_name, 'there') INTO _participant_name FROM public.profiles WHERE id = NEW.participant_id;

  FOR _admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.emit_notification(
      'verification_request_submitted', NEW.id, NEW.round_number, _admin_id,
      'admin_verification_submitted', 'Original file uploaded for verification',
      _participant_name || ' uploaded the original file for "' || COALESCE(_entry_title, 'untitled') || '". Please review.',
      NEW.id,
      'verification-submitted-admin',
      jsonb_build_object(
        'participantName', _participant_name,
        'entryTitle', _entry_title,
        'competitionTitle', _comp_title,
        'roundNumber', NEW.round_number,
        'reviewUrl', _admin_url
      ),
      _admin_url
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_verification_request_submitted ON public.photo_verification_requests;
CREATE TRIGGER trg_notify_verification_request_submitted
  AFTER UPDATE ON public.photo_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_verification_request_submitted();

-- 4c. Decided (approved/rejected) → email participant
CREATE OR REPLACE FUNCTION public.notify_verification_decided()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _entry_title text;
  _comp_title text;
  _participant_name text;
  _action_url text := 'https://www.50mmretina.com/dashboard?entry=' || NEW.entry_id::text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('approved','rejected') THEN
    RETURN NEW;
  END IF;

  SELECT e.title, c.title INTO _entry_title, _comp_title
  FROM public.competition_entries e
  LEFT JOIN public.competitions c ON c.id = e.competition_id
  WHERE e.id = NEW.entry_id;

  SELECT COALESCE(full_name, 'there') INTO _participant_name FROM public.profiles WHERE id = NEW.participant_id;

  PERFORM public.emit_notification(
    'verification_decided', NEW.id, NEW.round_number, NEW.participant_id,
    'verification_' || NEW.status,
    CASE WHEN NEW.status='approved' THEN 'Verification approved' ELSE 'Verification rejected' END,
    'Your verification for "' || COALESCE(_entry_title, 'your entry') || '" was ' || NEW.status || '.',
    NEW.entry_id,
    'verification-decision',
    jsonb_build_object(
      'participantName', _participant_name,
      'entryTitle', _entry_title,
      'competitionTitle', _comp_title,
      'roundNumber', NEW.round_number,
      'decision', NEW.status,
      'adminNote', NEW.admin_note
    ),
    _action_url
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_verification_decided ON public.photo_verification_requests;
CREATE TRIGGER trg_notify_verification_decided
  AFTER UPDATE ON public.photo_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_verification_decided();

-- 5. ROUND PUBLISHED → fan-out to all participants ---------------------------
CREATE OR REPLACE FUNCTION public.notify_round_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _comp_title text;
  _entry record;
  _action_url text;
  _site_url text := 'https://www.50mmretina.com';
BEGIN
  -- Only fire when published_at transitions from NULL to non-null
  IF OLD.published_at IS NOT NULL OR NEW.published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;

  FOR _entry IN
    SELECT id, user_id, title, status
    FROM public.competition_entries
    WHERE competition_id = NEW.competition_id
  LOOP
    _action_url := _site_url || '/dashboard?entry=' || _entry.id::text;
    PERFORM public.emit_notification(
      'round_published', _entry.id, NEW.round_number, _entry.user_id,
      'round_results_published', 'Round ' || NEW.round_number || ' results are out',
      'Round ' || NEW.round_number || ' results for "' || COALESCE(_comp_title, 'the competition') || '" are now available. Your entry status: ' || _entry.status || '.',
      NEW.competition_id,
      'round-published-summary',
      jsonb_build_object(
        'competitionTitle', _comp_title,
        'roundNumber', NEW.round_number,
        'entryTitle', _entry.title,
        'entryStatus', _entry.status
      ),
      _action_url
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_round_published ON public.competition_round_publish;
CREATE TRIGGER trg_notify_round_published
  AFTER UPDATE ON public.competition_round_publish
  FOR EACH ROW EXECUTE FUNCTION public.notify_round_published();

-- Also fire on INSERT when a new publish row comes in pre-published
CREATE OR REPLACE FUNCTION public.notify_round_published_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _comp_title text;
  _entry record;
  _action_url text;
  _site_url text := 'https://www.50mmretina.com';
BEGIN
  IF NEW.published_at IS NULL THEN RETURN NEW; END IF;

  SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;

  FOR _entry IN
    SELECT id, user_id, title, status
    FROM public.competition_entries
    WHERE competition_id = NEW.competition_id
  LOOP
    _action_url := _site_url || '/dashboard?entry=' || _entry.id::text;
    PERFORM public.emit_notification(
      'round_published', _entry.id, NEW.round_number, _entry.user_id,
      'round_results_published', 'Round ' || NEW.round_number || ' results are out',
      'Round ' || NEW.round_number || ' results for "' || COALESCE(_comp_title, 'the competition') || '" are now available. Your entry status: ' || _entry.status || '.',
      NEW.competition_id,
      'round-published-summary',
      jsonb_build_object(
        'competitionTitle', _comp_title,
        'roundNumber', NEW.round_number,
        'entryTitle', _entry.title,
        'entryStatus', _entry.status
      ),
      _action_url
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_round_published_insert ON public.competition_round_publish;
CREATE TRIGGER trg_notify_round_published_insert
  AFTER INSERT ON public.competition_round_publish
  FOR EACH ROW EXECUTE FUNCTION public.notify_round_published_insert();
