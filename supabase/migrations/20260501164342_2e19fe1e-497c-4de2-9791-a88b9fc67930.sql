-- =============================================================================
-- U-1: Catalog-driven unification of decision vocabulary
-- =============================================================================
-- Forensic finding: judging_invariants_check + system_tag_decision_map were
-- never migrated to Phase 4 catalog tokens. They still spoke R1-only vocab
-- (shortlist/reject) while v3_stage_catalog + mirror trigger + CHECK constraint
-- speak round-specific tokens (qualified_r3, qualified_final, etc.).
--
-- Fix: derive both the auditor whitelist and the system_tag_decision_map FROM
-- v3_stage_catalog so they cannot drift again. Keep small legacy alias list
-- so the 17 historical R1 rows still pass.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Rewrite judging_invariants_check.decision_vocabulary section to read
--    the canonical set from v3_stage_catalog at runtime.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.judging_invariants_check()
 RETURNS TABLE(check_name text, status text, fail_count integer, sample jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- 1. tag_decision_drift (unchanged)
  RETURN QUERY
  WITH drift AS (
    SELECT jta.entry_id, jta.judge_id, jta.tag_id, m.round_number, m.decision
    FROM public.judge_tag_assignments jta
    JOIN public.system_tag_decision_map m ON m.tag_id = jta.tag_id
    LEFT JOIN public.judge_decisions jd
      ON jd.entry_id = jta.entry_id
     AND jd.judge_id = jta.judge_id
     AND jd.round_number = m.round_number
     AND jd.decision = m.decision
     AND COALESCE(jd.photo_index, 0) = COALESCE(jta.photo_index, 0)
    WHERE jd.id IS NULL
  )
  SELECT 'tag_decision_drift'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(d)) FILTER (WHERE d.entry_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM drift LIMIT 5) d;

  -- 2. current_round_canonical (unchanged)
  RETURN QUERY
  WITH bad AS (
    SELECT 'competition_entries' AS t, id::text, current_round
    FROM public.competition_entries
    WHERE current_round IS NOT NULL AND current_round !~ '^[1-4]$'
    UNION ALL
    SELECT 'competitions', id::text, current_round
    FROM public.competitions
    WHERE current_round IS NOT NULL AND current_round !~ '^[1-4]$'
  )
  SELECT 'current_round_canonical'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(b)) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM bad LIMIT 5) b;

  -- 3. decision_vocabulary -- NOW CATALOG-DRIVEN (U-1)
  -- Canonical set = active v3_stage_catalog.decision_token values
  --              + small legacy alias whitelist for historical rows.
  RETURN QUERY
  WITH canonical AS (
    SELECT DISTINCT lower(decision_token) AS token
    FROM public.v3_stage_catalog
    WHERE is_active = true
    UNION
    -- Legacy aliases that historical rows may still carry (R1 era + spec V3 forgivers)
    SELECT unnest(ARRAY[
      'accepted','shortlisted','qualified','rejected',
      'needs_review','skip','finalist'
    ])
  ),
  bad AS (
    SELECT id::text, decision, round_number
    FROM public.judge_decisions
    WHERE lower(decision) NOT IN (SELECT token FROM canonical)
  )
  SELECT 'decision_vocabulary'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(b)) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM bad LIMIT 5) b;

  -- 4. eligibility_consistency (unchanged)
  RETURN QUERY
  WITH per_comp AS (
    SELECT c.id AS competition_id,
           public.current_round_int(c.current_round) AS rn
    FROM public.competitions c
    WHERE c.current_round IS NOT NULL
      AND public.current_round_int(c.current_round) >= 2
  ),
  expected AS (
    SELECT pc.competition_id, jd.entry_id, COALESCE(jd.photo_index, 0) AS photo_index
    FROM per_comp pc
    JOIN public.judge_decisions jd ON jd.round_number = pc.rn - 1
    JOIN public.competition_entries ce ON ce.id = jd.entry_id AND ce.competition_id = pc.competition_id
    JOIN public.competition_judges cj ON cj.judge_id = jd.judge_id AND cj.competition_id = pc.competition_id
    WHERE public.is_qualifying_decision(jd.decision, pc.rn - 1)
    GROUP BY pc.competition_id, jd.entry_id, COALESCE(jd.photo_index, 0)
  ),
  actual AS (
    SELECT pc.competition_id, ge.entry_id, ge.photo_index
    FROM per_comp pc, LATERAL public.get_round_eligible_photos(pc.competition_id, pc.rn) ge
  ),
  diff AS (
    SELECT 'missing' AS kind, competition_id, entry_id, photo_index FROM expected
    EXCEPT SELECT 'missing', competition_id, entry_id, photo_index FROM actual
    UNION ALL
    SELECT 'extra' AS kind, competition_id, entry_id, photo_index FROM actual
    EXCEPT SELECT 'extra', competition_id, entry_id, photo_index FROM expected
  )
  SELECT 'eligibility_consistency'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(d)) FILTER (WHERE d.entry_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM diff LIMIT 5) d;

  -- 5. r4_stuck (unchanged — preserve original body)
  RETURN QUERY
  WITH stuck AS (
    SELECT c.id::text AS competition_id, c.title, c.status AS comp_status, c.current_round,
           jr.id::text AS round_id, jr.status AS round_status
    FROM public.competitions c
    JOIN public.judging_rounds jr ON jr.competition_id = c.id AND jr.round_number = 4
    WHERE jr.status = 'completed'
      AND c.status IN ('judging','active')
  )
  SELECT 'r4_stuck'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(s)) FILTER (WHERE s.competition_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM stuck LIMIT 5) s;

  -- 6. no_legacy_in_progression_writers (preserve)
  RETURN QUERY
  SELECT 'no_legacy_in_progression_writers'::text, 'ok'::text, 0, '[]'::jsonb;

END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Resync system_tag_decision_map.decision FROM v3_stage_catalog.decision_token
--    Match by (round_number, lowered/trimmed tag label).
-- ---------------------------------------------------------------------------
UPDATE public.system_tag_decision_map m
SET decision = sub.decision_token
FROM (
  SELECT jt.id AS tag_id, vsc.decision_token, vsc.round_number
  FROM public.judging_tags jt
  JOIN public.v3_stage_catalog vsc
    ON vsc.is_active = true
   AND lower(trim(vsc.tag_label_canonical)) = lower(trim(jt.label))
) sub
WHERE m.tag_id = sub.tag_id
  AND m.round_number = sub.round_number
  AND m.decision IS DISTINCT FROM sub.decision_token;

-- ---------------------------------------------------------------------------
-- 3) Self-healing trigger: any future v3_stage_catalog edit cascades into
--    system_tag_decision_map automatically. Prevents the original drift
--    from ever recurring.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_system_tag_decision_map_from_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.system_tag_decision_map m
  SET decision = NEW.decision_token
  FROM public.judging_tags jt
  WHERE m.tag_id = jt.id
    AND lower(trim(jt.label)) = lower(trim(NEW.tag_label_canonical))
    AND m.round_number = NEW.round_number
    AND NEW.is_active = true
    AND m.decision IS DISTINCT FROM NEW.decision_token;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_decision_map_on_catalog ON public.v3_stage_catalog;
CREATE TRIGGER trg_sync_decision_map_on_catalog
AFTER INSERT OR UPDATE ON public.v3_stage_catalog
FOR EACH ROW
EXECUTE FUNCTION public.sync_system_tag_decision_map_from_catalog();