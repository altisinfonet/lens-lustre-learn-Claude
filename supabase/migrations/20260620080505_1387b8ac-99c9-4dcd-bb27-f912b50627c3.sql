-- Option A: tighten competition_entries public SELECT policy to authenticated only.
-- Re-assert anon revoke (no-op today, captured in git for durability).
REVOKE SELECT ON public.competition_entries FROM anon;

-- Replace the unscoped "public" policy with an explicit authenticated-only policy.
DROP POLICY IF EXISTS "Public can view competition entries" ON public.competition_entries;

CREATE POLICY "Authenticated can view public-status entries"
ON public.competition_entries
FOR SELECT
TO authenticated
USING (status = ANY (ARRAY[
  'submitted','approved','winner','runner_up',
  'honorary','finalist','shortlisted','qualified'
]));