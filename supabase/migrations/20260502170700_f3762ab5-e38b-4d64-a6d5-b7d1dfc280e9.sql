CREATE OR REPLACE VIEW public.entry_public_status AS
WITH latest_published AS (
  SELECT
    competition_id,
    max(round_number) FILTER (WHERE published_at IS NOT NULL) AS latest_published_round,
    bool_or(published_at IS NOT NULL) AS has_any_published_round
  FROM public.competition_round_publish
  GROUP BY competition_id
), canonical_decision AS (
  SELECT
    e.id AS entry_id,
    c.stage_key,
    c.round_number AS decision_round,
    c.family,
    c.blocks_from_round
  FROM public.competition_entries e
  JOIN public.v3_stage_catalog c
    ON c.stage_key = e.progression_decision
   AND c.is_active = true
), base AS (
  SELECT
    e.*,
    lp.latest_published_round,
    COALESCE(lp.has_any_published_round, false) AS has_any_published_round,
    cd.stage_key AS canonical_stage_key,
    cd.decision_round,
    cd.family AS decision_family,
    cd.blocks_from_round
  FROM public.competition_entries e
  LEFT JOIN latest_published lp ON lp.competition_id = e.competition_id
  LEFT JOIN canonical_decision cd ON cd.entry_id = e.id
)
SELECT
  id AS entry_id,
  competition_id,
  CASE
    WHEN canonical_stage_key IS NOT NULL
     AND latest_published_round IS NOT NULL
     AND decision_round <= latest_published_round
      THEN canonical_stage_key
    WHEN status = ANY (ARRAY['winner'::text, 'finalist'::text, 'qualified_final'::text])
     AND latest_published_round >= 4
      THEN status
    WHEN status = 'shortlisted'::text
     AND latest_published_round >= 1
     AND COALESCE(current_round, '') ~ '[0-9]'
     AND NULLIF(regexp_replace(COALESCE(current_round, ''), '[^0-9]', '', 'g'), '')::integer <= 2
      THEN 'r1_shortlisted_r2'::text
    WHEN status = 'shortlisted'::text
     AND latest_published_round >= 3
      THEN status
    WHEN status = 'round2_qualified'::text
     AND latest_published_round >= 2
      THEN status
    WHEN status = 'round1_qualified'::text
     AND latest_published_round >= 1
      THEN 'r1_shortlisted_r2'::text
    WHEN status = 'rejected'::text
     AND latest_published_round >= 1
      THEN 'r1_rejected'::text
    WHEN status = ANY (ARRAY['submitted'::text, 'needs_review'::text])
     AND NOT has_any_published_round
      THEN status
    ELSE 'judging_in_progress'::text
  END AS public_status,
  CASE
    WHEN has_any_published_round THEN latest_published_round::text
    ELSE NULL::text
  END AS public_round,
  CASE
    WHEN canonical_stage_key IS NOT NULL
     AND latest_published_round IS NOT NULL
     AND decision_round <= latest_published_round
     AND decision_family = 'progression_fail'
      THEN 'not_selected_for_next_round'::text
    WHEN progression_decision = 'reject'::text
     AND latest_published_round IS NOT NULL
     AND COALESCE(current_round, '') ~ '[0-9]'
     AND NULLIF(regexp_replace(COALESCE(current_round, ''), '[^0-9]', '', 'g'), '')::integer <= latest_published_round
      THEN 'not_selected_for_next_round'::text
    ELSE NULL::text
  END AS public_progression_note,
  CASE
    WHEN placement IS NOT NULL AND latest_published_round >= 4 THEN placement
    ELSE NULL::text
  END AS public_placement,
  CASE
    WHEN latest_published_round >= 4 THEN (
      SELECT array_agg(DISTINCT jt.label ORDER BY jt.label) AS array_agg
      FROM public.judge_tag_assignments jta
      JOIN public.judging_tags jt ON jt.id = jta.tag_id
      WHERE jta.entry_id = base.id
        AND jt.is_active = true
        AND jt.is_visible = true
        AND 4 = ANY (jt.visible_in_round)
        AND jt.label = ANY (ARRAY['Top 50'::text, 'Top 100'::text])
    )
    ELSE NULL::text[]
  END AS public_r4_tags
