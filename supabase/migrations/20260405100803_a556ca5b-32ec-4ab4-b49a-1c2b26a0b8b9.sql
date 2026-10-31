
-- =====================================================
-- VOTING INTEGRITY FIX — admin_vote_adjustments table
-- =====================================================

-- 1. Create the admin_vote_adjustments table
CREATE TABLE public.admin_vote_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL,
  adjustment_value integer NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Constraint: adjustment_value must NOT be 0
ALTER TABLE public.admin_vote_adjustments
  ADD CONSTRAINT adjustment_value_nonzero CHECK (adjustment_value <> 0);

-- 3. Enable RLS
ALTER TABLE public.admin_vote_adjustments ENABLE ROW LEVEL SECURITY;

-- 4. RLS: Only admins can read
CREATE POLICY "Admins can read vote adjustments"
  ON public.admin_vote_adjustments FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 5. RLS: Only admins can insert
CREATE POLICY "Admins can insert vote adjustments"
  ON public.admin_vote_adjustments FOR INSERT
  TO authenticated
  WITH CHECK (
    admin_id = auth.uid()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- 6. RLS: Only admins can delete (for corrections)
CREATE POLICY "Admins can delete vote adjustments"
  ON public.admin_vote_adjustments FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 7. Audit trigger
CREATE TRIGGER audit_admin_vote_adjustments
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_vote_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();

-- 8. Index for fast lookups
CREATE INDEX idx_admin_vote_adj_entry ON public.admin_vote_adjustments(entry_id);
CREATE INDEX idx_admin_vote_adj_competition ON public.admin_vote_adjustments(competition_id);

-- 9. Create a view for final vote calculation
CREATE OR REPLACE VIEW public.entry_final_votes AS
SELECT
  ce.id AS entry_id,
  ce.competition_id,
  COALESCE(v.real_votes, 0) AS real_votes,
  COALESCE(a.adjustment_total, 0) AS adjustment_total,
  COALESCE(v.real_votes, 0) + COALESCE(a.adjustment_total, 0) AS final_votes
FROM public.competition_entries ce
LEFT JOIN (
  SELECT entry_id, COUNT(*)::integer AS real_votes
  FROM public.competition_votes
  GROUP BY entry_id
) v ON v.entry_id = ce.id
LEFT JOIN (
  SELECT entry_id, SUM(adjustment_value)::integer AS adjustment_total
  FROM public.admin_vote_adjustments
  GROUP BY entry_id
) a ON a.entry_id = ce.id;
