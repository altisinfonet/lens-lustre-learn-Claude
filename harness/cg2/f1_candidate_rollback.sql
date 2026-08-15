-- ROLLBACK for f1_candidate_20260814_self_judging_fix.sql
-- Restores judge_can_access_entry() to the pre-fix production body VERBATIM
-- (pulled from pg_get_functiondef this session). Running this re-opens the
-- self-judging path — only for emergency reversion.

CREATE OR REPLACE FUNCTION public.judge_can_access_entry(_entry_id uuid, _judge_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_judges cj ON cj.competition_id = ce.competition_id AND cj.judge_id = _judge_id
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
      AND (
        c.judge_assignment_mode != 'distributed'
        OR EXISTS (
          SELECT 1 FROM judge_entry_assignments ja
          WHERE ja.entry_id = _entry_id AND ja.judge_id = _judge_id
        )
      )
  );
$function$;
