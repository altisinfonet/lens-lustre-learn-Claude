CREATE OR REPLACE VIEW public.entry_public_status
WITH (security_invoker = on) AS
WITH latest_published AS (
  SELECT competition_id,
         max(round_number) FILTER (WHERE published_at IS NOT NULL) AS latest_published_round,
         bool_or(published_at IS NOT NULL) AS has_any_published_round
  FROM public.competition_round_publish
  GROUP BY competition_id
), canonical_decision AS (
  SELECT e.id AS entry_id, c.stage_key, c.round_number AS decision_round, c.family, c.blocks_from_round
  FROM public.competition_entries e
  JOIN public.v3_stage_catalog c ON c.stage_key = e.progression_decision
), base AS (
  SELECT e.id, e.competition_id, e.status, e.current_round, e.placement, e.progression_decision,
         lp.latest_published_round,
         COALESCE(lp.has_any_published_round, false) AS has_any_published_round,
         cd.stage_key AS canonical_stage_key, cd.decision_round, cd.family AS decision_family,
         NULLIF(regexp_replace(COALESCE(e.current_round, ''), '[^0-9]', '', 'g'), '')::int AS current_round_num,
         CASE
           WHEN e.placement IN ('winner','runner_up_1','runner_up_2','honorary_mention','honourable_mention','honorable_mention','special_jury','top_50','top_100','finalist') THEN e.placement
           WHEN e.status = 'winner' THEN 'winner'
           WHEN e.status = 'finalist' AND lp.latest_published_round >= 4 THEN 'finalist'
           ELSE NULL
         END AS r4_public_award
  FROM public.competition_entries e
  LEFT JOIN latest_published lp ON lp.competition_id = e.competition_id
  LEFT JOIN canonical_decision cd ON cd.entry_id = e.id
)
SELECT id AS entry_id,
       competition_id,
       CASE
         WHEN latest_published_round >= 4 AND r4_public_award IS NOT NULL
           THEN r4_public_award
         WHEN canonical_stage_key IS NOT NULL
              AND latest_published_round IS NOT NULL
              AND decision_round <= latest_published_round
           THEN canonical_stage_key
         -- Critical fallback: if later judging has overwritten progression_decision,
         -- still reveal the highest already-declared earlier pass result.
         WHEN latest_published_round >= 3
              AND (COALESCE(current_round_num, 0) >= 4 OR status IN ('finalist','winner','qualified_final') OR decision_round >= 4)
           THEN 'r3_qualified_final'
         WHEN latest_published_round >= 2
              AND (COALESCE(current_round_num, 0) >= 3 OR status IN ('round2_qualified','finalist','winner','qualified_final') OR decision_round >= 3)
           THEN 'r2_qualified_r3'
         WHEN latest_published_round >= 1
              AND (COALESCE(current_round_num, 0) >= 2 OR status IN ('round1_qualified','round2_qualified','shortlisted','finalist','winner','qualified_final') OR decision_round >= 2)
           THEN 'r1_shortlisted_r2'
         WHEN status = ANY (ARRAY['winner','finalist','qualified_final'])
              AND latest_published_round >= 4 THEN status
         WHEN status = 'shortlisted'
              AND latest_published_round >= 1
              AND COALESCE(current_round,'') ~ '[0-9]'
              AND current_round_num <= 2
           THEN 'r1_shortlisted_r2'
         WHEN status = 'shortlisted' AND latest_published_round >= 3 THEN status
         WHEN status = 'round2_qualified' AND latest_published_round >= 2 THEN 'r2_qualified_r3'
         WHEN status = 'round1_qualified' AND latest_published_round >= 1 THEN 'r1_shortlisted_r2'
         WHEN status = 'rejected' AND latest_published_round >= 1 THEN 'r1_rejected'
         WHEN status = ANY (ARRAY['submitted','needs_review']) AND NOT has_any_published_round THEN status
         ELSE 'judging_in_progress'
       END AS public_status,
       CASE WHEN has_any_published_round THEN latest_published_round::text ELSE NULL END AS public_round,
       CASE
         WHEN latest_published_round >= 4 AND r4_public_award IS NOT NULL THEN NULL
         WHEN canonical_stage_key IS NOT NULL
              AND latest_published_round IS NOT NULL
              AND decision_round <= latest_published_round
              AND decision_family IN ('progression_fail','rejection')
           THEN 'not_selected_for_next_round'
         ELSE NULL
       END AS public_progression_note,
       CASE WHEN placement IS NOT NULL AND latest_published_round >= 4 THEN placement ELSE NULL END AS public_placement,
       CASE
         WHEN latest_published_round >= 4 THEN (
           SELECT array_agg(DISTINCT jt.label ORDER BY jt.label)
           FROM public.judge_tag_assignments jta
           JOIN public.judging_tags jt ON jt.id = jta.tag_id
           WHERE jta.entry_id = base.id
             AND jt.is_active = true AND jt.is_visible = true
             AND (4 = ANY (jt.visible_in_round))
             AND jt.label = ANY (ARRAY['Top 50','Top 100'])
         )
         ELSE NULL
       END AS public_r4_tags
