CREATE OR REPLACE FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_target_round int;
BEGIN
  SELECT competition_id, COALESCE(array_length(photos,1), 0)
    INTO v_competition_id, v_photo_count
  FROM competition_entries WHERE id = p_entry_id;
  IF v_competition_id IS NULL THEN RETURN; END IF;

  SELECT NULLIF(regexp_replace(coalesce(current_round,'round1'), '[^0-9]', '', 'g'), '')::int
    INTO v_active_round
  FROM competitions WHERE id = v_competition_id;
  IF v_active_round IS NULL THEN v_active_round := 1; END IF;

  SELECT count(*) INTO v_assigned_judges
  FROM competition_judges WHERE competition_id = v_competition_id;
  IF v_assigned_judges = 0 OR v_photo_count = 0 THEN RETURN; END IF;

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

  IF v_total_photos < v_photo_count OR NOT v_all_photos_decided THEN
    RETURN;
  END IF;

  -- Map to canonical v3_stage_catalog keys per active round
  IF v_pass_count > 0 THEN
    v_new_decision := CASE v_active_round
      WHEN 1 THEN 'r1_shortlisted_for_r2'
      WHEN 2 THEN 'r2_qualified_r3'
      WHEN 3 THEN 'r3_qualified_final'
      WHEN 4 THEN 'r4_qualified_final'
      ELSE NULL END;
    v_target_round := COALESCE(v_advances_to, v_active_round + 1);
    -- Clamp into valid range [1..4] to satisfy current_round CHECK constraint
    IF v_target_round < 1 THEN v_target_round := 1; END IF;
    IF v_target_round > 4 THEN v_target_round := 4; END IF;
    v_new_round := v_target_round::text;  -- digit-only format required by check constraint
    v_new_status := CASE v_target_round
      WHEN 2 THEN 'round1_qualified'
      WHEN 3 THEN 'round2_qualified'
      WHEN 4 THEN 'shortlisted'
      ELSE 'submitted' END;
  ELSIF v_fail_count > 0 THEN
    v_new_decision := CASE v_active_round
      WHEN 1 THEN 'r1_accepted'
      WHEN 2 THEN 'r2_not_selected_r3'
      WHEN 3 THEN 'r3_not_selected_final'
      ELSE NULL END;
    v_new_round := v_active_round::text;
    v_new_status := CASE v_active_round
      WHEN 2 THEN 'round2_qualified'
      WHEN 3 THEN 'shortlisted'
      ELSE 'submitted' END;
  ELSIF v_reject_count > 0 THEN
    v_new_decision := CASE v_active_round
      WHEN 1 THEN 'r1_rejected'
      ELSE NULL END;
    v_new_round := v_active_round::text;
    v_new_status := 'rejected';
  ELSE
    RETURN;
  END IF;

  IF v_new_decision IS NULL THEN
    RETURN;
  END IF;

  UPDATE competition_entries
  SET progression_decision = v_new_decision,
      current_round = v_new_round,
      status = v_new_status,
      updated_at = now()
  WHERE id = p_entry_id;
END $function$;