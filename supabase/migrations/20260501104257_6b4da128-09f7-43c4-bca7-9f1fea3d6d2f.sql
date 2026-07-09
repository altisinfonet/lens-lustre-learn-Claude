-- ──────────────────────────────────────────────────────────────────────────
-- GUARD 1 — Improved vocabulary trigger error message
-- ──────────────────────────────────────────────────────────────────────────
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
    WHERE is_active = true
      AND stage_key = NEW.progression_decision
  ) THEN
    -- Resolve active round for diagnostic context (best effort, no failure if unresolved)
    BEGIN
      SELECT public.current_round_int(c.current_round)
      INTO v_active_round
      FROM public.competitions c
      WHERE c.id = NEW.competition_id;
    EXCEPTION WHEN OTHERS THEN
      v_active_round := NULL;
    END;

    -- Sample of valid keys for the active round (or all if round unknown)
    SELECT string_agg(stage_key, ', ' ORDER BY stage_key)
    INTO v_valid_keys
    FROM public.v3_stage_catalog
    WHERE is_active = true
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
            HINT    = 'Likely a stale trigger or edge fn writing legacy v5 vocab. Map to canonical stage_key from src/lib/judging/stageCatalog.ts.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────
-- GUARD 3 — Add `no_legacy_in_progression_writers` invariant.
-- Scope: functions that WRITE competition_entries.progression_decision must
-- only contain canonical v3_stage_catalog.stage_key values as string literals
-- when assigning to that column. We narrow the surface to writers (not all
-- functions) because legitimate functions reference legacy decision tokens
-- like 'qualified' / 'qualified_r3' as judge_decisions.decision values
-- (which is a separate vocabulary).
--
-- Heuristic: the legacy strings 'qualified', 'not_selected', 'shortlist',
-- 'accept', 'reject' must NOT appear as a value being assigned to
-- progression_decision in any function body. Anything else is fine.
-- ──────────────────────────────────────────────────────────────────────────
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

  -- 1. tag_decision_drift
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

  -- 2. current_round_canonical
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

  -- 3. decision_vocabulary
  RETURN QUERY
  WITH bad AS (
    SELECT id::text, decision, round_number
    FROM public.judge_decisions
    WHERE lower(decision) NOT IN (
      'accept','accepted','shortlist','shortlisted','qualified',
      'reject','rejected','needs_review','needs_verification','skip',
      'finalist','winner'
    )
  )
  SELECT 'decision_vocabulary'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(b)) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM bad LIMIT 5) b;

  -- 4. eligibility_consistency
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

  -- 5. r4_stuck — Round 4 marked completed but competition still in judging/active
  RETURN QUERY
  WITH stuck AS (
    SELECT c.id::text AS competition_id, c.title, c.status AS comp_status, c.current_round,
           jr.id::text AS round_id, jr.status AS round_status
    FROM public.competitions c
    JOIN public.judging_rounds jr ON jr.competition_id = c.id AND jr.round_number = 4
    WHERE c.status IN ('judging','active')
      AND jr.status = 'completed'
  )
  SELECT 'r4_stuck'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(s)) FILTER (WHERE s.competition_id IS NOT NULL), '[]'::jsonb)
  FROM (SELECT * FROM stuck LIMIT 5) s;

  -- 6. no_legacy_in_progression_writers (NEW — Phase R7 vocabulary lock)
  -- Scans every public function whose body modifies competition_entries
  -- AND mentions progression_decision, then asserts the function body does
  -- NOT contain quoted legacy vocabulary literals that would bypass the
  -- v3_stage_catalog gate. The gate function itself is exempt because it
  -- legitimately enumerates valid keys.
  RETURN QUERY
  WITH writers AS (
    SELECT p.proname, p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname <> 'enforce_progression_decision_vocabulary'
      AND p.proname <> 'judging_invariants_check'
      AND p.prosrc ~* 'progression_decision'
      AND p.prosrc ~* '(UPDATE\s+(public\.)?competition_entries|NEW\.progression_decision\s*:?=)'
  ),
  forbidden(lit) AS (
    VALUES ('qualified'), ('not_selected'), ('shortlisted_final'),
           ('qualified_r3'), ('qualified_final'),
           ('not_selected_r3'), ('not_selected_final'),
           ('accept'), ('reject'), ('shortlist')
  ),
  hits AS (
    SELECT w.proname, array_agg(DISTINCT f.lit) AS legacy_strings
    FROM writers w
    CROSS JOIN forbidden f
    -- Match the literal as a quoted SQL string within the function body.
    -- Word-boundary regex prevents false positives on canonical keys like
    -- r2_qualified_r3 (those won't be wrapped in standalone quotes).
    WHERE w.prosrc ~ ('''' || f.lit || '''')
    GROUP BY w.proname
  )
  SELECT 'no_legacy_in_progression_writers'::text,
         CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'fail' END,
         COUNT(*)::int,
         COALESCE(jsonb_agg(to_jsonb(h)) FILTER (WHERE h.proname IS NOT NULL), '[]'::jsonb)
  FROM hits h;
END;
$function$;