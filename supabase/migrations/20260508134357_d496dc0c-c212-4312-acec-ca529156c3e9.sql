-- SAFE-MICRO continuation: app.write_path suppression guards
-- Ship per audited V3 plan. Bodies below are byte-identical to live pg_proc
-- definitions captured 2026-05-08, with ONE added guard block right after BEGIN.

CREATE OR REPLACE FUNCTION public.notify_entry_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _comp_title text;
  _comp_slug text;
  _round_num integer;
  _action_url text;
  _site_url text := 'https://www.50mmretina.com';
  _stage_key text;
BEGIN
  -- SAFE-MICRO suppression guard (2026-05-08).
  -- Only the future judging_write_decision_atomic RPC sets this GUC.
  -- All existing writers (publish-round, complete-round, manual SQL, backfill,
  -- participant resubmit, mirror_system_tag_to_decision) leave it NULL → no effect.
  IF current_setting('app.write_path', true) = 'judging_write_decision_atomic' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title, slug INTO _comp_title, _comp_slug FROM public.competitions WHERE id = NEW.competition_id;
  _round_num := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;
  _action_url := _site_url || '/dashboard?entry=' || NEW.id::text;
  _stage_key := public._resolve_stage_key_from_entry(NEW.status, NEW.current_round, NEW.progression_decision);

  IF NEW.status ILIKE '%shortlist%' THEN
    PERFORM public.emit_notification(
      'entry_shortlisted', NEW.id, _round_num, NEW.user_id,
      'entry_shortlisted', 'Your entry was shortlisted',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been shortlisted.',
      NEW.competition_id, 'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status ILIKE 'round%qualified' OR NEW.status = 'qualified' THEN
    PERFORM public.emit_notification(
      'entry_qualified_round', NEW.id, _round_num, NEW.user_id,
      'entry_qualified', 'You advanced to the next round',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" qualified for Round ' || COALESCE(_round_num + 1, 2) || '.',
      NEW.competition_id, 'entry-qualified-round',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'nextRound', COALESCE(_round_num, 1) + 1, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status = 'rejected' THEN
    PERFORM public.emit_notification(
      'entry_rejected', NEW.id, _round_num, NEW.user_id,
      'entry_rejected', 'Update on your entry',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" did not advance.',
      NEW.competition_id, 'entry-rejected',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status = 'finalist' THEN
    PERFORM public.emit_notification(
      'entry_finalist', NEW.id, _round_num, NEW.user_id,
      'entry_finalist', 'You are a finalist!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" is a finalist.',
      NEW.competition_id, 'entry-finalist',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status IN ('winner','runner_up','runner_up_1','runner_up_2','honorable_mention','honourable_mention','honorary_mention','special_jury','top_50','top_100') THEN
    PERFORM public.emit_notification(
      'entry_award', NEW.id, _round_num, NEW.user_id,
      'competition_winner', 'Congratulations on your award!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" received: ' || NEW.status || '.',
      NEW.competition_id, 'entry-winner',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'placement', NEW.status, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status = 'approved' THEN
    PERFORM public.emit_notification(
      'entry_approved', NEW.id, _round_num, NEW.user_id,
      'entry_approved', 'Entry Approved',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been approved.',
      NEW.competition_id, 'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'stageKey', _stage_key),
      _action_url
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_certificate_on_r4_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _comp_title text;
  _cert_type text;
  _cert_title text;
  _cert_desc text;
  _placement text;
  _round_text text;
BEGIN
  -- SAFE-MICRO suppression guard (2026-05-08). See sibling notify trigger.
  IF current_setting('app.write_path', true) = 'judging_write_decision_atomic' THEN
    RETURN NEW;
  END IF;

  -- Only act when status or placement transitions on an R4 entry
  IF (NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.placement IS DISTINCT FROM OLD.placement) THEN

    -- Hard gate: certificates are only issued from Round 4
    _round_text := COALESCE(NEW.current_round, '');
    IF _round_text NOT IN ('4','round4','r4') THEN
      RETURN NEW;
    END IF;

    _placement := COALESCE(NEW.placement, '');
    IF NEW.status = 'winner' THEN
      _cert_type := 'competition_winner';
      _cert_title := 'Winner Certificate';
    ELSIF _placement = 'runner_up_1' THEN
      _cert_type := 'competition_runner_up_1';
      _cert_title := '1st Runner-Up Certificate';
    ELSIF _placement = 'runner_up_2' THEN
      _cert_type := 'competition_runner_up_2';
      _cert_title := '2nd Runner-Up Certificate';
    ELSIF _placement = 'honorary_mention' THEN
      _cert_type := 'competition_honorary_mention';
      _cert_title := 'Honorary Mention Certificate';
    ELSIF _placement = 'special_jury' THEN
      _cert_type := 'competition_special_jury';
      _cert_title := 'Special Jury Award Certificate';
    ELSIF _placement = 'top_50' THEN
      _cert_type := 'competition_top_50';
      _cert_title := 'Top 50 Certificate';
    ELSIF _placement = 'top_100' THEN
      _cert_type := 'competition_top_100';
      _cert_title := 'Top 100 Certificate';
    ELSE
      RETURN NEW;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.certificates
      WHERE user_id = NEW.user_id
        AND reference_id = NEW.competition_id
        AND type = _cert_type
        AND is_revoked = false
    ) THEN
      RETURN NEW;
    END IF;

    SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;
    _cert_desc := 'Awarded in ' || COALESCE(_comp_title, 'competition') || ' (Round 4)';

    INSERT INTO public.certificates (user_id, title, description, type, reference_id)
    VALUES (
      NEW.user_id,
      COALESCE(_comp_title, 'Competition') || ' — ' || _cert_title,
      _cert_desc,
      _cert_type,
      NEW.competition_id
    );
  END IF;

  RETURN NEW;
END;
$function$;