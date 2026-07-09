-- Step 1.2 — Create v3_stage_catalog (the canonical 16-stage lookup table)
-- Phase R1 of the Judging v3 forensic plan. This table is the single source
-- of truth that maps each admin-defined system tag to:
--   (a) a canonical stage_key,
--   (b) the judge_decisions.decision token to mirror,
--   (c) the round it advances to / is blocked from.
-- It is consumed by the mirror_system_tag_to_decision trigger (Step 1.3),
-- get_round_eligible_photos rewrite (Phase R2 Step 5), and downstream
-- eligibility/coverage gates.
--
-- Seeding of the 16 rows is performed in a separate insert step
-- (per project rule: migrations = schema only; data = insert tool).

CREATE TABLE public.v3_stage_catalog (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_key            text        NOT NULL UNIQUE,
  round_number         integer     NOT NULL,
  family               text        NOT NULL,
  decision_token       text        NOT NULL,
  tag_label_canonical  text        NOT NULL,
  advances_to_round    integer,
  blocks_from_round    integer,
  description          text        NOT NULL,
  is_active            boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT v3_stage_catalog_round_chk
    CHECK (round_number BETWEEN 1 AND 4),

  CONSTRAINT v3_stage_catalog_family_chk
    CHECK (family IN (
      'progression_pass',
      'progression_fail',
      'rejection',
      'needs_review',
      'award'
    )),

  CONSTRAINT v3_stage_catalog_decision_token_chk
    CHECK (decision_token IN (
      'accept','reject','shortlist','needs_review',
      'qualified','finalist','winner','skip',
      'qualified_r3','not_selected_r3',
      'shortlisted_final','not_selected_final',
      'runner_up_1','runner_up_2','honorary_mention','special_jury'
    )),

  CONSTRAINT v3_stage_catalog_advances_chk
    CHECK (advances_to_round IS NULL OR advances_to_round BETWEEN 2 AND 4),

  CONSTRAINT v3_stage_catalog_blocks_chk
    CHECK (blocks_from_round IS NULL OR blocks_from_round BETWEEN 2 AND 4),

  -- Each (round, canonical-tag-label) pair must be unique.
  -- Comparison is done case/whitespace-insensitively in app code; the
  -- tag_label_canonical column stores the canonical-cased form.
  CONSTRAINT v3_stage_catalog_round_label_uniq
    UNIQUE (round_number, tag_label_canonical)
);

CREATE INDEX v3_stage_catalog_round_active_idx
  ON public.v3_stage_catalog (round_number) WHERE is_active = true;

CREATE INDEX v3_stage_catalog_label_lower_idx
  ON public.v3_stage_catalog (lower(tag_label_canonical)) WHERE is_active = true;

COMMENT ON TABLE  public.v3_stage_catalog IS
  'Phase R1 Step 1.2 (2026-04-30): Canonical 16-stage catalog. Single source of truth that maps admin-defined judging tag labels to judge_decisions tokens. Consumed by mirror trigger (Step 1.3), eligibility RPC, coverage gate.';
COMMENT ON COLUMN public.v3_stage_catalog.stage_key IS
  'Stable short identifier used by code (e.g. r1_accept, r2_qualified_r3, r4_winner). Never rename.';
COMMENT ON COLUMN public.v3_stage_catalog.tag_label_canonical IS
  'Canonical-cased admin tag label. Lookups are case/whitespace-insensitive via lower(trim(...)).';

-- Auto-update updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.tg_v3_stage_catalog_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_v3_stage_catalog_touch
  BEFORE UPDATE ON public.v3_stage_catalog
  FOR EACH ROW EXECUTE FUNCTION public.tg_v3_stage_catalog_touch();

-- ============ RLS ============
ALTER TABLE public.v3_stage_catalog ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (it's reference data, no PII)
CREATE POLICY "v3_stage_catalog_read_authenticated"
  ON public.v3_stage_catalog
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: admins only (insert / update / soft-delete via is_active)
CREATE POLICY "v3_stage_catalog_insert_admin"
  ON public.v3_stage_catalog
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "v3_stage_catalog_update_admin"
  ON public.v3_stage_catalog
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- No DELETE policy → hard deletes are blocked (project Soft-Delete policy).
-- Admins deactivate by setting is_active = false.