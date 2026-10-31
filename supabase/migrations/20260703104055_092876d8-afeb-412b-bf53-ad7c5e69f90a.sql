-- F-04: Prevent EXIF + AI detection leak to authenticated users
-- Revoke direct column reads; provide gated SECURITY DEFINER accessor.

REVOKE SELECT (exif_data, ai_detection_result)
  ON public.competition_entries FROM authenticated;
REVOKE SELECT (exif_data, ai_detection_result)
  ON public.competition_entries FROM anon;
GRANT SELECT (exif_data, ai_detection_result)
  ON public.competition_entries TO service_role;

CREATE OR REPLACE FUNCTION public.get_entries_private_meta(_entry_ids uuid[])
RETURNS TABLE(entry_id uuid, exif_data jsonb, ai_detection_result jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ce.id, ce.exif_data, ce.ai_detection_result
  FROM public.competition_entries ce
  WHERE ce.id = ANY(_entry_ids)
    AND (
      ce.user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR (
        public.has_role(auth.uid(), 'judge'::app_role)
        AND public.judge_can_access_entry(auth.uid(), ce.id)
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_entries_private_meta(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_entries_private_meta(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_entries_private_meta(uuid[]) TO service_role;