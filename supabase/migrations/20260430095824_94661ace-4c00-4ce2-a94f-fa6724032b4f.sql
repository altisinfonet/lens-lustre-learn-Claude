-- Step 0.3 — Quarantine table for invalid R3 tag assignments
CREATE TABLE IF NOT EXISTS public._v3_quarantine_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  judge_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  photo_index integer NOT NULL,
  original_created_at timestamptz NOT NULL,
  tag_label_snapshot text,
  quarantine_reason text NOT NULL,
  quarantine_phase text NOT NULL DEFAULT 'v3_step_0_3',
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb
);

ALTER TABLE public._v3_quarantine_tag_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view quarantined tag assignments"
  ON public._v3_quarantine_tag_assignments;
CREATE POLICY "Admins can view quarantined tag assignments"
  ON public._v3_quarantine_tag_assignments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can insert quarantined tag assignments"
  ON public._v3_quarantine_tag_assignments;
CREATE POLICY "Admins can insert quarantined tag assignments"
  ON public._v3_quarantine_tag_assignments
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));