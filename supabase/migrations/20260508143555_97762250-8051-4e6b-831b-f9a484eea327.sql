-- ============================================================================
-- judging_write_decision_atomic — Single-RPC phase (controlled execution)
-- Corrected audit-log shape: row_id text + auth.uid() changed_by.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.judging_write_decision_atomic(
  p_entry_id uuid,
  p_stage_key text,
  p_current_round text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catalog       record;
  v_old_stage_key text;
  v_old_order     int;
  v_new_order     int;
  v_txid          bigint;
  v_rows          int;
BEGIN
  PERFORM set_config('app.write_path', 'judging_write_decision_atomic', true);
  v_txid := txid_current();

  IF p_entry_id IS NULL THEN
    RAISE EXCEPTION 'judging_write_decision_atomic: p_entry_id required' USING ERRCODE = '22023';
  END IF;
  IF p_stage_key IS NULL OR length(btrim(p_stage_key)) = 0 THEN
    RAISE EXCEPTION 'judging_write_decision_atomic: p_stage_key required' USING ERRCODE = '22023';
  END IF;
  IF p_current_round IS NULL OR length(btrim(p_current_round)) = 0 THEN
    RAISE EXCEPTION 'judging_write_decision_atomic: p_current_round required' USING ERRCODE = '22023';
  END IF;

  SELECT stage_key, round_number, decision_token, family, is_active
    INTO v_catalog
    FROM public.v3_stage_catalog
   WHERE stage_key = p_stage_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'judging_write_decision_atomic: unknown stage_key %', p_stage_key USING ERRCODE = '22023';
  END IF;
  IF NOT v_catalog.is_active THEN
    RAISE EXCEPTION 'judging_write_decision_atomic: stage_key % is inactive', p_stage_key USING ERRCODE = '22023';
  END IF;

  SELECT stage_key INTO v_old_stage_key
    FROM public.competition_entries
   WHERE id = p_entry_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'judging_write_decision_atomic: entry % not found', p_entry_id USING ERRCODE = 'P0002';
  END IF;

  v_new_order := public.progression_order(p_stage_key);

  IF v_old_stage_key IS NOT NULL AND v_old_stage_key <> p_stage_key THEN
    v_old_order := public.progression_order(v_old_stage_key);
    IF v_new_order < v_old_order THEN
      RAISE EXCEPTION
        'judging_write_decision_atomic: rewind refused (% [%] -> % [%]). Use admin_rewind_stage().',
        v_old_stage_key, v_old_order, p_stage_key, v_new_order
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.competition_entries
     SET stage_key     = p_stage_key,
         current_round = p_current_round,
         updated_at    = now()
   WHERE id = p_entry_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
  VALUES (
    'competition_entries',
    'judging_write_decision_atomic',
    p_entry_id::text,
    jsonb_build_object(
      'txid',           v_txid,
      'stage_key_old',  v_old_stage_key,
      'stage_key_new',  p_stage_key,
      'current_round',  p_current_round,
      'write_path',     'judging_write_decision_atomic',
      'rows_updated',   v_rows
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'ok',             true,
    'entry_id',       p_entry_id,
    'stage_key_old',  v_old_stage_key,
    'stage_key_new',  p_stage_key,
    'current_round',  p_current_round,
    'write_path',     'judging_write_decision_atomic',
    'txid',           v_txid,
    'rows_updated',   v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.judging_write_decision_atomic(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.judging_write_decision_atomic(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.judging_write_decision_atomic(uuid, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.judging_write_decision_atomic(uuid, text, text) TO service_role;

-- ============================================================================
-- INLINE SELF-TEST
-- ============================================================================
DO $test$
DECLARE
  v_entry_id uuid;
  v_orig_stage text;
  v_orig_round text;
  v_orig_status text;
  v_result jsonb;
  v_audit_count int;
  v_txid_seen bigint;
  v_rewound boolean := false;
BEGIN
  SELECT id, stage_key, current_round, status
    INTO v_entry_id, v_orig_stage, v_orig_round, v_orig_status
    FROM public.competition_entries
   WHERE stage_key IS NULL
   ORDER BY id
   LIMIT 1;

  IF v_entry_id IS NULL THEN
    RAISE NOTICE '[self-test] SKIPPED: no NULL-stage_key entry available';
    RETURN;
  END IF;

  RAISE NOTICE '[self-test] entry=% orig_stage=% orig_round=% orig_status=%',
    v_entry_id, v_orig_stage, v_orig_round, v_orig_status;

  v_result := public.judging_write_decision_atomic(v_entry_id, 'r1_accepted', '1');
  RAISE NOTICE '[self-test:T1 forward-write] result=%', v_result;
  v_txid_seen := (v_result->>'txid')::bigint;

  IF (SELECT status FROM public.competition_entries WHERE id = v_entry_id) <> v_orig_status THEN
    RAISE EXCEPTION '[self-test:T1] FAIL: status mutated';
  END IF;
  RAISE NOTICE '[self-test:T1] OK status untouched (%)', v_orig_status;

  IF (SELECT stage_key FROM public.competition_entries WHERE id = v_entry_id) <> 'r1_accepted' THEN
    RAISE EXCEPTION '[self-test:T1] FAIL: stage_key not written';
  END IF;
  RAISE NOTICE '[self-test:T1] OK stage_key=r1_accepted';

  SELECT count(*) INTO v_audit_count
    FROM public.db_audit_logs
   WHERE table_name = 'competition_entries'
     AND operation  = 'judging_write_decision_atomic'
     AND row_id     = v_entry_id::text
     AND (new_data->>'txid')::bigint = v_txid_seen;
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION '[self-test:T1] FAIL: expected 1 audit row with txid=%, got %',
      v_txid_seen, v_audit_count;
  END IF;
  RAISE NOTICE '[self-test:T1] OK db_audit_logs row present (txid=%)', v_txid_seen;

  BEGIN
    v_result := public.judging_write_decision_atomic(v_entry_id, 'r1_needs_review', '1');
    RAISE EXCEPTION '[self-test:T2] FAIL: rewind was accepted (should have raised)';
  EXCEPTION WHEN check_violation THEN
    v_rewound := true;
    RAISE NOTICE '[self-test:T2] OK rewind correctly refused (SQLSTATE 23514)';
  END;

  IF NOT v_rewound THEN
    RAISE EXCEPTION '[self-test:T2] FAIL: rewind path not exercised';
  END IF;

  PERFORM set_config('app.allow_stage_rewind', 'on', true);
  UPDATE public.competition_entries
     SET stage_key     = v_orig_stage,
         current_round = v_orig_round
   WHERE id = v_entry_id;
  PERFORM set_config('app.allow_stage_rewind', 'off', true);

  IF (SELECT stage_key FROM public.competition_entries WHERE id = v_entry_id) IS DISTINCT FROM v_orig_stage THEN
    RAISE EXCEPTION '[self-test:cleanup] FAIL: stage_key not restored';
  END IF;
  IF (SELECT status FROM public.competition_entries WHERE id = v_entry_id) <> v_orig_status THEN
    RAISE EXCEPTION '[self-test:cleanup] FAIL: status drifted';
  END IF;

  RAISE NOTICE '[self-test] ALL PASS — entry % restored to stage_key=% round=% status=%',
    v_entry_id, v_orig_stage, v_orig_round, v_orig_status;
END
$test$;