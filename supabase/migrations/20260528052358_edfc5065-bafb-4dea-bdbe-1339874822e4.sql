REVOKE SELECT (ai_detection_result, exif_data) ON public.competition_entries FROM anon;
REVOKE SELECT (ai_detection_result, exif_data) ON public.competition_entries FROM authenticated;