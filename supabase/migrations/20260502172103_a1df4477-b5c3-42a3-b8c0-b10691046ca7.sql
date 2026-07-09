CREATE OR REPLACE FUNCTION public.enforce_progression_decision_vocabulary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active_round int;
  v_valid_keys text;
BEGIN
  IF NEW.progression_decision IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.progression_decision IS NOT DISTINCT FROM NEW.progression_decision THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.v3_stage_catalog
    WHERE stage_key = NEW.progression_decision
      AND (
        is_active = true
        OR stage_key IN ('r2_not_selected_r3', 'r3_not_selected_final')
      )
  ) THEN
    BEGIN
      SELECT public.current_round_int(c.current_round)
      INTO v_active_round
      FROM public.competitions c
      WHERE c.id = NEW.competition_id;
    EXCEPTION WHEN OTHERS THEN
      v_active_round := NULL;
    END;

    SELECT string_agg(stage_key, ', ' ORDER BY stage_key)
    INTO v_valid_keys
    FROM public.v3_stage_catalog
    WHERE (is_active = true OR stage_key IN ('r2_not_selected_r3', 'r3_not_selected_final'))
      AND (v_active_round IS NULL OR round_number = v_active_round);

    RAISE EXCEPTION
      'progression_decision = % is not a valid v3_stage_catalog stage_key (entry=%, competition=%, active_round=%). Valid keys for round %: [%]. See docs/judging/vocabulary.md.',
      NEW.progression_decision,
      NEW.id,
      NEW.competition_id,
      COALESCE(v_active_round::text, 'unknown'),
      COALESCE(v_active_round::text, 'any'),
      COALESCE(v_valid_keys, '(none)')
      USING ERRCODE = 'P0001',
            HINT    = 'Use an active canonical stage_key, or the explicit R2/R3 not-selected stage keys for declared non-progression outcomes.';
  END IF;

  RETURN NEW;
END;
$function$;

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
  ), eligible AS (
    SELECT e.id, e.competition_id, e.progression_decision, c.round_number AS decision_round,
           c.family, lp.latest_published_round,
           c.stage_key AS expected_status,
           CASE WHEN c.family IN ('progression_fail','rejection') THEN 'not_selected_for_next_round' ELSE NULL END AS expected_note
    FROM public.competition_entries e
    JOIN latest_published lp ON lp.competition_id = e.competition_id
    JOIN public.v3_stage_catalog c ON c.stage_key = e.progression_decision
    WHERE c.round_number BETWEEN 1 AND 3
      AND c.round_number <= lp.latest_published_round
  ), gated AS (
    SELECT * FROM public.get_gated_entry_status((SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM eligible))
  ), failures AS (
    SELECT eligible.id, eligible.competition_id, eligible.progression_decision,
           eligible.decision_round, eligible.latest_published_round,
           eligible.expected_status, eps.public_status AS view_status, gated.public_status AS rpc_status,
           eligible.expected_note, eps.public_progression_note AS view_note, gated.public_progression_note AS rpc_note
    FROM eligible
    LEFT JOIN public.entry_public_status eps ON eps.entry_id = eligible.id
    LEFT JOIN gated ON gated.entry_id = eligible.id
    WHERE eps.public_status IS DISTINCT FROM eligible.expected_status
       OR gated.public_status IS DISTINCT FROM eligible.expected_status
       OR eps.public_progression_note IS DISTINCT FROM eligible.expected_note
       OR gated.public_progression_note IS DISTINCT FROM eligible.expected_note
  )
  SELECT 'declared_r1_r2_r3_progression_visibility'::text,
         CASE WHEN EXISTS (SELECT 1 FROM failures) THEN 'FAIL' ELSE 'PASS' END::text,
         jsonb_build_object(
           'eligible_declared_decisions', (SELECT count(*) FROM eligible),
           'failures', (SELECT count(*) FROM failures),
           'failure_rows', COALESCE((SELECT jsonb_agg(to_jsonb(failures)) FROM failures), '[]'::jsonb)
         );
$function$;

REVOKE ALL ON FUNCTION public.get_result_visibility_invariant_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_result_visibility_invariant_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_result_visibility_invariant_admin() TO authenticated;