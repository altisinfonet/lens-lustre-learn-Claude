-- ============================================================
-- Ruleset v4 — STEP 2 DB migration (2026-04-29)
-- Goals:
--   1. Drop 'stay' from judge_decisions.decision CHECK
--   2. Drop 'stay' from progression_decision CHECK
--   3. Soft-delete the 2 "Stayed at R2/R3" judging tags
--   4. Add certificates.is_revoked + revoked_at + revoked_reason
--   5. Rebuild entry_public_status view WITHOUT stay branches
--   6. Rebuild notify_entry_status_change trigger WITHOUT stay branch
-- Pre-check confirmed: ZERO rows currently use decision='stay' or
-- progression_decision='stay' (Phase 2b never received traffic).
-- ============================================================

-- 1. judge_decisions: drop 'stay'
ALTER TABLE public.judge_decisions DROP CONSTRAINT IF EXISTS judge_decisions_decision_check;
ALTER TABLE public.judge_decisions
  ADD CONSTRAINT judge_decisions_decision_check
  CHECK (decision = ANY (ARRAY['accept'::text,'reject'::text,'shortlist'::text,'needs_review'::text,'qualified'::text,'finalist'::text,'winner'::text,'skip'::text]));

-- 2. competition_entries.progression_decision: drop 'stay'
ALTER TABLE public.competition_entries DROP CONSTRAINT IF EXISTS progression_decision_valid;
ALTER TABLE public.competition_entries
  ADD CONSTRAINT progression_decision_valid
  CHECK (progression_decision IS NULL OR progression_decision = ANY (ARRAY['shortlisted'::text,'qualified'::text,'accept'::text,'needs_review'::text,'reject'::text,'winner'::text,'finalist'::text,'pending_verification'::text]));

-- 3. Soft-delete the 2 Stay tags (ids verified in pre-check)
UPDATE public.judging_tags
SET is_active = false, is_visible = false
WHERE id IN ('37c160fd-149a-4795-9464-2e5860d1fff2','e2b179a8-3093-4cdd-8df4-282ac42a85f4');

-- 4. certificates: add revocation columns
ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS is_revoked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revoked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS revoked_reason text;
CREATE INDEX IF NOT EXISTS idx_certificates_is_revoked ON public.certificates (is_revoked) WHERE is_revoked = true;

-- 5. Rebuild entry_public_status WITHOUT stay branches
CREATE OR REPLACE VIEW public.entry_public_status AS
SELECT
  id AS entry_id,
  competition_id,
  CASE
    WHEN (status = ANY (ARRAY['winner'::text,'finalist'::text,'qualified_final'::text]))
      AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL)
      THEN status
    WHEN status = 'shortlisted'::text
      AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 3 AND p.published_at IS NOT NULL)
      THEN status
    WHEN status = 'round2_qualified'::text
      AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 2 AND p.published_at IS NOT NULL)
      THEN status
    WHEN (status = ANY (ARRAY['round1_qualified'::text,'rejected'::text]))
      AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 1 AND p.published_at IS NOT NULL)
      THEN status
    WHEN status = ANY (ARRAY['submitted'::text,'needs_review'::text]) THEN status
    ELSE 'judging_in_progress'::text
  END AS public_status,
  CASE
    WHEN EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL)
      THEN current_round
    ELSE NULL::text
  END AS public_round,
  CASE
    WHEN progression_decision = 'reject'::text
      AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = NULLIF(regexp_replace(COALESCE(e.current_round,''),'[^0-9]','','g'),'')::integer AND p.published_at IS NOT NULL)
      THEN 'not_selected_for_next_round'::text
    ELSE NULL::text
  END AS public_progression_note,
  CASE
    WHEN placement IS NOT NULL
      AND EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL)
      THEN placement
    ELSE NULL::text
  END AS public_placement,
  CASE
    WHEN EXISTS (SELECT 1 FROM competition_round_publish p WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL)
      THEN (SELECT array_agg(DISTINCT jt.label ORDER BY jt.label)
              FROM judge_tag_assignments jta
              JOIN judging_tags jt ON jt.id = jta.tag_id
             WHERE jta.entry_id = e.id
               AND jt.is_active = true
               AND jt.is_visible = true
               AND 4 = ANY (jt.visible_in_round)
               AND jt.label = ANY (ARRAY['Top 50'::text,'Top 100'::text]))
    ELSE NULL::text[]
  END AS public_r4_tags
FROM public.competition_entries e;

-- 6. Rebuild notify_entry_status_change WITHOUT stay branch
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
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title, slug INTO _comp_title, _comp_slug FROM public.competitions WHERE id = NEW.competition_id;
  _round_num := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;
  _action_url := _site_url || '/dashboard?entry=' || NEW.id::text;

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

-- Optional: drop the SQL helper that mapped 'Stayed at RN' → 'stay'
DROP FUNCTION IF EXISTS public.tag_label_to_decision(text);
