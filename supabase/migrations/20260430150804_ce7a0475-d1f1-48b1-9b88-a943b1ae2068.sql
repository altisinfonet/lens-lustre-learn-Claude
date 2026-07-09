CREATE OR REPLACE FUNCTION public._phase4_validate(test_entry uuid)
RETURNS TABLE(test_name text, expected text, actual text, passed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_err text;
BEGIN
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

  -- A & B: temporarily clear photo_meta so any_photo_pending() returns FALSE
  -- (no photos = no pending photos), then test, then roll everything back.
  BEGIN
    UPDATE competition_entries SET photo_meta = '[]'::jsonb WHERE id = test_entry;

    -- TEST A: invalid token → vocabulary trigger blocks
    v_err := NULL;
    BEGIN
      UPDATE competition_entries SET progression_decision = 'shortlisted' WHERE id = test_entry;
      v_err := 'NO_ERROR';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    test_name := 'A_invalid_shortlisted_must_fail_via_VOCAB_trigger';
    expected  := 'vocabulary rejection';
    actual    := v_err;
    passed    := v_err LIKE '%not a valid v3_stage_catalog stage_key%';
    RETURN NEXT;

    -- TEST B: valid token on non-pending → must PASS
    v_err := NULL;
    BEGIN
      UPDATE competition_entries SET progression_decision = 'r1_accepted' WHERE id = test_entry;
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
      expected  := 'photo_meta clear OK';
      actual    := SQLERRM;
      passed    := false;
      RETURN NEXT;
    END IF;
  END;
END;
$$;