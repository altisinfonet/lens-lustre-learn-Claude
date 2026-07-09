-- =========================================================================
-- A-05 FIX (Option A): wire judging tag clicks into entry-status pipeline
-- =========================================================================

-- 1. Tag classifier (mirrors src/lib/judging/tagSemantics.ts)
CREATE OR REPLACE FUNCTION public.classify_judging_tag(p_label text, p_visible_in_round int[])
RETURNS TABLE(family text, advances_to int, blocks_from int, verification_round int)
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n text := lower(regexp_replace(coalesce(p_label,''), '\s+', ' ', 'g'));
  rnd int := CASE WHEN p_visible_in_round IS NOT NULL AND array_length(p_visible_in_round,1) > 0
                  THEN p_visible_in_round[1] ELSE NULL END;
BEGIN
  -- Verification (check first; phrase is unambiguous)
  IF position('verification required' in n) > 0 THEN
    RETURN QUERY SELECT 'verification'::text, NULL::int, NULL::int, rnd; RETURN;
  END IF;

  -- Progression fail
  IF position('not selected for' in n) > 0 THEN
    RETURN QUERY SELECT 'progression_fail'::text, NULL::int,
      CASE
        WHEN position('2nd round' in n) > 0 THEN 2
        WHEN position('3rd round' in n) > 0 THEN 3
        WHEN position('4th round' in n) > 0 OR position('final round' in n) > 0 THEN 4
        ELSE NULL
      END, NULL::int;
    RETURN;
  END IF;

  -- Rejection
  IF n = 'rejected' THEN
    RETURN QUERY SELECT 'rejection'::text, NULL::int, NULL::int, NULL::int; RETURN;
  END IF;

  -- Progression pass
  IF n = 'accepted' THEN
    RETURN QUERY SELECT 'progression_pass'::text, 2, NULL::int, NULL::int; RETURN;
  END IF;
  IF position('qualified for' in n) > 0 THEN
    RETURN QUERY SELECT 'progression_pass'::text,
      CASE
        WHEN position('2nd round' in n) > 0 OR position('round 2' in n) > 0 THEN 2
        WHEN position('3rd round' in n) > 0 OR position('round 3' in n) > 0 THEN 3
        WHEN position('final round' in n) > 0 OR position('4th round' in n) > 0 OR position('round 4' in n) > 0 THEN 4
        ELSE NULL
      END, NULL::int, NULL::int;
    RETURN;
  END IF;

  -- Awards
  IF n = ANY(ARRAY['winner','1st runner up','2nd runner up','honorable mention',
                   'special jury award','best moment award',
                   'top 10 global photographer','top 50 finalist','top 100 global photographer']) THEN
    RETURN QUERY SELECT 'award'::text, NULL::int, NULL::int, NULL::int; RETURN;
  END IF;

  -- Unknown (no-op)
  RETURN QUERY SELECT 'unknown'::text, NULL::int, NULL::int, NULL::int;
END $$;


-- 2. Per-entry aggregation function: read tag assignments, compute progression
CREATE OR REPLACE FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_competition_id uuid;
  v_active_round int;
  v_assigned_judges int;
  v_photo_count int;
  v_per_photo record;
  v_all_photos_decided boolean := true;
  v_pass_count int := 0;
  v_fail_count int := 0;
  v_reject_count int := 0;
  v_total_photos int := 0;
  v_advances_to int := NULL;
  v_new_status text := NULL;
  v_new_round text := NULL;
  v_new_decision text := NULL;
