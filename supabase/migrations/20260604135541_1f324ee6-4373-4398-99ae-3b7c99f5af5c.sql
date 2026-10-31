-- F1: Revoke EXIF + AI moderation columns from anon and authenticated on competition_entries
REVOKE SELECT (exif_data, ai_detection_result) ON public.competition_entries FROM anon;
REVOKE SELECT (exif_data, ai_detection_result) ON public.competition_entries FROM authenticated;

-- F3: Remove 'needs_review' from the public SELECT policy on competition_entries
DROP POLICY IF EXISTS "Public can view competition entries" ON public.competition_entries;
CREATE POLICY "Public can view competition entries"
  ON public.competition_entries
  FOR SELECT
  TO public
  USING (status IN ('submitted','approved','winner','runner_up','honorary','finalist','shortlisted','qualified'));

-- F4 Option A: Revoke anon access to presence/preference columns on profiles_public_data
REVOKE SELECT (last_active_at, notification_sound_enabled) ON public.profiles_public_data FROM anon;