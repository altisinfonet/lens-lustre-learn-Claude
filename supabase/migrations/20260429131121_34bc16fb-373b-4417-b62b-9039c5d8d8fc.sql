-- Phase 2b: R2/R3 Three-Bucket — DB engine pieces
-- 1) Allow 'stay' in progression_decision CHECK
ALTER TABLE public.competition_entries
  DROP CONSTRAINT IF EXISTS progression_decision_valid;

ALTER TABLE public.competition_entries
  ADD CONSTRAINT progression_decision_valid
  CHECK (
    progression_decision IS NULL OR progression_decision = ANY (ARRAY[
      'shortlisted','qualified','accept','needs_review','reject',
      'winner','finalist','pending_verification','stay'
    ])
  );

-- 2) Extend entry_public_status view to surface Stay outcomes
CREATE OR REPLACE VIEW public.entry_public_status AS
SELECT id AS entry_id,
    competition_id,
    CASE
        WHEN progression_decision = 'stay'
             AND current_round IN ('2','round2','r2')
             AND EXISTS (
               SELECT 1 FROM competition_round_publish p
               WHERE p.competition_id = e.competition_id
                 AND p.round_number = 2 AND p.published_at IS NOT NULL
             ) THEN 'stayed_at_r2'
        WHEN progression_decision = 'stay'
             AND current_round IN ('3','round3','r3')
             AND EXISTS (
               SELECT 1 FROM competition_round_publish p
               WHERE p.competition_id = e.competition_id
                 AND p.round_number = 3 AND p.published_at IS NOT NULL
             ) THEN 'stayed_at_r3'
        WHEN (status = ANY (ARRAY['winner'::text, 'finalist'::text, 'qualified_final'::text]))
             AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL) THEN status
        WHEN status = 'shortlisted'::text
             AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 3 AND p.published_at IS NOT NULL) THEN status
        WHEN status = 'round2_qualified'::text
             AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 2 AND p.published_at IS NOT NULL) THEN status
        WHEN (status = ANY (ARRAY['round1_qualified'::text, 'rejected'::text]))
             AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 1 AND p.published_at IS NOT NULL) THEN status
        WHEN status = ANY (ARRAY['submitted'::text, 'needs_review'::text]) THEN status
        ELSE 'judging_in_progress'::text
    END AS public_status,
    CASE
        WHEN EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL) THEN current_round
        ELSE NULL::text
    END AS public_round,
    CASE
        WHEN progression_decision = 'not_selected'
             AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = NULLIF(regexp_replace(COALESCE(e.current_round, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AND p.published_at IS NOT NULL)
        THEN 'not_selected_for_next_round'::text
        ELSE NULL::text
    END AS public_progression_note,
    CASE
        WHEN placement IS NOT NULL AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL) THEN placement
        ELSE NULL::text
    END AS public_placement,
    CASE
        WHEN EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL) THEN
            (SELECT array_agg(DISTINCT jt.label ORDER BY jt.label)
             FROM judge_tag_assignments jta
             JOIN judging_tags jt ON jt.id = jta.tag_id
             WHERE jta.entry_id = e.id AND jt.is_active = true AND jt.is_visible = true
               AND (4 = ANY (jt.visible_in_round))
               AND jt.label = ANY (ARRAY['Top 50'::text, 'Top 100'::text]))
        ELSE NULL::text[]
    END AS public_r4_tags
FROM public.competition_entries e;

-- 3) Recreate notify_entry_status_change to ALSO fire on progression_decision='stay'
--    (status doesn't change for Stay entries, so the existing IS DISTINCT FROM gate skips them)
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
  _stay_changed boolean := false;
  _status_changed boolean := false;
BEGIN
  _status_changed := (OLD.status IS DISTINCT FROM NEW.status);
  _stay_changed := (
    NEW.progression_decision = 'stay'
    AND OLD.progression_decision IS DISTINCT FROM NEW.progression_decision
  );

  IF NOT (_status_changed OR _stay_changed) THEN
    RETURN NEW;
  END IF;

  SELECT title, slug INTO _comp_title, _comp_slug FROM public.competitions WHERE id = NEW.competition_id;
  _round_num := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;
  _action_url := _site_url || '/dashboard?entry=' || NEW.id::text;

  -- Stay-at-round (R2 or R3): emit ONLY when progression_decision flips to 'stay'
  IF _stay_changed THEN
    PERFORM public.emit_notification(
      'entry_stayed_at_round', NEW.id, _round_num, NEW.user_id,
      'entry_stayed_at_round',
      'You earned a Round ' || COALESCE(_round_num::text, '') || ' certificate',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" stayed at Round ' || COALESCE(_round_num::text, '') || ' and earned a certificate.',
      NEW.competition_id,
      'entry-stayed-at-round',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num),
      _action_url
    );
    RETURN NEW;
  END IF;

  -- Status-driven branches (unchanged behaviour)
  IF NEW.status ILIKE '%shortlist%' THEN
    PERFORM public.emit_notification(
      'entry_shortlisted', NEW.id, _round_num, NEW.user_id,
      'entry_shortlisted', 'Your entry was shortlisted',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been shortlisted.',
      NEW.competition_id, 'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num),
      _action_url
    );
  ELSIF NEW.status ILIKE 'round%qualified' OR NEW.status = 'qualified' THEN
    PERFORM public.emit_notification(
      'entry_qualified_round', NEW.id, _round_num, NEW.user_id,
      'entry_qualified', 'You advanced to the next round',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" qualified for Round ' || COALESCE(_round_num + 1, 2) || '.',
      NEW.competition_id, 'entry-qualified-round',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'nextRound', COALESCE(_round_num, 1) + 1),
      _action_url
    );
  ELSIF NEW.status = 'rejected' THEN
    PERFORM public.emit_notification(
      'entry_rejected', NEW.id, _round_num, NEW.user_id,
      'entry_rejected', 'Update on your entry',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" did not advance.',
      NEW.competition_id, 'entry-rejected',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num),
      _action_url
    );
  ELSIF NEW.status = 'finalist' THEN
    PERFORM public.emit_notification(
      'entry_finalist', NEW.id, _round_num, NEW.user_id,
      'entry_finalist', 'You are a finalist!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" is a finalist.',
      NEW.competition_id, 'entry-finalist',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title),
      _action_url
    );
  ELSIF NEW.status IN ('winner','runner_up','honorable_mention') THEN
    PERFORM public.emit_notification(
      'entry_award', NEW.id, _round_num, NEW.user_id,
      'competition_winner', 'Congratulations on your award!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" received: ' || NEW.status || '.',
      NEW.competition_id, 'entry-winner',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'placement', NEW.status),
      _action_url
    );
  ELSIF NEW.status = 'approved' THEN
    PERFORM public.emit_notification(
      'entry_approved', NEW.id, _round_num, NEW.user_id,
      'entry_approved', 'Entry Approved',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been approved.',
      NEW.competition_id, 'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title),
      _action_url
    );
  END IF;

  RETURN NEW;
END;
$function$;