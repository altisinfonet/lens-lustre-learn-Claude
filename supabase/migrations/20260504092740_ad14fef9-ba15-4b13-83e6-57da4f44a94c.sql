-- Phase B1.5 — Soft-resolve historical mirror errors
-- Adds review columns to v3_mirror_log so historically-captured trigger errors
-- can be marked as triaged without deleting the audit trail. Updates the F4
-- branch of v_judging_drift to exclude reviewed rows.

ALTER TABLE public.v3_mirror_log
  ADD COLUMN IF NOT EXISTS reviewed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by  uuid,
  ADD COLUMN IF NOT EXISTS reviewed_note text;

COMMENT ON COLUMN public.v3_mirror_log.reviewed_at IS
  'When set, the row was triaged by an admin and is excluded from forensic drift findings.';

CREATE OR REPLACE VIEW public.v_judging_drift AS
SELECT 'F1_TAG_WITHOUT_DECISION'::text AS finding_code,
       'judge_tag_assignments'::text   AS source_table,
       jta.id                          AS source_row_id,
       jta.entry_id, jta.judge_id, jta.round_number, jta.photo_index,
       jt.label                        AS detail_label,
       NULL::text                      AS expected_value,
       NULL::text                      AS actual_value,
       jta.created_at                  AS occurred_at
  FROM public.judge_tag_assignments jta
  LEFT JOIN public.judging_tags jt ON jt.id = jta.tag_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.judge_decisions jd
    WHERE jd.entry_id = jta.entry_id
      AND jd.judge_id = jta.judge_id
      AND jd.round_number = jta.round_number
      AND NOT jd.photo_index IS DISTINCT FROM jta.photo_index)
UNION ALL
SELECT 'F2_DECISION_WITHOUT_ALIAS'::text, 'judge_decisions'::text,
       jd.id, jd.entry_id, jd.judge_id, jd.round_number, jd.photo_index,
       jd.decision, jd.stage_key, NULL::text, jd.created_at
  FROM public.judge_decisions jd
 WHERE jd.decision IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.v3_tag_label_alias a
      WHERE lower(a.alias_label) = lower(jd.decision)
        AND a.round_number = jd.round_number)
UNION ALL
SELECT DISTINCT 'F3_TAG_LABEL_NO_ALIAS'::text, 'judging_tags'::text,
       jt.id, NULL::uuid, NULL::uuid, jta.round_number, NULL::integer,
       jt.label, NULL::text, NULL::text, min(jta.created_at)
  FROM public.judge_tag_assignments jta
  JOIN public.judging_tags jt ON jt.id = jta.tag_id
 WHERE jt.label IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.v3_tag_label_alias a
      WHERE lower(a.alias_label) = lower(jt.label)
        AND a.round_number = jta.round_number)
 GROUP BY jt.id, jt.label, jta.round_number
UNION ALL
SELECT 'F4_MIRROR_LOG_ERROR'::text, 'v3_mirror_log'::text,
       ml.id, ml.entry_id, ml.judge_id, ml.round_number, ml.photo_index,
       ml.tag_label, ml.matched_stage, ml.error_message, ml.occurred_at
  FROM public.v3_mirror_log ml
 WHERE ml.action = 'error'
   AND ml.occurred_at >= (now() - interval '30 days')
   AND ml.reviewed_at IS NULL
UNION ALL
SELECT 'F5_CURRENT_ROUND_INVALID'::text, 'competition_entries'::text,
       ce.id, ce.id, NULL::uuid, NULL::integer, NULL::integer,
       ce.current_round, '1|2|3|4'::text, ce.current_round, ce.updated_at
  FROM public.competition_entries ce
 WHERE ce.current_round IS NOT NULL
   AND COALESCE(NULLIF(regexp_replace(ce.current_round, '[^0-9]', '', 'g'), ''), '0')::int <> ALL (ARRAY[1,2,3,4]);