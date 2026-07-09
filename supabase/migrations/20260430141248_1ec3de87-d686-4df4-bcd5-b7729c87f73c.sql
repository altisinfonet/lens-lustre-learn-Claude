
BEGIN;

-- ─── STEP 1: Apply 3 label corrections ────────────────────────────────────────
UPDATE v3_stage_catalog SET tag_label_canonical = 'Top 100'
 WHERE stage_key = 'r4_top_100';

UPDATE v3_stage_catalog SET tag_label_canonical = 'Top 50'
 WHERE stage_key = 'r4_top_50';

UPDATE v3_stage_catalog SET tag_label_canonical = 'Qualified for Final Round'
 WHERE stage_key IN ('r3_qualified_final','r4_qualified_final');

-- ─── STEP 2: Post-flight invariants ──────────────────────────────────────────
DO $$
DECLARE
  v_after INT; v_dupes INT; v_legacy INT;
BEGIN
  SELECT COUNT(*) INTO v_after FROM v3_stage_catalog WHERE is_active;
  IF v_after <> 16 THEN
    RAISE EXCEPTION 'Phase1-corr INVARIANT FAILED: expected 16 active, got %', v_after;
  END IF;

  SELECT COUNT(*) INTO v_dupes
  FROM (
    SELECT round_number, lower(tag_label_canonical), COUNT(*) c
    FROM v3_stage_catalog WHERE is_active
    GROUP BY 1,2 HAVING COUNT(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'Phase1-corr INVARIANT FAILED: % duplicate (round,label) pairs', v_dupes;
  END IF;

  SELECT COUNT(*) INTO v_legacy FROM v3_stage_catalog
  WHERE stage_key IN (
    'r1_accept','r1_accept_short','r1_reject','r1_reject_short',
    'r2_qualified_r3_short','r4_best_moment',
    'r1_shortlist_for_r2','r3_shortlisted_final'
  );
  IF v_legacy > 0 THEN
    RAISE EXCEPTION 'Phase1-corr INVARIANT FAILED: % legacy stage_keys still present', v_legacy;
  END IF;

  RAISE NOTICE 'Phase1-corr OK: active=% dupes=0 legacy=0', v_after;
END $$;

COMMIT;
