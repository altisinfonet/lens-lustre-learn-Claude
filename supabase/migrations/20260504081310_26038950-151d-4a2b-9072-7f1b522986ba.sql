-- Phase B0 — Read-only forensic drift view + admin RPC wrapper
-- Surfaces F1–F5 findings as live rows. ZERO writes, no triggers, no destructive paths.

CREATE OR REPLACE VIEW public.v_judging_drift AS
-- F1: judge_tag_assignments rows with no matching judge_decisions row
-- (same entry_id, judge_id, round_number, photo_index)
SELECT
  'F1_TAG_WITHOUT_DECISION'::text                    AS finding_code,
  'judge_tag_assignments'::text                      AS source_table,
  jta.id                                             AS source_row_id,
  jta.entry_id                                       AS entry_id,
  jta.judge_id                                       AS judge_id,
  jta.round_number                                   AS round_number,
  jta.photo_index                                    AS photo_index,
  jt.label                                           AS detail_label,
  NULL::text                                         AS expected_value,
  NULL::text                                         AS actual_value,
  jta.created_at                                     AS occurred_at
FROM public.judge_tag_assignments jta
LEFT JOIN public.judging_tags jt ON jt.id = jta.tag_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.judge_decisions jd
  WHERE jd.entry_id      = jta.entry_id
    AND jd.judge_id      = jta.judge_id
    AND jd.round_number  = jta.round_number
    AND jd.photo_index   IS NOT DISTINCT FROM jta.photo_index
)

UNION ALL

-- F2: judge_decisions rows with no backing tag in v3_tag_label_alias
-- (decision token is not in the canonical alias map for that round)
SELECT
  'F2_DECISION_WITHOUT_ALIAS'::text                  AS finding_code,
  'judge_decisions'::text                            AS source_table,
  jd.id                                              AS source_row_id,
  jd.entry_id                                        AS entry_id,
  jd.judge_id                                        AS judge_id,
  jd.round_number                                    AS round_number,
  jd.photo_index                                     AS photo_index,
  jd.decision                                        AS detail_label,
  jd.stage_key                                       AS expected_value,
  NULL::text                                         AS actual_value,
  jd.created_at                                      AS occurred_at
FROM public.judge_decisions jd
WHERE jd.decision IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.v3_tag_label_alias a
    WHERE lower(a.alias_label) = lower(jd.decision)
      AND a.round_number = jd.round_number
  )

UNION ALL

-- F3: Missing v3_tag_label_alias rows for tag labels actually used in
-- judge_tag_assignments — i.e., judges tagged with a label that has no
-- canonical alias entry for that round.
SELECT DISTINCT
  'F3_TAG_LABEL_NO_ALIAS'::text                      AS finding_code,
  'judging_tags'::text                               AS source_table,
  jt.id                                              AS source_row_id,
  NULL::uuid                                         AS entry_id,
  NULL::uuid                                         AS judge_id,
  jta.round_number                                   AS round_number,
  NULL::int                                          AS photo_index,
  jt.label                                           AS detail_label,
  NULL::text                                         AS expected_value,
  NULL::text                                         AS actual_value,
  MIN(jta.created_at)                                AS occurred_at
FROM public.judge_tag_assignments jta
JOIN public.judging_tags jt ON jt.id = jta.tag_id
WHERE jt.label IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.v3_tag_label_alias a
    WHERE lower(a.alias_label) = lower(jt.label)
      AND a.round_number = jta.round_number
  )
GROUP BY jt.id, jt.label, jta.round_number

UNION ALL

-- F4: v3_mirror_log error rows (action='error') in last 30 days
SELECT
  'F4_MIRROR_LOG_ERROR'::text                        AS finding_code,
  'v3_mirror_log'::text                              AS source_table,
  ml.id                                              AS source_row_id,
  ml.entry_id                                        AS entry_id,
  ml.judge_id                                        AS judge_id,
  ml.round_number                                    AS round_number,
  ml.photo_index                                     AS photo_index,
  ml.tag_label                                       AS detail_label,
  ml.matched_stage                                   AS expected_value,
  ml.error_message                                   AS actual_value,
  ml.occurred_at                                     AS occurred_at
FROM public.v3_mirror_log ml
WHERE ml.action = 'error'
  AND ml.occurred_at >= now() - interval '30 days'

UNION ALL

-- F5: competition_entries.current_round text values that don't normalize to 1..4
SELECT
  'F5_CURRENT_ROUND_INVALID'::text                   AS finding_code,
  'competition_entries'::text                        AS source_table,
  ce.id                                              AS source_row_id,
  ce.id                                              AS entry_id,
  NULL::uuid                                         AS judge_id,
  NULL::int                                          AS round_number,
  NULL::int                                          AS photo_index,
  ce.current_round                                   AS detail_label,
  '1|2|3|4'::text                                    AS expected_value,
  ce.current_round                                   AS actual_value,
  ce.updated_at                                      AS occurred_at
FROM public.competition_entries ce
WHERE ce.current_round IS NOT NULL
  AND COALESCE(NULLIF(regexp_replace(ce.current_round, '[^0-9]', '', 'g'), ''), '0')::int NOT IN (1,2,3,4);

COMMENT ON VIEW public.v_judging_drift IS
  'Phase B0 read-only forensic drift surface. Five findings F1..F5 from judging system. No writes, RLS via underlying tables.';

-- Admin RPC wrapper: SECURITY DEFINER so admins can read regardless of
-- per-table RLS, mirroring existing audit pattern (get_progression_drift_admin).
CREATE OR REPLACE FUNCTION public.get_judging_drift_admin()
RETURNS TABLE (
  finding_code   text,
  source_table   text,
  source_row_id  uuid,
  entry_id       uuid,
  judge_id       uuid,
  round_number   int,
  photo_index    int,
  detail_label   text,
  expected_value text,
  actual_value   text,
  occurred_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT v.finding_code, v.source_table, v.source_row_id, v.entry_id,
         v.judge_id, v.round_number, v.photo_index, v.detail_label,
         v.expected_value, v.actual_value, v.occurred_at
  FROM public.v_judging_drift v
  ORDER BY v.finding_code, v.occurred_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_judging_drift_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_judging_drift_admin() TO authenticated;