FROM base;

CREATE OR REPLACE FUNCTION public.get_gated_entry_status(p_entry_ids uuid[])
RETURNS TABLE(
  entry_id uuid,
  competition_id uuid,
  public_status text,
  public_round text,
  public_placement text,
  public_progression_note text,
  public_r4_tags text[],
  has_pending_verification boolean,
  verification_overrides_status boolean,
  is_published_any_round boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT eps.entry_id, eps.competition_id, eps.public_status, eps.public_round,
           eps.public_placement, eps.public_progression_note, eps.public_r4_tags
    FROM public.entry_public_status eps
    WHERE eps.entry_id = ANY(p_entry_ids)
  ),
  pending AS (
    SELECT b.entry_id, public.any_photo_pending(b.entry_id) AS is_pending
    FROM base b
  ),
  any_pub AS (
    SELECT competition_id, bool_or(published_at IS NOT NULL) AS pub
    FROM public.competition_round_publish
    WHERE competition_id IN (SELECT competition_id FROM base)
    GROUP BY competition_id
  )
  SELECT
    b.entry_id,
    b.competition_id,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_status
      WHEN p.is_pending THEN 'judging_in_progress'::text
      ELSE COALESCE(b.public_status, 'judging_in_progress'::text)
    END AS public_status,
    b.public_round,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_placement
      WHEN p.is_pending THEN NULL::text
      ELSE b.public_placement
    END AS public_placement,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_progression_note
      WHEN p.is_pending THEN NULL::text
      ELSE b.public_progression_note
    END AS public_progression_note,
    CASE
      WHEN b.public_status IS NOT NULL AND b.public_status <> 'judging_in_progress'::text THEN b.public_r4_tags
      WHEN p.is_pending THEN NULL::text[]
      ELSE b.public_r4_tags
    END AS public_r4_tags,
    FALSE AS has_pending_verification,
    FALSE AS verification_overrides_status,
    COALESCE(ap.pub, FALSE) AS is_published_any_round
  FROM base b
  JOIN pending p USING (entry_id)
  LEFT JOIN any_pub ap USING (competition_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_result_visibility_invariant_admin()
RETURNS TABLE(
  check_key text,
  status text,
  evidence jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH latest_published AS (
    SELECT competition_id, max(round_number) FILTER (WHERE published_at IS NOT NULL) AS latest_published_round
    FROM public.competition_round_publish
    GROUP BY competition_id
  ), eligible AS (
    SELECT
      e.id AS entry_id,
      e.competition_id,
      e.status AS raw_status,
      e.progression_decision,
      e.current_round,
      c.round_number AS decision_round,
      lp.latest_published_round,
      eps.public_status AS view_status,
      ges.public_status AS rpc_status
    FROM public.competition_entries e
    JOIN latest_published lp ON lp.competition_id = e.competition_id
    JOIN public.v3_stage_catalog c
      ON c.stage_key = e.progression_decision
     AND c.is_active = true
    JOIN public.entry_public_status eps ON eps.entry_id = e.id
    LEFT JOIN LATERAL (
      SELECT public_status FROM public.get_gated_entry_status(ARRAY[e.id]) LIMIT 1
    ) ges ON true
    WHERE lp.latest_published_round IS NOT NULL
      AND c.round_number <= lp.latest_published_round
  ), failures AS (
    SELECT *
    FROM eligible
    WHERE view_status = 'judging_in_progress'
       OR rpc_status = 'judging_in_progress'
       OR view_status IS DISTINCT FROM progression_decision
       OR rpc_status IS DISTINCT FROM progression_decision
  )
  SELECT
    'published_round_results_visible'::text AS check_key,
    CASE WHEN EXISTS (SELECT 1 FROM failures) THEN 'FAIL' ELSE 'PASS' END AS status,
    jsonb_build_object(
      'eligible_published_decisions', (SELECT count(*) FROM eligible),
      'failures', COALESCE((SELECT jsonb_agg(to_jsonb(failures) ORDER BY entry_id) FROM failures), '[]'::jsonb)
    ) AS evidence;
$function$;