CREATE TABLE IF NOT EXISTS public._v3_quarantine_decisions (
  quarantine_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  quarantine_reason text NOT NULL,
  quarantine_phase text NOT NULL,
  source_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  judge_id uuid NOT NULL,
  photo_index integer,
  round_number integer NOT NULL,
  decision text NOT NULL,
  source_created_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL
);

ALTER TABLE public._v3_quarantine_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "v3_quarantine_decisions admin read" ON public._v3_quarantine_decisions;
CREATE POLICY "v3_quarantine_decisions admin read"
  ON public._v3_quarantine_decisions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public._v3_quarantine_decisions IS
  'Judging v3 cleanup quarantine. Holds judge_decisions rows that violate the v3 catalog (e.g. R2 reject) so they can be reviewed/restored. Populated by Phase 0 Step 0.2.';