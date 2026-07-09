CREATE OR REPLACE FUNCTION public._phase4_validate(test_entry uuid)
RETURNS TABLE(test_name text, expected text, actual text, passed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_err     text;
  v_tmp_id  uuid;
  v_comp    uuid;
  v_owner   uuid;
BEGIN
  SELECT competition_id, user_id INTO v_comp, v_owner
  FROM competition_entries WHERE id = test_entry;

  -- TEST C: pending entry, valid token → Phase 3 trigger blocks
  v_err := NULL;
  BEGIN
    BEGIN
      UPDATE competition_entries SET progression_decision = 'r1_accepted' WHERE id = test_entry;
      v_err := 'NO_ERROR';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    RAISE EXCEPTION 'rb_c';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rb_c' THEN v_err := COALESCE(v_err, SQLERRM); END IF;
  END;
  test_name := 'C_valid_while_pending_must_fail_via_PHASE3_trigger';
  expected  := 'pending-gate rejection';
  actual    := v_err;
  passed    := v_err LIKE '%pending photos%';
  RETURN NEXT;

  -- A & B: temp non-pending entry
  BEGIN
    INSERT INTO competition_entries (
      id, competition_id, user_id, title, current_round, status, photo_meta
    ) VALUES (
      gen_random_uuid(), v_comp, v_owner, '__phase4_test__', '1', 'submitted', '[]'::jsonb
    ) RETURNING id INTO v_tmp_id;

    -- TEST A: invalid 'shortlisted' → vocabulary trigger blocks
    v_err := NULL;
    BEGIN
      UPDATE competition_entries SET progression_decision = 'shortlisted' WHERE id = v_tmp_id;
      v_err := 'NO_ERROR';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    test_name := 'A_invalid_shortlisted_must_fail_via_VOCAB_trigger';
    expected  := 'vocabulary rejection';
    actual    := v_err;
    passed    := v_err LIKE '%not a valid v3_stage_catalog stage_key%';
    RETURN NEXT;

    -- TEST B: valid 'r1_accepted' on non-pending → must PASS
    v_err := NULL;
    BEGIN
      UPDATE competition_entries SET progression_decision = 'r1_accepted' WHERE id = v_tmp_id;
      v_err := 'OK';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    test_name := 'B_valid_r1_accepted_no_pending_must_PASS';
    expected  := 'OK';
    actual    := v_err;
    passed    := v_err = 'OK';
    RETURN NEXT;

    RAISE EXCEPTION 'rb_ab';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rb_ab' THEN
      test_name := 'AB_setup_failure';
      expected  := 'temp entry insert OK';
      actual    := SQLERRM;
      passed    := false;
      RETURN NEXT;
    END IF;
  END;
END;
$$;