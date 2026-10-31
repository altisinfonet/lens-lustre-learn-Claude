CREATE OR REPLACE FUNCTION public.trg_entry_status_lifecycle_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _comp_title text;
  _comp_slug  text;
  _round_num  integer;
  _action_url text;
  _site_url   text := 'https://www.50mmretina.com';
  _stage_key  text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title, slug INTO _comp_title, _comp_slug FROM public.competitions WHERE id = NEW.competition_id;
  _round_num := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;
  _action_url := _site_url || '/dashboard?entry=' || NEW.id::text;

  _stage_key := NULLIF(NEW.progression_decision, '');
  IF _stage_key IS NULL THEN
    _stage_key := CASE
      WHEN _round_num = 1 AND NEW.status ILIKE '%shortlist%'        THEN 'r1_shortlisted_r2'
      WHEN _round_num = 1 AND NEW.status = 'approved'                THEN 'r1_accepted'
      WHEN _round_num = 1 AND NEW.status = 'rejected'                THEN 'r1_rejected'
      WHEN _round_num = 1 AND NEW.status ILIKE '%needs%verif%'       THEN 'r1_needs_verification'
      WHEN _round_num = 1 AND NEW.status ILIKE '%needs%review%'      THEN 'r1_needs_verification'
      WHEN _round_num = 2 AND (NEW.status ILIKE '%qualified%' OR NEW.status = 'qualified') THEN 'r2_qualified_r3'
      WHEN _round_num = 2 AND NEW.status = 'approved'                THEN 'r2_accepted'
      WHEN _round_num = 3 AND (NEW.status ILIKE '%qualified%' OR NEW.status = 'qualified') THEN 'r3_qualified_final'
      WHEN _round_num = 3 AND NEW.status = 'approved'                THEN 'r3_accepted'
      WHEN NEW.status = 'winner'              THEN 'r4_winner'
      WHEN NEW.status IN ('runner_up', 'runner_up_1', '1st_runner_up')          THEN 'r4_runner_up_1'
      WHEN NEW.status IN ('runner_up_2', '2nd_runner_up')                       THEN 'r4_runner_up_2'
      WHEN NEW.status IN ('honorable_mention','honourable_mention','honorary_mention') THEN 'r4_honorary_mention'
      WHEN NEW.status = 'special_jury'        THEN 'r4_special_jury'
      WHEN NEW.status = 'top_50'              THEN 'r4_top_50'
      WHEN NEW.status = 'top_100'             THEN 'r4_top_100'
      WHEN NEW.status = 'finalist'            THEN 'r4_finalist'
      ELSE NULL
    END;
  END IF;

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