BEGIN;

-- Extend catalog CHECK constraints to accept the 2 new contract keys
ALTER TABLE public.v3_stage_catalog DROP CONSTRAINT v3_stage_catalog_decision_token_chk;
ALTER TABLE public.v3_stage_catalog ADD  CONSTRAINT v3_stage_catalog_decision_token_chk
  CHECK (decision_token = ANY (ARRAY[
    'accept','reject','shortlist','needs_review','needs_verification',
    'qualified','qualified_final','finalist','winner','skip',
    'qualified_r3','not_selected_r3','shortlisted_final','not_selected_final',
    'runner_up_1','runner_up_2','honorary_mention','special_jury'
  ]));

ALTER TABLE public.v3_stage_catalog DROP CONSTRAINT v3_stage_catalog_family_chk;
ALTER TABLE public.v3_stage_catalog ADD  CONSTRAINT v3_stage_catalog_family_chk
  CHECK (family = ANY (ARRAY[
    'progression_pass','progression_fail','rejection',
    'needs_review','verification','award'
  ]));

-- Disable user triggers to avoid touching judging validations during atomic resync
ALTER TABLE public.competition_entries DISABLE TRIGGER USER;

-- Task 1.1 + 1.3 — Relabel existing rows byte-identical to contract
UPDATE public.v3_stage_catalog SET tag_label_canonical='Accepted'              WHERE stage_key='r1_accepted';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Needs Review'          WHERE stage_key='r1_needs_review';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Rejected'              WHERE stage_key='r1_rejected';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Accepted in Round 2'   WHERE stage_key='r2_accepted';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Qualified for Round 3' WHERE stage_key='r2_qualified_r3';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Accepted in Round 3'   WHERE stage_key='r3_accepted';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Qualified for Final Round' WHERE stage_key='r3_qualified_final';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Winner'                WHERE stage_key='r4_winner';
UPDATE public.v3_stage_catalog SET tag_label_canonical='1st Runner-Up'         WHERE stage_key='r4_runner_up_1';
UPDATE public.v3_stage_catalog SET tag_label_canonical='2nd Runner-Up'         WHERE stage_key='r4_runner_up_2';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Honorary Mention'      WHERE stage_key='r4_honorary_mention';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Special Jury Award'    WHERE stage_key='r4_special_jury';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Top 50 Global Photographer'  WHERE stage_key='r4_top_50';
UPDATE public.v3_stage_catalog SET tag_label_canonical='Top 100 Global Photographer' WHERE stage_key='r4_top_100';

-- Task 1.2 — Rename r1_shortlisted_for_r2 → r1_shortlisted_r2 + backfill 1 entry
UPDATE public.competition_entries
   SET progression_decision='r1_shortlisted_r2'
 WHERE progression_decision='r1_shortlisted_for_r2';

UPDATE public.v3_stage_catalog
   SET stage_key='r1_shortlisted_r2',
       tag_label_canonical='Qualified for Round 2'
 WHERE stage_key='r1_shortlisted_for_r2';

-- Task 1.4 — Soft-retire r4_qualified_final (R4 awards-only)
UPDATE public.v3_stage_catalog SET is_active=false WHERE stage_key='r4_qualified_final';

-- Task 1.5 — Soft-retire r2_not_selected_r3 + r3_not_selected_final (derived)
UPDATE public.v3_stage_catalog SET is_active=false WHERE stage_key='r2_not_selected_r3';
UPDATE public.v3_stage_catalog SET is_active=false WHERE stage_key='r3_not_selected_final';

-- Task 1.6 — Insert 2 missing keys to reach 16 active rows
INSERT INTO public.v3_stage_catalog
  (stage_key, round_number, family, decision_token, tag_label_canonical,
   advances_to_round, blocks_from_round, cert_eligible, is_active, description)
VALUES
  ('r1_needs_verification', 1, 'verification', 'needs_verification',
   'Verification Required', NULL, NULL, false, true,
   '16-key contract: R1 photo flagged for verification before progression decision'),
  ('r4_finalist', 4, 'award', 'finalist',
   'Finalist (no placement)', NULL, NULL, true, true,
   '16-key contract: R4 finalist that did not receive a specific placement award')
ON CONFLICT (stage_key) DO UPDATE
  SET round_number       = EXCLUDED.round_number,
      family             = EXCLUDED.family,
      decision_token     = EXCLUDED.decision_token,
      tag_label_canonical= EXCLUDED.tag_label_canonical,
      cert_eligible      = EXCLUDED.cert_eligible,
      is_active          = EXCLUDED.is_active,
      description        = EXCLUDED.description;

ALTER TABLE public.competition_entries ENABLE TRIGGER USER;

COMMIT;
