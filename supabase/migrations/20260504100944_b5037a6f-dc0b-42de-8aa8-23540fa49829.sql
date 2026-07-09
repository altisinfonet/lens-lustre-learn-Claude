UPDATE public.v3_stage_catalog
SET is_active = true
WHERE stage_key IN ('r2_not_selected_r3','r3_not_selected_final');

CREATE OR REPLACE VIEW public.entry_public_status AS
WITH latest_published AS (
  SELECT competition_round_publish.competition_id,
         max(competition_round_publish.round_number)
           FILTER (WHERE competition_round_publish.published_at IS NOT NULL) AS latest_published_round,
         bool_or(competition_round_publish.published_at IS NOT NULL) AS has_any_published_round
  FROM competition_round_publish
  GROUP BY competition_round_publish.competition_id
), canonical_decision AS (
  SELECT e.id AS entry_id,
         c.stage_key,
         c.round_number AS decision_round,
         c.family,
         c.blocks_from_round
  FROM competition_entries e
  JOIN v3_stage_catalog c ON c.stage_key = e.progression_decision
), base AS (
  SELECT e.id,
         e.competition_id,
         e.status,
         e.current_round,
         e.placement,
         e.progression_decision,
         lp.latest_published_round,
         COALESCE(lp.has_any_published_round, false) AS has_any_published_round,
         cd.stage_key AS canonical_stage_key,
         cd.decision_round,
         cd.family AS decision_family,
         NULLIF(regexp_replace(COALESCE(e.current_round, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text)::integer AS current_round_num,
         CASE
           WHEN e.placement = ANY (ARRAY['winner'::text,'runner_up_1'::text,'runner_up_2'::text,'honorary_mention'::text,'honourable_mention'::text,'honorable_mention'::text,'special_jury'::text,'top_50'::text,'top_100'::text,'finalist'::text]) THEN e.placement
           WHEN e.status = 'winner'::text THEN 'winner'::text
           WHEN e.status = 'finalist'::text AND lp.latest_published_round >= 4 THEN 'finalist'::text
           ELSE NULL::text
         END AS r4_public_award
  FROM competition_entries e
  LEFT JOIN latest_published lp ON lp.competition_id = e.competition_id
  LEFT JOIN canonical_decision cd ON cd.entry_id = e.id
)
SELECT id AS entry_id,
       competition_id,
       CASE
         WHEN latest_published_round >= 4 AND r4_public_award IS NOT NULL THEN r4_public_award
         WHEN canonical_stage_key IS NOT NULL AND latest_published_round IS NOT NULL AND decision_round <= latest_published_round THEN canonical_stage_key
         WHEN latest_published_round >= 3 AND (COALESCE(current_round_num, 0) >= 4 OR (status = ANY (ARRAY['finalist'::text,'winner'::text,'qualified_final'::text])) OR decision_round >= 4) THEN 'r3_qualified_final'::text
         WHEN latest_published_round >= 2 AND (COALESCE(current_round_num, 0) >= 3 OR (status = ANY (ARRAY['round2_qualified'::text,'finalist'::text,'winner'::text,'qualified_final'::text])) OR decision_round >= 3) THEN 'r2_qualified_r3'::text
         WHEN latest_published_round >= 1 AND (COALESCE(current_round_num, 0) >= 2 OR (status = ANY (ARRAY['round1_qualified'::text,'round2_qualified'::text,'shortlisted'::text,'finalist'::text,'winner'::text,'qualified_final'::text])) OR decision_round >= 2) THEN 'r1_shortlisted_r2'::text
         WHEN (status = ANY (ARRAY['winner'::text,'finalist'::text,'qualified_final'::text])) AND latest_published_round >= 4 THEN status
         WHEN status = 'shortlisted'::text AND latest_published_round >= 1 AND COALESCE(current_round, ''::text) ~ '[0-9]'::text AND current_round_num <= 2 THEN 'r1_shortlisted_r2'::text
         WHEN status = 'shortlisted'::text AND latest_published_round >= 3 THEN status
         WHEN status = 'round2_qualified'::text AND latest_published_round >= 2 THEN 'r2_qualified_r3'::text
         WHEN status = 'round1_qualified'::text AND latest_published_round >= 1 THEN 'r1_shortlisted_r2'::text
         -- B1.9 Phase 1: rejected-fallback now derives wording from current_round digits.
         -- Removes the hard 'r1_rejected' fallback so R2/R3 rejects with NULL
         -- progression_decision still receive the correct round-scoped wording.
         WHEN status = 'rejected'::text AND latest_published_round >= 1 THEN
           CASE
             WHEN COALESCE(current_round_num, 1) >= 3 THEN 'r3_not_selected_final'::text
             WHEN COALESCE(current_round_num, 1) = 2 THEN 'r2_not_selected_r3'::text
             ELSE 'r1_rejected'::text
           END
         WHEN (status = ANY (ARRAY['submitted'::text,'needs_review'::text])) AND NOT has_any_published_round THEN status
         ELSE 'judging_in_progress'::text
       END AS public_status,
       CASE
         WHEN has_any_published_round THEN latest_published_round::text
         ELSE NULL::text
       END AS public_round,
       CASE
         WHEN latest_published_round >= 4 AND r4_public_award IS NOT NULL THEN NULL::text
         WHEN canonical_stage_key IS NOT NULL AND latest_published_round IS NOT NULL AND decision_round <= latest_published_round AND (decision_family = ANY (ARRAY['progression_fail'::text,'rejection'::text])) THEN 'not_selected_for_next_round'::text
         ELSE NULL::text
       END AS public_progression_note,
       CASE
         WHEN placement IS NOT NULL AND latest_published_round >= 4 THEN placement
         ELSE NULL::text
       END AS public_placement,
       CASE
         WHEN latest_published_round >= 4 THEN (
           SELECT array_agg(DISTINCT jt.label ORDER BY jt.label)
           FROM judge_tag_assignments jta
           JOIN judging_tags jt ON jt.id = jta.tag_id
           WHERE jta.entry_id = base.id
             AND jt.is_active = true
             AND jt.is_visible = true
             AND (4 = ANY (jt.visible_in_round))
             AND (jt.label = ANY (ARRAY['Top 50'::text,'Top 100'::text]))
         )
         ELSE NULL::text[]
       END AS public_r4_tags
FROM base;