BEGIN
  -- Resolve competition + active round
  SELECT competition_id, COALESCE(array_length(photos,1), 0)
    INTO v_competition_id, v_photo_count
  FROM competition_entries WHERE id = p_entry_id;
  IF v_competition_id IS NULL THEN RETURN; END IF;

  SELECT NULLIF(regexp_replace(coalesce(current_round,'round1'), '[^0-9]', '', 'g'), '')::int
    INTO v_active_round
  FROM competitions WHERE id = v_competition_id;
  IF v_active_round IS NULL THEN v_active_round := 1; END IF;

  -- How many judges are assigned to this competition?
  SELECT count(*) INTO v_assigned_judges
  FROM competition_judges WHERE competition_id = v_competition_id;
  IF v_assigned_judges = 0 OR v_photo_count = 0 THEN RETURN; END IF;

  -- For each photo: majority family among judges; require every judge to have tagged it
  FOR v_per_photo IN
    SELECT photo_index,
           count(DISTINCT judge_id) AS judges_decided,
           mode() WITHIN GROUP (ORDER BY (c.family)) AS majority_family,
           max(c.advances_to) AS adv,
           bool_or(c.family = 'progression_fail') AS any_fail,
           bool_or(c.family = 'rejection') AS any_reject
    FROM judge_tag_assignments jta
    JOIN judging_tags t ON t.id = jta.tag_id
    CROSS JOIN LATERAL public.classify_judging_tag(t.label, t.visible_in_round) c
    WHERE jta.entry_id = p_entry_id
      AND v_active_round = ANY(t.visible_in_round)
    GROUP BY photo_index
  LOOP
    v_total_photos := v_total_photos + 1;
    IF v_per_photo.judges_decided < v_assigned_judges THEN
      v_all_photos_decided := false;
    END IF;
    IF v_per_photo.majority_family = 'progression_pass' THEN
      v_pass_count := v_pass_count + 1;
      v_advances_to := COALESCE(v_per_photo.adv, v_advances_to);
    ELSIF v_per_photo.majority_family = 'progression_fail' THEN
      v_fail_count := v_fail_count + 1;
    ELSIF v_per_photo.majority_family = 'rejection' THEN
      v_reject_count := v_reject_count + 1;
    END IF;
  END LOOP;

  -- Coverage gate: every photo must be decided by every judge
  IF v_total_photos < v_photo_count OR NOT v_all_photos_decided THEN
    RETURN;
  END IF;

  -- Entry-level decision: pass wins if any photo passed, else fail, else reject
  IF v_pass_count > 0 THEN
    v_new_decision := 'qualified';
    v_new_round := 'round' || COALESCE(v_advances_to, v_active_round + 1);
    v_new_status := CASE COALESCE(v_advances_to, v_active_round + 1)
      WHEN 2 THEN 'round1_qualified'
      WHEN 3 THEN 'round2_qualified'
      WHEN 4 THEN 'shortlisted'
      ELSE 'submitted' END;
  ELSIF v_fail_count > 0 THEN
    v_new_decision := 'not_selected';
    v_new_round := 'round' || v_active_round; -- stays at current round, blocked from next
    v_new_status := CASE v_active_round
      WHEN 1 THEN 'round1_qualified'   -- R1 fail = no fail tag exists in R1, this branch unused
      WHEN 2 THEN 'round2_qualified'   -- passed R2 but blocked from R3
      WHEN 3 THEN 'shortlisted'        -- passed R3 but blocked from R4
      ELSE 'submitted' END;
  ELSIF v_reject_count > 0 THEN
    v_new_decision := 'reject';
    v_new_round := 'round' || v_active_round;
    v_new_status := 'rejected';
  ELSE
    RETURN; -- only verification/unknown — no progression effect
  END IF;

  UPDATE competition_entries
  SET progression_decision = v_new_decision,
      current_round = v_new_round,
      status = v_new_status,
      updated_at = now()
  WHERE id = p_entry_id;
END $$;


-- 3. Trigger on judge_tag_assignments
CREATE OR REPLACE FUNCTION public.trg_recompute_entry_after_tag_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_entry_from_tag_assignments(COALESCE(NEW.entry_id, OLD.entry_id));
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_aggregate_tag_assignments ON public.judge_tag_assignments;
CREATE TRIGGER trg_aggregate_tag_assignments
AFTER INSERT OR UPDATE OR DELETE ON public.judge_tag_assignments
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_entry_after_tag_change();


