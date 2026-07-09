-- =====================================================================
-- F1 — public.competition_entries
-- Block anon SELECT of exif_data, ai_detection_result.
-- =====================================================================
REVOKE SELECT ON public.competition_entries FROM anon;

GRANT SELECT (
  id,
  competition_id,
  user_id,
  title,
  description,
  photos,
  status,
  created_at,
  updated_at,
  placement,
  is_pinned,
  view_count,
  is_trending,
  is_ai_generated,
  current_round,
  certificate_ready,
  photo_thumbnails,
  photo_meta,
  is_ai_advisory,
  progression_decision,
  stage_key,
  public_status_derived,
  public_round_derived,
  public_placement_derived,
  public_progression_note_derived,
  public_r4_tags_derived,
  current_round_int
) ON public.competition_entries TO anon;

-- =====================================================================
-- F4 — public.profiles_public_data (VIEW)
-- Block anon SELECT of last_active_at, notification_sound_enabled.
-- =====================================================================
REVOKE SELECT ON public.profiles_public_data FROM anon;

GRANT SELECT (
  id,
  full_name,
  avatar_url,
  cover_url,
  bio,
  portfolio_url,
  photography_interests,
  facebook_url,
  instagram_url,
  twitter_url,
  youtube_url,
  website_url,
  preferred_language,
  is_suspended,
  created_at,
  updated_at,
  cover_position,
  custom_url,
  pronouns,
  current_city,
  workplace,
  education,
  cover_video_url,
  is_banned
) ON public.profiles_public_data TO anon;