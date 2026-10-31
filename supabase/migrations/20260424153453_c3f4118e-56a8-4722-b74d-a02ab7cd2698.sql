
CREATE OR REPLACE FUNCTION public.get_round_eligible_photos(_competition_id uuid, _round_number integer)
 RETURNS TABLE(entry_id uuid, photo_index integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ce.id AS entry_id, gs.idx AS photo_index
  FROM public.competition_entries ce
  CROSS JOIN LATERAL generate_series(0, GREATEST(COALESCE(array_length(ce.photos,1),1)-1, 0)) AS gs(idx)
  WHERE ce.competition_id = _competition_id
    -- Per-photo "One Image, One Reject" always respected
    AND COALESCE((ce.photo_meta->gs.idx->>'rejected')::boolean, false) = false
    AND (
      -- Round 1: every (non-rejected) photo of every entry is eligible
      _round_number = 1
      -- R2+: SOW per-photo gating — photo MUST have been shortlisted by a
      -- competition judge in the prior round. No entry-level fallback:
      -- entries promoted at entry level without per-photo decisions
      -- are a data-integrity gap (admin must mark specific photos).
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
    );
$function$;
