-- Remove the overly permissive SELECT policy that allowed any authenticated user
-- to read the full admin vote adjustment audit trail (admin_id, reason, value).
-- Only admins should see who adjusted what and why.
DROP POLICY IF EXISTS "Anyone can read adjustment values" ON public.admin_vote_adjustments;

-- The remaining "Admins can read vote adjustments" policy
-- (USING has_role(auth.uid(), 'admin')) is now the SOLE SELECT gate.
-- Public-facing final vote totals continue to be served via the entry_final_votes
-- view, which aggregates SUM(adjustment_value) without exposing raw audit rows.