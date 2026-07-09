-- Admin-only RPC: per-tag assignment counts for the Tag Semantics audit page.
-- SECURITY DEFINER + has_role(admin) gate so RLS on judge_tag_assignments
-- doesn't block the aggregate read for legitimate admins, while non-admins
-- get a hard PERMISSION_DENIED.

CREATE OR REPLACE FUNCTION public.get_judging_tag_assignment_counts()
RETURNS TABLE (
  tag_id uuid,
  assignment_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admin gate (uses existing has_role helper + app_role enum)
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id AS tag_id,
    COALESCE(COUNT(jta.id), 0)::bigint AS assignment_count
  FROM public.judging_tags t
  LEFT JOIN public.judge_tag_assignments jta ON jta.tag_id = t.id
  GROUP BY t.id;
END;
$$;

-- Lock down execution: only authenticated users can attempt; the function
-- itself enforces the admin check above.
REVOKE ALL ON FUNCTION public.get_judging_tag_assignment_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_judging_tag_assignment_counts() TO authenticated;