-- Temporary validation harness — runs each test in a savepoint, rolls back.
CREATE OR REPLACE FUNCTION public._phase4_validate(test_entry uuid)
RETURNS TABLE(test_name text, expected text, actual text, passed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_err text;
  v_orig_round text;
BEGIN
  SELECT current_round INTO v_orig_round FROM competition_entries WHERE id = test_entry;

  -- TEST A: invalid value 'shortlisted' → vocabulary trigger should reject
  BEGIN
    BEGIN
      UPDATE competition_entries SET progression_decision = 'shortlisted' WHERE id = test_entry;
      v_err := 'NO_ERROR_RAISED';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    RAISE EXCEPTION 'rollback_savepoint_a';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_savepoint_a' THEN
      v_err := COALESCE(v_err, SQLERRM);
    END IF;
  END;
  test_name := 'A_invalid_shortlisted_must_fail';
  expected  := 'reject via vocabulary trigger';
  actual    := v_err;
  passed    := v_err LIKE '%not a valid v3_stage_catalog stage_key%';
  RETURN NEXT;

  -- TEST B: valid 'r1_accepted' on the entry switched to a fully-decided round.
  -- Force round=1 (entry has 0 R1 decisions for 20 photos → still pending).
  -- So instead, simulate "fully decided" by switching round to a non-existent one
  -- where any_photo_pending returns FALSE only if 0 photos exist. The test entry
  -- has 20 photos, so it will always be pending in any round.
  -- Better approach: temporarily flip current_round to a value where the entry
  -- has decisions for all photos. Phase 3 check uses jd_count per (entry, photo, round).
  -- We'll try round 2 / 3 / 4. From earlier audit, round 3 has 0 jd → pending.
  -- Use a savepoint approach: insert decisions for all 20 photos in a fake round,
  -- test, then roll back.
  BEGIN
    -- create temporary decisions covering all 20 photos in round 99
    INSERT INTO judge_decisions (entry_id, photo_index, round_number, judge_id, decision)
    SELECT test_entry, gs, 99,
           (SELECT id FROM auth.users LIMIT 1),
           'accept'
    FROM generate_series(0, 19) gs;

    UPDATE competition_entries SET current_round = '99' WHERE id = test_entry;

    BEGIN
      UPDATE competition_entries SET progression_decision = 'r1_accepted' WHERE id = test_entry;
      v_err := 'OK_NO_ERROR';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;

    RAISE EXCEPTION 'rollback_savepoint_b';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_savepoint_b' THEN
      v_err := COALESCE(v_err, SQLERRM);
    END IF;
  END;
  test_name := 'B_valid_r1_accepted_no_pending_must_pass';
  expected  := 'OK_NO_ERROR';
  actual    := v_err;
  passed    := v_err = 'OK_NO_ERROR';
  RETURN NEXT;

  -- TEST C: valid 'r1_accepted' while entry IS pending → Phase 3 trigger blocks
  BEGIN
    BEGIN
      UPDATE competition_entries SET progression_decision = 'r1_accepted' WHERE id = test_entry;
      v_err := 'NO_ERROR_RAISED';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    RAISE EXCEPTION 'rollback_savepoint_c';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rollback_savepoint_c' THEN
      v_err := COALESCE(v_err, SQLERRM);
    END IF;
  END;
  test_name := 'C_valid_r1_accepted_while_pending_must_fail_via_trigger';
  expected  := 'reject via pending-gate (Phase 3)';
  actual    := v_err;
  passed    := v_err LIKE '%pending photos%' OR v_err LIKE '%cannot be set%';
  RETURN NEXT;
END;
$$;