
CREATE OR REPLACE VIEW public.entry_public_status
WITH (security_invoker = on) AS
WITH latest_published AS (
  SELECT competition_id,
         max(round_number) FILTER (WHERE published_at IS NOT NULL) AS latest_published_round,
         bool_or(published_at IS NOT NULL) AS has_any_published_round
  FROM competition_round_publish
  GROUP BY competition_id
),
canonical_decision AS (
  SELECT e.id AS entry_id, c.stage_key, c.round_number AS decision_round, c.family, c.blocks_from_round
  FROM competition_entries e
  JOIN v3_stage_catalog c ON c.stage_key = e.progression_decision
),
base AS (
  SELECT e.id, e.competition_id, e.status, e.current_round, e.placement, e.progression_decision,
         lp.latest_published_round,
         COALESCE(lp.has_any_published_round, false) AS has_any_published_round,
         cd.stage_key AS canonical_stage_key, cd.decision_round, cd.family AS decision_family
  FROM competition_entries e
  LEFT JOIN latest_published lp ON lp.competition_id = e.competition_id
  LEFT JOIN canonical_decision cd ON cd.entry_id = e.id
)
SELECT id AS entry_id,
       competition_id,
       CASE
         WHEN canonical_stage_key IS NOT NULL
              AND latest_published_round IS NOT NULL
              AND decision_round <= latest_published_round
           THEN canonical_stage_key
         WHEN status = ANY (ARRAY['winner','finalist','qualified_final'])
              AND latest_published_round >= 4 THEN status
         WHEN status = 'shortlisted'
              AND latest_published_round >= 1
              AND COALESCE(current_round,'') ~ '[0-9]'
              AND NULLIF(regexp_replace(COALESCE(current_round,''),'[^0-9]','','g'),'')::int <= 2
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
           FROM judge_tag_assignments jta
           JOIN judging_tags jt ON jt.id = jta.tag_id
           WHERE jta.entry_id = base.id
             AND jt.is_active = true AND jt.is_visible = true
             AND (4 = ANY (jt.visible_in_round))
             AND jt.label = ANY (ARRAY['Top 50','Top 100'])
         )
         ELSE NULL
       END AS public_r4_tags
FROM base;
