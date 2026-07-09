
BEGIN;

-- ─── STEP 0: Replace global unique_tag_label with composite UNIQUE ────────────
ALTER TABLE judging_tags DROP CONSTRAINT unique_tag_label;
ALTER TABLE judging_tags
  ADD CONSTRAINT unique_tag_label_per_round UNIQUE (label, visible_in_round);

-- Disable only the unguarded duplicate trigger
ALTER TABLE judging_tags DISABLE TRIGGER trg_protect_system_tags;

-- Engage the canonical trigger's documented escape hatch
SET LOCAL app.allow_system_tag_rename = 'on';

-- ─── STEP 1: Rename 8 tag rows (preserve tag_id) ──────────────────────────────
UPDATE judging_tags SET label = 'Accepted'                      WHERE id = '4f1805d5-0a86-4abf-bb27-496da58bd0b2';
UPDATE judging_tags SET label = 'Rejected'                      WHERE id = '4b440411-1efe-49c4-a9ee-a491a78bdb4d';
UPDATE judging_tags SET label = 'Qualified for 3rd Round'       WHERE id = '67d446d4-fec6-4f45-8643-03c3ff2d462f';
UPDATE judging_tags SET label = 'Not Selected for 3rd Round',
                       is_active = true                         WHERE id = 'bce0e662-76cb-4196-9798-e7d14bd1d782';
UPDATE judging_tags SET label = 'Qualified for Final Round'     WHERE id = 'df11381a-1d96-4c46-8439-747ed3a7b0c6';
UPDATE judging_tags SET label = 'Not Selected for Final Round',
                       is_active = true                         WHERE id = '15012bbe-9d46-42e1-8e38-a639a3f5769f';
UPDATE judging_tags SET label = 'Qualified for Final Round'     WHERE id = 'fa292f24-998f-4692-82ab-0a3e6b968443';
UPDATE judging_tags SET label = 'Special Jury Award'            WHERE id = 'ddf5b7bb-775f-4906-b636-36f9b737b090';

-- ─── STEP 2: Add missing system_tag_decision_map rows ────────────────────────
INSERT INTO system_tag_decision_map (tag_id, round_number, decision)
SELECT 'bce0e662-76cb-4196-9798-e7d14bd1d782', 2, 'reject'
WHERE NOT EXISTS (SELECT 1 FROM system_tag_decision_map
                  WHERE tag_id='bce0e662-76cb-4196-9798-e7d14bd1d782' AND round_number=2);

INSERT INTO system_tag_decision_map (tag_id, round_number, decision)
SELECT '15012bbe-9d46-42e1-8e38-a639a3f5769f', 3, 'reject'
WHERE NOT EXISTS (SELECT 1 FROM system_tag_decision_map
                  WHERE tag_id='15012bbe-9d46-42e1-8e38-a639a3f5769f' AND round_number=3);

-- Re-arm the duplicate trigger
ALTER TABLE judging_tags ENABLE TRIGGER trg_protect_system_tags;

-- ─── STEP 3: Post-flight invariants ──────────────────────────────────────────
DO $$
DECLARE
  v_orphan_tags    INT;
  v_active_tags    INT;
  v_unmapped_tags  INT;
BEGIN
  SELECT COUNT(*) INTO v_orphan_tags
  FROM judging_tags t
  WHERE t.is_active AND t.is_system
    AND NOT EXISTS (
      SELECT 1 FROM v3_stage_catalog c
      WHERE c.is_active
        AND c.round_number = t.visible_in_round[1]
        AND lower(c.tag_label_canonical) = lower(t.label)
    );
  IF v_orphan_tags > 0 THEN
    RAISE EXCEPTION 'Phase2 INVARIANT FAILED: % active SYSTEM tag(s) have no catalog match', v_orphan_tags;
  END IF;

  SELECT COUNT(*) INTO v_active_tags
  FROM judging_tags WHERE is_active AND is_system;
  IF v_active_tags <> 8 THEN
    RAISE EXCEPTION 'Phase2 INVARIANT FAILED: expected 8 active system tags, got %', v_active_tags;
  END IF;

  SELECT COUNT(*) INTO v_unmapped_tags
  FROM judging_tags t
  WHERE t.is_active AND t.is_system
    AND NOT EXISTS (SELECT 1 FROM system_tag_decision_map m
                    WHERE m.tag_id = t.id AND m.round_number = t.visible_in_round[1]);
  IF v_unmapped_tags > 0 THEN
    RAISE EXCEPTION 'Phase2 INVARIANT FAILED: % active system tag(s) lack a decision map row', v_unmapped_tags;
  END IF;

  RAISE NOTICE 'Phase2 OK: orphans=0 active_system_tags=8 unmapped=0';
END $$;

COMMIT;
