
-- ============================================================================
-- Judging v3 Phase Plan FINAL LOCKED — Phase 1 (RETRY 2)
-- Pre-flight findings (Mandate Rule 3 — full column audit):
--   1. decision_token CHECK lacks 'qualified_final' → widened in STEP 0
--   2. description column is NOT NULL → all INSERTs now supply it,
--      renamed r3_qualified_final row gets refreshed description.
-- ============================================================================

BEGIN;

-- ─── STEP 0: Widen decision_token CHECK to allow new 'qualified_final' token ──
ALTER TABLE v3_stage_catalog
  DROP CONSTRAINT v3_stage_catalog_decision_token_chk;

ALTER TABLE v3_stage_catalog
  ADD CONSTRAINT v3_stage_catalog_decision_token_chk
  CHECK (decision_token = ANY (ARRAY[
    'accept','reject','shortlist','needs_review',
    'qualified','qualified_final','finalist','winner','skip',
    'qualified_r3','not_selected_r3','shortlisted_final','not_selected_final',
    'runner_up_1','runner_up_2','honorary_mention','special_jury'
  ]));

-- Pre-flight invariant: capture starting active count for audit
DO $$
DECLARE
  v_before INT;
BEGIN
  SELECT COUNT(*) INTO v_before FROM v3_stage_catalog WHERE is_active;
  RAISE NOTICE 'Phase1 pre-flight active count: %', v_before;
  IF v_before <> 19 THEN
    RAISE EXCEPTION 'Phase1 pre-flight FAILED: expected 19 active rows, got %', v_before;
  END IF;
END $$;

-- ─── STEP 1: Hard DELETE 6 truly-extra keys ───────────────────────────────────
DELETE FROM v3_stage_catalog
WHERE stage_key IN (
  'r1_accept',
  'r1_accept_short',
  'r1_reject',
  'r1_reject_short',
  'r2_qualified_r3_short',
  'r4_best_moment'
);

-- ─── STEP 2: RENAME 2 keys (NOT delete + add) ─────────────────────────────────
UPDATE v3_stage_catalog
   SET stage_key = 'r1_shortlisted_for_r2'
 WHERE stage_key = 'r1_shortlist_for_r2';

UPDATE v3_stage_catalog
   SET stage_key           = 'r3_qualified_final',
       tag_label_canonical = 'Qualified for Final',
       decision_token      = 'qualified_final',
       description         = 'R3 pass — photo qualifies for Round 4 (Final).'
 WHERE stage_key = 'r3_shortlisted_final';

-- ─── STEP 3: ADD 3 new keys (description supplied) ────────────────────────────
INSERT INTO v3_stage_catalog
  (stage_key, round_number, family, decision_token, tag_label_canonical,
   advances_to_round, blocks_from_round, description, cert_eligible, is_active)
VALUES
  ('r1_accepted',         1, 'progression_pass', 'accept',          'Accepted',
     2,    NULL, 'R1 pass — photo accepted and advances to Round 2.',                    true,  true),
  ('r1_rejected',         1, 'rejection',        'reject',          'Rejected',
     NULL, NULL, 'R1 fail — photo rejected and exits the competition.',                  false, true),
  ('r4_qualified_final',  4, 'progression_pass', 'qualified_final', 'Qualified for Final',
     NULL, NULL, 'R4 entry-gate marker — photo is qualified to compete in the Final.',   false, true);

-- ─── STEP 4: Post-flight invariants ──────────────────────────────────────────
DO $$
DECLARE
  v_after          INT;
  v_total          INT;
  v_dupes          INT;
  v_legacy_extras  INT;
BEGIN
  SELECT COUNT(*) INTO v_after FROM v3_stage_catalog WHERE is_active;
  SELECT COUNT(*) INTO v_total FROM v3_stage_catalog;

  IF v_after <> 16 THEN
    RAISE EXCEPTION 'Phase1 INVARIANT FAILED: expected 16 active, got %', v_after;
  END IF;

  SELECT COUNT(*) INTO v_dupes
  FROM (
    SELECT round_number, lower(tag_label_canonical), COUNT(*) c
    FROM v3_stage_catalog WHERE is_active
    GROUP BY 1,2 HAVING COUNT(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'Phase1 INVARIANT FAILED: % duplicate (round,label) pairs', v_dupes;
  END IF;

  SELECT COUNT(*) INTO v_legacy_extras
  FROM v3_stage_catalog
  WHERE stage_key IN (
    'r1_accept','r1_accept_short','r1_reject','r1_reject_short',
    'r2_qualified_r3_short','r4_best_moment',
    'r1_shortlist_for_r2','r3_shortlisted_final'
  );
  IF v_legacy_extras > 0 THEN
    RAISE EXCEPTION 'Phase1 INVARIANT FAILED: % legacy stage_keys still present', v_legacy_extras;
  END IF;

  RAISE NOTICE 'Phase1 OK: active=% total=% dupes=0 legacy_extras=0', v_after, v_total;
END $$;

COMMIT;