-- 4. Replace judging_progression_audit (compute expected_decision from tag assignments)
DROP VIEW IF EXISTS public.judging_progression_audit CASCADE;
CREATE VIEW public.judging_progression_audit AS
WITH per_photo AS (
  SELECT jta.entry_id,
         jta.photo_index,
         mode() WITHIN GROUP (ORDER BY c.family) AS majority_family,
         count(DISTINCT jta.judge_id) AS judge_count
  FROM judge_tag_assignments jta
  JOIN judging_tags t ON t.id = jta.tag_id
  CROSS JOIN LATERAL public.classify_judging_tag(t.label, t.visible_in_round) c
  GROUP BY jta.entry_id, jta.photo_index
),
agg AS (
  SELECT entry_id,
         bool_or(majority_family = 'progression_pass') AS any_pass,
         bool_or(majority_family = 'progression_fail') AS any_fail,
         bool_or(majority_family = 'rejection') AS any_reject,
         sum(judge_count) AS total_decisions
  FROM per_photo GROUP BY entry_id
),
computed AS (
  SELECT entry_id,
         CASE
           WHEN any_pass THEN 'qualified'
           WHEN any_fail THEN 'not_selected'
           WHEN any_reject THEN 'reject'
           ELSE NULL
         END AS expected_decision,
         total_decisions
  FROM agg
)
SELECT ce.id AS entry_id,
       ce.competition_id,
       ce.title,
       ce.status,
       ce.progression_decision AS stored_decision,
       c.expected_decision,
       c.total_decisions,
       CASE
         WHEN ce.progression_decision IS NULL AND c.expected_decision IS NULL THEN false
         WHEN ce.progression_decision IS DISTINCT FROM c.expected_decision THEN true
         ELSE false
       END AS has_drift,
       ce.updated_at
FROM competition_entries ce
LEFT JOIN computed c ON c.entry_id = ce.id;


-- 5. Replace entry_public_status with extra branches for not_selected_for_next_round
DROP VIEW IF EXISTS public.entry_public_status CASCADE;
CREATE VIEW public.entry_public_status AS
SELECT id AS entry_id,
       competition_id,
       CASE
         WHEN status IN ('winner','finalist') AND EXISTS (
           SELECT 1 FROM competition_round_publish p
           WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL
         ) THEN status
         WHEN status = 'shortlisted' AND EXISTS (
           SELECT 1 FROM competition_round_publish p
           WHERE p.competition_id = e.competition_id AND p.round_number = 3 AND p.published_at IS NOT NULL
         ) THEN status
         WHEN status = 'round2_qualified' AND EXISTS (
           SELECT 1 FROM competition_round_publish p
           WHERE p.competition_id = e.competition_id AND p.round_number = 2 AND p.published_at IS NOT NULL
         ) THEN status
         WHEN status IN ('round1_qualified','rejected') AND EXISTS (
           SELECT 1 FROM competition_round_publish p
           WHERE p.competition_id = e.competition_id AND p.round_number = 1 AND p.published_at IS NOT NULL
         ) THEN status
         WHEN status IN ('submitted','needs_review') THEN status
         ELSE 'judging_in_progress'
       END AS public_status,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM competition_round_publish p
           WHERE p.competition_id = e.competition_id AND p.published_at IS NOT NULL
         ) THEN current_round
         ELSE NULL
       END AS public_round,
       CASE
         WHEN progression_decision = 'not_selected' AND EXISTS (
           SELECT 1 FROM competition_round_publish p
           WHERE p.competition_id = e.competition_id
             AND p.round_number = NULLIF(regexp_replace(coalesce(current_round,''), '[^0-9]', '', 'g'),'')::int
             AND p.published_at IS NOT NULL
         ) THEN 'not_selected_for_next_round'
         ELSE NULL
       END AS public_progression_note,
       CASE
         WHEN placement IS NOT NULL AND EXISTS (
           SELECT 1 FROM competition_round_publish p
           WHERE p.competition_id = e.competition_id AND p.round_number = 4 AND p.published_at IS NOT NULL
         ) THEN placement
         ELSE NULL
       END AS public_placement
FROM competition_entries e;


-- 6. Backfill: recompute every existing entry once so audit view becomes accurate
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT entry_id FROM judge_tag_assignments LOOP
    PERFORM public.recompute_entry_from_tag_assignments(r.entry_id);
  END LOOP;
END $$;