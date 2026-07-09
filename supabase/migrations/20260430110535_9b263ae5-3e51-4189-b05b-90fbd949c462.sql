ALTER TABLE public.v3_stage_catalog
  ADD COLUMN IF NOT EXISTS cert_eligible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.v3_stage_catalog.cert_eligible IS
  'Judging v3 / Phase 3.2: TRUE when reaching this stage makes the photo eligible for a certificate. Seeded TRUE for family IN (progression_pass, award); FALSE for rejection, needs_review, progression_fail. Single source of truth used by complete-round and publish-round edge functions.';