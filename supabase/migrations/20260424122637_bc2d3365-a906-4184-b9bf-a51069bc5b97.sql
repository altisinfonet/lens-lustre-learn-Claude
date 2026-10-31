DO $$
DECLARE r text;
BEGIN
  r := public._diag_emit_test();
  RAISE NOTICE 'DIAG RESULT: %', r;
END $$;