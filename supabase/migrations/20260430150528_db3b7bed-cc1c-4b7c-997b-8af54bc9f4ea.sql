CREATE OR REPLACE FUNCTION public._phase4_validate(test_entry uuid)
RETURNS TABLE(test_name text, expected text, actual text, passed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_err     text;
  v_tmp_id  uuid;
  v_user    uuid;
  v_comp    uuid;
  v_owner   uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  SELECT competition_id, user_id INTO v_comp, v_owner
  FROM competition_entries WHERE id = test_entry;

  -- =========================================================
  -- TEST C (run first, on the real pending entry)
  -- valid 'r1_accepted' on pending entry → Phase 3 trigger blocks
  -- =========================================================
  v_err := NULL;
  BEGIN
    BEGIN
      UPDATE competition_entries SET progression_decision = 'r1_accepted' WHERE id = test_entry;
      v_err := 'NO_ERROR';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
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

  -- =========================================================
  -- For Tests A & B we need a NON-pending entry. Create a temp
  -- entry with photo_meta=[] so any_photo_pending() returns FALSE
  -- (no photos = no pending photos). Roll back at the end.
  -- =========================================================
  BEGIN
    INSERT INTO competition_entries (
      id, competition_id, user_id, current_round, status, photo_meta
    ) VALUES (
      gen_random_uuid(), v_comp, v_owner, '1', 'submitted', '[]'::jsonb
    ) RETURNING id INTO v_tmp_id;

    -- TEST A: invalid 'shortlisted' on non-pending entry → vocabulary trigger blocks
    v_err := NULL;
    BEGIN
      UPDATE competition_entries SET progression_decision = 'shortlisted' WHERE id = v_tmp_id;
      v_err := 'NO_ERROR';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    test_name := 'A_invalid_shortlisted_must_fail_via_VOCAB_trigger';
    expected  := 'vocabulary rejection';
    actual    := v_err;
    passed    := v_err LIKE '%not a valid v3_stage_catalog stage_key%';
    RETURN NEXT;

    -- TEST B: valid 'r1_accepted' on non-pending entry → must PASS
    v_err := NULL;
    BEGIN
      UPDATE competition_entries SET progression_decision = 'r1_accepted' WHERE id = v_tmp_id;
      v_err := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    test_name := 'B_valid_r1_accepted_no_pending_must_PASS';
    expected  := 'OK';
    actual    := v_err;
    passed    := v_err = 'OK';
    RETURN NEXT;

    RAISE EXCEPTION 'rb_ab';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rb_ab' THEN
      RAISE NOTICE 'Outer rollback reason: %', SQLERRM;
    END IF;
  END;
END;
$$;