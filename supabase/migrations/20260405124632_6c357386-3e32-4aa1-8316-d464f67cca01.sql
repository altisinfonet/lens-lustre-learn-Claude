
-- Revoke direct API access to materialized view
REVOKE SELECT ON public.entry_vote_counts FROM anon, authenticated;

-- Create a secure function to access vote counts
CREATE OR REPLACE FUNCTION public.get_entry_vote_counts(_entry_ids uuid[])
RETURNS TABLE(entry_id uuid, real_votes int, adjustment_votes int, final_votes int)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT evc.entry_id, evc.real_votes, evc.adjustment_votes, evc.final_votes
  FROM public.entry_vote_counts evc
  WHERE evc.entry_id = ANY(_entry_ids);
$$;
