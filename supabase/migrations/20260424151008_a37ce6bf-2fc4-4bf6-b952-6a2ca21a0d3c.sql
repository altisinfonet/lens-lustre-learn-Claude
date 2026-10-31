-- Phase 2: Round N eligibility fallback for entries promoted at entry-level
-- without per-photo judge_decisions rows.
--
-- Problem: get_round_eligible_photos only considered per-photo judge_decisions
-- (round_number = N-1, decision IN ('shortlist','shortlisted')). Entries that
-- were shortlisted at the entry level (competition_entries.status='shortlisted'
-- and current_round advanced to N) but had no per-photo decisions inserted
-- (e.g. legacy promotions, admin overrides, or bulk advancement) became
-- invisible in Round N — judges saw zero images.
--
-- Fix: add a second branch that admits all photos of an entry when the entry
-- itself is in a "qualified for round >= _round_number" state. This preserves
-- the per-photo gating when decisions exist, and falls back to entry-level
-- status when they don't, ensuring no shortlisted entry is ever orphaned.

CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(
  _competition_id uuid,
  _round_number integer
)
RETURNS TABLE(entry_id uuid, photo_index integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ce.id AS entry_id, gs.idx AS photo_index
  FROM public.competition_entries ce
  CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos,1),1)-1, 0)) AS gs(idx)
  WHERE ce.competition_id = _competition_id
    AND (
      -- Round 1: every photo of every entry is eligible
      _round_number = 1
      -- Per-photo gating: photo was shortlisted by a competition judge in prior round
      OR EXISTS (
        SELECT 1
        FROM public.judge_decisions jd
        JOIN public.competition_judges cj
          ON cj.judge_id = jd.judge_id
         AND cj.competition_id = _competition_id
        WHERE jd.entry_id     = ce.id
          AND jd.photo_index  = gs.idx
          AND jd.round_number = _round_number - 1
          AND jd.decision IN ('shortlist','shortlisted')
      )
      -- Entry-level fallback: entry has been advanced to this round (or beyond)
      -- via status/current_round/progression_decision but has no per-photo
      -- decision rows. Without this, such entries vanish from Round N.
      OR (
        regexp_replace(COALESCE(ce.current_round::text, ''), '\D', '', 'g') ~ '^\d+$'
        AND regexp_replace(COALESCE(ce.current_round::text, ''), '\D', '', 'g')::int >= _round_number
        AND ce.status IN (
          'shortlisted', 'round1_qualified', 'round2_qualified',
          'qualified', 'finalist', 'winner',
          'runner_up_1', 'runner_up_2', 'honourable_mention', 'special_jury'
        )
        -- Per-photo "One Image, One Reject" still respected
        AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
      )
    );
$function$;