FROM base;

CREATE OR REPLACE FUNCTION public.get_result_visibility_invariant_admin()
RETURNS TABLE(check_key text, status text, evidence jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH latest_published AS (
    SELECT competition_id,
           max(round_number) FILTER (WHERE published_at IS NOT NULL) AS latest_published_round
    FROM public.competition_round_publish
    GROUP BY competition_id
  ), entries AS (
    SELECT e.id, e.competition_id, e.status, e.placement, e.progression_decision,
           c.round_number AS decision_round, c.family, lp.latest_published_round,
           NULLIF(regexp_replace(COALESCE(e.current_round, ''), '[^0-9]', '', 'g'), '')::int AS current_round_num,
           CASE
             WHEN lp.latest_published_round >= 4 AND e.placement IS NOT NULL THEN e.placement
             WHEN lp.latest_published_round >= 4 AND e.status IN ('winner','finalist') THEN e.status
             WHEN c.stage_key IS NOT NULL AND c.round_number <= lp.latest_published_round THEN c.stage_key
             WHEN lp.latest_published_round >= 3 AND (COALESCE(NULLIF(regexp_replace(COALESCE(e.current_round, ''), '[^0-9]', '', 'g'), '')::int, 0) >= 4 OR e.status IN ('finalist','winner','qualified_final') OR c.round_number >= 4) THEN 'r3_qualified_final'
             WHEN lp.latest_published_round >= 2 AND (COALESCE(NULLIF(regexp_replace(COALESCE(e.current_round, ''), '[^0-9]', '', 'g'), '')::int, 0) >= 3 OR e.status IN ('round2_qualified','finalist','winner','qualified_final') OR c.round_number >= 3) THEN 'r2_qualified_r3'
             WHEN lp.latest_published_round >= 1 AND (COALESCE(NULLIF(regexp_replace(COALESCE(e.current_round, ''), '[^0-9]', '', 'g'), '')::int, 0) >= 2 OR e.status IN ('round1_qualified','round2_qualified','shortlisted','finalist','winner','qualified_final') OR c.round_number >= 2) THEN 'r1_shortlisted_r2'
             ELSE NULL
           END AS expected_status,
           CASE
             WHEN lp.latest_published_round >= 4 AND (e.placement IS NOT NULL OR e.status IN ('winner','finalist')) THEN NULL
             WHEN c.stage_key IS NOT NULL AND c.round_number <= lp.latest_published_round AND c.family IN ('progression_fail','rejection') THEN 'not_selected_for_next_round'
             ELSE NULL
           END AS expected_note
    FROM public.competition_entries e
    JOIN latest_published lp ON lp.competition_id = e.competition_id
    LEFT JOIN public.v3_stage_catalog c ON c.stage_key = e.progression_decision
    WHERE lp.latest_published_round BETWEEN 1 AND 4
  ), eligible AS (
    SELECT * FROM entries WHERE expected_status IS NOT NULL
  ), gated AS (
    SELECT * FROM public.get_gated_entry_status((SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM eligible))
  ), failures AS (
    SELECT eligible.id, eligible.competition_id, eligible.status AS raw_status, eligible.placement,
           eligible.progression_decision, eligible.decision_round, eligible.latest_published_round,
           eligible.expected_status, eps.public_status AS view_status, gated.public_status AS rpc_status,
           eligible.expected_note, eps.public_progression_note AS view_note, gated.public_progression_note AS rpc_note,
           eps.public_placement AS view_placement, gated.public_placement AS rpc_placement
    FROM eligible
    LEFT JOIN public.entry_public_status eps ON eps.entry_id = eligible.id
    LEFT JOIN gated ON gated.entry_id = eligible.id
    WHERE eps.public_status IS DISTINCT FROM eligible.expected_status
       OR gated.public_status IS DISTINCT FROM eligible.expected_status
       OR eps.public_progression_note IS DISTINCT FROM eligible.expected_note
       OR gated.public_progression_note IS DISTINCT FROM eligible.expected_note
       OR (eligible.latest_published_round >= 4 AND eligible.placement IS NOT NULL AND eps.public_placement IS DISTINCT FROM eligible.placement)
       OR (eligible.latest_published_round >= 4 AND eligible.placement IS NOT NULL AND gated.public_placement IS DISTINCT FROM eligible.placement)
  )
  SELECT 'declared_r1_r2_r3_r4_result_visibility'::text,
         CASE WHEN EXISTS (SELECT 1 FROM failures) THEN 'FAIL' ELSE 'PASS' END::text,
         jsonb_build_object(
           'eligible_declared_results', (SELECT count(*) FROM eligible),
           'failures', (SELECT count(*) FROM failures),
           'failure_rows', COALESCE((SELECT jsonb_agg(to_jsonb(failures)) FROM failures), '[]'::jsonb)
         );
$function$;

GRANT EXECUTE ON FUNCTION public.get_result_visibility_invariant_admin() TO authenticated;