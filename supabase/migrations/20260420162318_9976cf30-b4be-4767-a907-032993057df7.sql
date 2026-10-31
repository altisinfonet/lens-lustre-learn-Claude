CREATE OR REPLACE FUNCTION public.is_vote_phase_locked(_entry_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT c.phase IN ('submission_open', 'voting', 'judging')
    FROM competition_entries ce
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
  ), false)
$function$;