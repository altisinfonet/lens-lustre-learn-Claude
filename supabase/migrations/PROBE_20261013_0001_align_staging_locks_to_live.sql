-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261013_0001 — staging privileges and three functions aligned with production
-- READ-ONLY (BEGIN READ ONLY … ROLLBACK). Raises, and so fails the dispatch, on
-- any hit. Run on staging after 20261013_0001; a pass means, for every object 20261013_0001
-- touched, staging = production except the six deliberate keeps listed below.
--
--   G1 · 138 tables: each of SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--        TRIGGER/MAINTAIN for anon and authenticated, read with
--        has_table_privilege (effect, not statement success — F-62), equals
--        production's grant; and PUBLIC holds none of them.
--   G2 · 68 functions: EXECUTE for PUBLIC, anon, authenticated and
--        service_role, read with has_function_privilege, equals production's.
--   G3 · 7 views: reloptions equal production's security_invoker text.
--   G4 · custom_url_transliterate / custom_url_slug / generate_custom_url:
--        md5(prosrc), proacl, SECURITY DEFINER, volatility and search_path
--        equal production's.
--   G5 · (NOTICE only) the touched objects' full ACL-set fingerprint, so a
--        reader can see whether anything beyond the asserted privileges moved.
--
-- Deliberate keeps (staging wider than production, by design — see 20261013_0001):
--     competition_entries    anon           SELECT
--     competition_entries    authenticated  SELECT
--     profiles_public_data   anon           SELECT
--     lessons                anon           SELECT
--     lessons                authenticated  SELECT
--     post_media             authenticated  SELECT
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  r          record;
  _p         text;
  _bad       text := '';
  _n         int;
  _fp        text;
  _tables    int := 0;
  _functions int := 0;
  _views     int := 0;
BEGIN
  -- Tables: every privilege of every touched table, for anon and authenticated,
  -- read through has_table_privilege (which also sees PUBLIC and role membership).
  FOR r IN
    SELECT * FROM (VALUES
      ('_v3_quarantine_decisions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('_v3_quarantine_decisions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('_v3_quarantine_tag_assignments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('_v3_quarantine_tag_assignments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('activity_logs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('activity_logs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_conversions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_conversions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creative_comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creative_comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creative_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creative_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creative_shares', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creative_shares', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creatives', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_creatives', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_impressions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ad_impressions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('admin_notifications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('admin_notifications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('admin_vote_adjustments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('admin_vote_adjustments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ai_chat_usage', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ai_chat_usage', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('album_photos', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('album_photos', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('auth_login_attempts', 'anon', ARRAY[]::text[]),
      ('auth_login_attempts', 'authenticated', ARRAY[]::text[]),
      ('badge_definitions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('badge_definitions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('bank_details', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('bank_details', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('blocked_keywords', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('blocked_keywords', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('categories', 'anon', ARRAY['SELECT', 'MAINTAIN']::text[]),
      ('categories', 'authenticated', ARRAY['SELECT', 'MAINTAIN']::text[]),
      ('certificate_testimonials', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('certificate_testimonials', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('certificates', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('certificates', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('chat_questions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('chat_questions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('client_errors', 'anon', ARRAY[]::text[]),
      ('client_errors', 'authenticated', ARRAY[]::text[]),
      ('comment_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('comment_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('comment_reports', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('comment_reports', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_entries', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_entries', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_entry_counts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_entry_counts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_judges', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_judges', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_judging_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_judging_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_orders', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_orders', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_payment_details', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_payment_details', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_round_publish', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_round_publish', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_votes', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competition_votes', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competitions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('competitions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('contributor_engagement_daily', 'anon', ARRAY[]::text[]),
      ('contributor_engagement_daily', 'authenticated', ARRAY[]::text[]),
      ('course_enrollments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('course_enrollments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('course_modules', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('course_modules', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('courses', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('courses', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('custom_url_history', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('custom_url_history', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('db_audit_logs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('db_audit_logs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_send_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_send_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_send_state', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_send_state', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_templates', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_templates', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_unsubscribe_tokens', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('email_unsubscribe_tokens', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('entry_score_cache', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('entry_score_cache', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('faq_entries', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('faq_entries', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('featured_artists', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('featured_artists', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('featured_photos', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('featured_photos', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('feed_events', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('feed_events', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('follows', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('follows', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('friendships', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('friendships', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('gift_announcements', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('gift_announcements', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('gift_credits', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('gift_credits', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('hashtags', 'anon', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[]),
      ('hashtags', 'authenticated', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[]),
      ('held_result_notifications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('held_result_notifications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('hero_banners', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('hero_banners', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('highlight_items', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('highlight_items', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('highlights', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('highlights', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('image_comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('image_comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('image_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('image_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('journal_articles', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('journal_articles', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_activity_logs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_activity_logs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_award_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_award_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_decisions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_decisions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_entry_assignments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_entry_assignments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_entry_locks', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_entry_locks', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_scores', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_scores', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_sessions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_sessions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_tag_assignments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judge_tag_assignments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_preflight_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_preflight_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_rounds', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_rounds', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('judging_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('lesson_progress', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('lesson_progress', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('lessons', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('lessons', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('media_objects', 'anon', ARRAY[]::text[]),
      ('media_objects', 'authenticated', ARRAY[]::text[]),
      ('media_repair_audit', 'anon', ARRAY[]::text[]),
      ('media_repair_audit', 'authenticated', ARRAY[]::text[]),
      ('member_activity_minutes', 'anon', ARRAY[]::text[]),
      ('member_activity_minutes', 'authenticated', ARRAY[]::text[]),
      ('newsletter_subscribers', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('newsletter_subscribers', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('notification_emit_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('notification_emit_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('notification_preferences', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('notification_preferences', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('office_staff', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('office_staff', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('photo_albums', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('photo_albums', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('photo_of_the_day', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('photo_of_the_day', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('portfolio_images', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('portfolio_images', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_comment_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_comment_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_drafts', 'anon', ARRAY[]::text[]),
      ('post_drafts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_hashtags', 'anon', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[]),
      ('post_hashtags', 'authenticated', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[]),
      ('post_media', 'anon', ARRAY[]::text[]),
      ('post_media', 'authenticated', ARRAY['SELECT']::text[]),
      ('post_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_reports', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_reports', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_shares', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_shares', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('post_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('posts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('posts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profile_stats', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profile_stats', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profile_views', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profile_views', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profiles', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profiles', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profiles_public_data', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('profiles_public_data', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('push_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('push_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('push_delivery_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('push_delivery_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('push_tokens', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('push_tokens', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('raw_commitments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('raw_commitments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('referral_codes', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('referral_codes', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('referrals', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('referrals', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('role_applications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('role_applications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('role_display_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('role_display_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('round_snapshots', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('round_snapshots', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('scheduled_boosts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('scheduled_boosts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('scheduled_posts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('scheduled_posts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('search_recents', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('search_recents', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('site_settings', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('site_settings', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('stories', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('stories', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('story_views', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('story_views', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('support_tickets', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('support_tickets', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('suppressed_emails', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('suppressed_emails', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('system_flags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('system_flags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('system_tag_decision_map', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('system_tag_decision_map', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('test_agent_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('test_agent_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('test_agent_runs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('test_agent_runs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ticket_replies', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('ticket_replies', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_badges', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_badges', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_devices', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_devices', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_notifications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_notifications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_roles', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('user_roles', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('v3_mirror_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('v3_mirror_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('v3_stage_catalog', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('v3_stage_catalog', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('v3_tag_label_alias', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('v3_tag_label_alias', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('vote_adjustment_cleanup_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('vote_adjustment_cleanup_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_audit_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_audit_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_idempotency', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_idempotency', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_shadow_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_shadow_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_v2_diff_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_v2_diff_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_v2_rows', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_ledger_v2_rows', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_reconciliation_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_reconciliation_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_transactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallet_transactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallets', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('wallets', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('withdrawal_requests', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[]),
      ('withdrawal_requests', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[])
    ) AS v(tbl, role, keep)
  LOOP
    FOREACH _p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      IF has_table_privilege(r.role, ('public.' || quote_ident(r.tbl))::regclass, _p) IS DISTINCT FROM (_p = ANY (r.keep)) THEN
        _bad := _bad || E'\n  G1 ' || r.tbl || ' ' || r.role || ' ' || _p || ' expected ' || (_p = ANY (r.keep))::text;
      END IF;
      IF has_table_privilege('public', ('public.' || quote_ident(r.tbl))::regclass, _p) THEN
        _bad := _bad || E'\n  G1 ' || r.tbl || ' PUBLIC ' || _p || ' expected false';
      END IF;
    END LOOP;
    _tables := _tables + 1;
  END LOOP;

  -- Functions: EXECUTE for PUBLIC, anon, authenticated and service_role.
  FOR r IN
    SELECT v.*, p.oid AS fn_oid
      FROM (VALUES
      ('admin_delete_auth_user(_uid uuid)', false, false, false, true),
      ('admin_emails_for_user_ids(_ids uuid[])', false, false, false, true),
      ('admin_lookup_user_id_by_email(_email text)', false, false, false, true),
      ('admin_purge_orphan_user_data(_uid uuid)', false, false, false, true),
      ('app_has_role(_user_id uuid, _role text)', false, true, true, true),
      ('cleanup_certificate_references()', false, false, false, true),
      ('contributor_points_since(_since date)', false, false, false, true),
      ('create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)', false, false, false, true),
      ('derive_status_from_stage_key(_stage_key text)', false, true, true, true),
      ('engagement_collector_health()', false, false, false, true),
      ('engagement_probe_report(_days integer)', false, false, false, true),
      ('expire_gift_credit(_gift_id uuid)', false, false, false, true),
      ('feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)', false, false, false, true),
      ('feed_rank_score(_id uuid, _bucket integer, _seed text)', false, false, false, true),
      ('filter_moderated_user_ids(_ids uuid[])', false, true, true, true),
      ('get_ad_engagement(_creative_ids uuid[])', false, false, true, true),
      ('get_app_event_counts_admin(_hours integer)', false, false, true, true),
      ('get_app_events_admin(_hours integer, _code text, _severity text, _limit integer)', false, false, true, true),
      ('get_client_error_stats_admin(_hours integer)', false, false, true, true),
      ('get_course_lessons_for_editor(_course_id uuid)', false, false, true, true),
      ('get_entries_private_meta(_entry_ids uuid[])', false, true, true, true),
      ('get_entry_status_drift_admin()', false, true, true, true),
      ('get_entry_status_drift_summary_admin()', false, true, true, true),
      ('get_gated_status_runtime_drift_admin(p_entry_ids uuid[])', false, true, true, true),
      ('get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer)', false, true, true, true),
      ('get_judging_drift_admin()', false, true, true, true),
      ('get_judging_live_tag_progression_invariant_admin()', false, false, false, true),
      ('get_lesson_content(_lesson_id uuid)', false, true, true, true),
      ('get_my_certificate_entries()', false, false, true, true),
      ('get_per_photo_placement(p_entry_ids uuid[])', false, true, true, true),
      ('get_photo_r4_awards(p_entry_ids uuid[])', false, false, false, true),
      ('get_profile_admin(_id uuid)', false, true, true, true),
      ('get_profile_visible_fields(_target uuid)', false, true, true, true),
      ('get_progression_drift_admin()', false, true, true, true),
      ('get_public_final_votes(_entry_ids uuid[])', false, true, true, true),
      ('get_public_role_user_ids(_role text)', false, true, true, true),
      ('get_public_roles_for_users(_user_ids uuid[])', false, true, true, true),
      ('get_result_visibility_invariant_admin()', false, false, false, true),
      ('get_round_judging_gate_admin(_competition_id uuid, _round_number integer)', false, true, true, true),
      ('get_round_judging_gate_self(_competition_id uuid, _round_number integer)', false, true, true, true),
      ('get_round_pending_entries(p_competition_id uuid, p_round integer)', false, true, true, true),
      ('get_round_summary(p_competition_id uuid, p_round_number integer)', false, true, true, true),
      ('get_status_stage_key_drift_admin()', false, false, false, true),
      ('get_system_tag_catalog_drift()', false, true, true, true),
      ('get_test_agent_health_admin()', false, true, true, true),
      ('get_top_contributors_v3()', false, true, true, true),
      ('get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer)', false, true, true, true),
      ('global_search(term text, section text, username_only boolean)', false, true, true, true),
      ('global_search_hashtags(term text)', false, true, true, true),
      ('increment_managed_page_view(_page_id text)', false, true, true, true),
      ('mark_expiring_post_drafts(_days integer)', false, false, false, true),
      ('media_migration_fence_digest(_fence timestamp with time zone)', false, false, false, true),
      ('media_migration_fence_digest_wide(_fence timestamp with time zone)', false, false, false, true),
      ('media_migration_reconcile()', false, false, false, true),
      ('media_write_path_delta(_since timestamp with time zone)', false, false, false, true),
      ('mirror_system_tag_to_decision()', false, true, true, true),
      ('post_media_for(_post_ids uuid[])', false, true, true, true),
      ('record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text)', false, true, true, true),
      ('search_profiles_admin(q text)', false, true, true, true),
      ('send_notification_email()', false, true, true, true),
      ('soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)', false, false, false, true),
      ('suggest_hashtags(prefix text, max_results integer)', false, false, true, true),
      ('tg_media_state_transition()', false, false, false, true),
      ('tg_post_media_requires_ready()', false, false, false, true),
      ('verify_staff_id(_id_number text)', false, true, true, true),
      ('wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)', false, false, false, true),
      ('wallet_ledger_v2_diff_report(p_window interval)', false, true, true, true),
      ('wallet_ledger_v2_drift_report(p_window interval)', false, true, true, true)
      ) AS v(sig, x_public, x_anon, x_auth, x_service)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.fn_oid IS NULL THEN
      _bad := _bad || E'\n  G2 missing: ' || r.sig;
      CONTINUE;
    END IF;
    IF has_function_privilege('public', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_public
       OR has_function_privilege('anon', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_anon
       OR has_function_privilege('authenticated', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_auth
       OR has_function_privilege('service_role', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_service THEN
      _bad := _bad || E'\n  G2 ' || r.sig || ' expected public/anon/authenticated/service_role = '
                   || r.x_public || '/' || r.x_anon || '/' || r.x_auth || '/' || r.x_service;
    END IF;
    _functions := _functions + 1;
  END LOOP;

  -- Views: security_invoker exactly as production stores it.
  FOR r IN
    SELECT v.*, c.reloptions::text AS got
      FROM (VALUES
      ('entry_final_votes', '{security_invoker=true}'),
      ('entry_final_votes_legacy', '{security_invoker=true}'),
      ('entry_public_status', '{security_invoker=false}'),
      ('judge_tag_assignments_public_r4', '{security_invoker=on}'),
      ('judging_progression_audit', '{security_invoker=true}'),
      ('profiles_public', '{security_invoker=true}'),
      ('v_judging_drift', '{security_invoker=on}')
      ) AS v(vw, want)
      LEFT JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname::text = v.vw AND c.relkind = 'v'
  LOOP
    IF r.got IS DISTINCT FROM r.want THEN
      _bad := _bad || E'\n  G3 ' || r.vw || ' options ' || coalesce(r.got, 'NULL') || ' expected ' || r.want;
    END IF;
    _views := _views + 1;
  END LOOP;

  -- The three handle functions: body hash, ACL and attributes (production's).
  FOR r IN
    SELECT v.*, p.oid AS fn_oid, md5(p.prosrc) AS got_md5, p.proacl::text AS got_acl, p.prosecdef AS got_secdef,
           p.provolatile::text AS got_vol, p.proconfig::text AS got_config
      FROM (VALUES
      ('custom_url_transliterate(_s text)', '62944d4450f685051aa1fed8d466263a', '{postgres=X/postgres,service_role=X/postgres}', true, 's', '{search_path=public}'),
      ('custom_url_slug(_full_name text)', 'd04540ab675e3f229008259d456d9d65', '{postgres=X/postgres,service_role=X/postgres}', true, 's', '{search_path=public}'),
      ('generate_custom_url(_full_name text, _user_id uuid)', '8577b8c55897b064776538d6e638a756', '{postgres=X/postgres,service_role=X/postgres}', true, 'v', '{search_path=public}')
      ) AS v(sig, want_md5, want_acl, want_secdef, want_vol, want_config)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.fn_oid IS NULL OR r.got_md5 IS DISTINCT FROM r.want_md5 OR r.got_acl IS DISTINCT FROM r.want_acl
       OR r.got_secdef IS DISTINCT FROM r.want_secdef OR r.got_vol IS DISTINCT FROM r.want_vol
       OR r.got_config IS DISTINCT FROM r.want_config THEN
      _bad := _bad || E'\n  G4 ' || r.sig || ' body/ACL/attributes differ (md5 ' || coalesce(r.got_md5, 'missing') || ')';
    END IF;
  END LOOP;

  -- G5 (informational)
  WITH _tabs(n) AS (SELECT unnest(ARRAY[
        '_v3_quarantine_decisions',
        '_v3_quarantine_tag_assignments',
        'activity_logs',
        'ad_conversions',
        'ad_creative_comments',
        'ad_creative_reactions',
        'ad_creative_shares',
        'ad_creatives',
        'ad_impressions',
        'admin_notifications',
        'admin_vote_adjustments',
        'ai_chat_usage',
        'album_photos',
        'auth_login_attempts',
        'badge_definitions',
        'bank_details',
        'blocked_keywords',
        'categories',
        'certificate_testimonials',
        'certificates',
        'chat_questions',
        'client_errors',
        'comment_reactions',
        'comment_reports',
        'comments',
        'competition_entries',
        'competition_entry_counts',
        'competition_judges',
        'competition_judging_tags',
        'competition_orders',
        'competition_payment_details',
        'competition_round_publish',
        'competition_votes',
        'competitions',
        'contributor_engagement_daily',
        'course_enrollments',
        'course_modules',
        'courses',
        'custom_url_history',
        'db_audit_logs',
        'email_send_log',
        'email_send_state',
        'email_templates',
        'email_unsubscribe_tokens',
        'entry_score_cache',
        'faq_entries',
        'featured_artists',
        'featured_photos',
        'feed_events',
        'follows',
        'friendships',
        'gift_announcements',
        'gift_credits',
        'hashtags',
        'held_result_notifications',
        'hero_banners',
        'highlight_items',
        'highlights',
        'image_comments',
        'image_reactions',
        'journal_articles',
        'judge_activity_logs',
        'judge_award_tags',
        'judge_comments',
        'judge_decisions',
        'judge_entry_assignments',
        'judge_entry_locks',
        'judge_scores',
        'judge_sessions',
        'judge_tag_assignments',
        'judging_config',
        'judging_preflight_log',
        'judging_rounds',
        'judging_tags',
        'lesson_progress',
        'lessons',
        'media_objects',
        'media_repair_audit',
        'member_activity_minutes',
        'newsletter_subscribers',
        'notification_emit_log',
        'notification_preferences',
        'office_staff',
        'photo_albums',
        'photo_of_the_day',
        'portfolio_images',
        'post_comment_reactions',
        'post_drafts',
        'post_hashtags',
        'post_media',
        'post_reactions',
        'post_reports',
        'post_shares',
        'post_tags',
        'posts',
        'profile_stats',
        'profile_views',
        'profiles',
        'profiles_public_data',
        'push_config',
        'push_delivery_log',
        'push_tokens',
        'raw_commitments',
        'referral_codes',
        'referrals',
        'role_applications',
        'role_display_config',
        'round_snapshots',
        'scheduled_boosts',
        'scheduled_posts',
        'search_recents',
        'site_settings',
        'stories',
        'story_views',
        'support_tickets',
        'suppressed_emails',
        'system_flags',
        'system_tag_decision_map',
        'test_agent_config',
        'test_agent_runs',
        'ticket_replies',
        'user_badges',
        'user_devices',
        'user_notifications',
        'user_roles',
        'v3_mirror_log',
        'v3_stage_catalog',
        'v3_tag_label_alias',
        'vote_adjustment_cleanup_log',
        'wallet_ledger_audit_log',
        'wallet_ledger_idempotency',
        'wallet_ledger_shadow_log',
        'wallet_ledger_v2_diff_log',
        'wallet_ledger_v2_rows',
        'wallet_reconciliation_log',
        'wallet_transactions',
        'wallets',
        'withdrawal_requests'
      ]::text[])),
    _vws(n) AS (SELECT unnest(ARRAY[
        'entry_final_votes',
        'entry_final_votes_legacy',
        'entry_public_status',
        'judge_tag_assignments_public_r4',
        'judging_progression_audit',
        'profiles_public',
        'v_judging_drift'
      ]::text[])),
    _fns(s) AS (SELECT unnest(ARRAY[
        'admin_delete_auth_user(_uid uuid)',
        'admin_emails_for_user_ids(_ids uuid[])',
        'admin_lookup_user_id_by_email(_email text)',
        'admin_purge_orphan_user_data(_uid uuid)',
        'app_has_role(_user_id uuid, _role text)',
        'cleanup_certificate_references()',
        'contributor_points_since(_since date)',
        'create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)',
        'derive_status_from_stage_key(_stage_key text)',
        'engagement_collector_health()',
        'engagement_probe_report(_days integer)',
        'expire_gift_credit(_gift_id uuid)',
        'feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)',
        'feed_rank_score(_id uuid, _bucket integer, _seed text)',
        'filter_moderated_user_ids(_ids uuid[])',
        'get_ad_engagement(_creative_ids uuid[])',
        'get_app_event_counts_admin(_hours integer)',
        'get_app_events_admin(_hours integer, _code text, _severity text, _limit integer)',
        'get_client_error_stats_admin(_hours integer)',
        'get_course_lessons_for_editor(_course_id uuid)',
        'get_entries_private_meta(_entry_ids uuid[])',
        'get_entry_status_drift_admin()',
        'get_entry_status_drift_summary_admin()',
        'get_gated_status_runtime_drift_admin(p_entry_ids uuid[])',
        'get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer)',
        'get_judging_drift_admin()',
        'get_judging_live_tag_progression_invariant_admin()',
        'get_lesson_content(_lesson_id uuid)',
        'get_my_certificate_entries()',
        'get_per_photo_placement(p_entry_ids uuid[])',
        'get_photo_r4_awards(p_entry_ids uuid[])',
        'get_profile_admin(_id uuid)',
        'get_profile_visible_fields(_target uuid)',
        'get_progression_drift_admin()',
        'get_public_final_votes(_entry_ids uuid[])',
        'get_public_role_user_ids(_role text)',
        'get_public_roles_for_users(_user_ids uuid[])',
        'get_result_visibility_invariant_admin()',
        'get_round_judging_gate_admin(_competition_id uuid, _round_number integer)',
        'get_round_judging_gate_self(_competition_id uuid, _round_number integer)',
        'get_round_pending_entries(p_competition_id uuid, p_round integer)',
        'get_round_summary(p_competition_id uuid, p_round_number integer)',
        'get_status_stage_key_drift_admin()',
        'get_system_tag_catalog_drift()',
        'get_test_agent_health_admin()',
        'get_top_contributors_v3()',
        'get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer)',
        'global_search(term text, section text, username_only boolean)',
        'global_search_hashtags(term text)',
        'increment_managed_page_view(_page_id text)',
        'mark_expiring_post_drafts(_days integer)',
        'media_migration_fence_digest(_fence timestamp with time zone)',
        'media_migration_fence_digest_wide(_fence timestamp with time zone)',
        'media_migration_reconcile()',
        'media_write_path_delta(_since timestamp with time zone)',
        'mirror_system_tag_to_decision()',
        'post_media_for(_post_ids uuid[])',
        'record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text)',
        'search_profiles_admin(q text)',
        'send_notification_email()',
        'soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)',
        'suggest_hashtags(prefix text, max_results integer)',
        'tg_media_state_transition()',
        'tg_post_media_requires_ready()',
        'verify_staff_id(_id_number text)',
        'wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)',
        'wallet_ledger_v2_diff_report(p_window interval)',
        'wallet_ledger_v2_drift_report(p_window interval)'
      ]::text[])),
    _defs(s) AS (SELECT unnest(ARRAY[
        'custom_url_transliterate(_s text)',
        'custom_url_slug(_full_name text)',
        'generate_custom_url(_full_name text, _user_id uuid)'
      ]::text[])),
  _lines AS (
      SELECT concat_ws('|', 'T', c.relname::text,
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                       a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
        FROM pg_class c JOIN _tabs ON _tabs.n = c.relname::text, LATERAL aclexplode(c.relacl) a
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      UNION ALL
      SELECT concat_ws('|', 'F', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                       a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text)
        FROM pg_proc p JOIN _fns ON _fns.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             LATERAL aclexplode(p.proacl) a
       WHERE p.pronamespace = 'public'::regnamespace
      UNION ALL
      SELECT concat_ws('|', 'V', c.relname::text, coalesce(c.reloptions::text, ''))
        FROM pg_class c JOIN _vws ON _vws.n = c.relname::text
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
      UNION ALL
      SELECT concat_ws('|', 'S', p.proname::text, md5(p.prosrc))
        FROM pg_proc p JOIN _defs ON _defs.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       WHERE p.pronamespace = 'public'::regnamespace
    )
  SELECT count(*)::int, md5(string_agg(x, E'\n' ORDER BY x COLLATE "C")) FROM _lines INTO _n, _fp;
  RAISE NOTICE 'G5 ACL-set fingerprint: % lines, md5 % (20261013_0001 post-state: 3733, 9d0aa7be29390cec83399062bb593d61) — %',
    _n, _fp, CASE WHEN _n = 3733 AND _fp = '9d0aa7be29390cec83399062bb593d61' THEN 'identical' ELSE 'DIFFERENT: something beyond the asserted privileges changed; read it' END;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261013_0001:%', _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261013_0001: % tables x 2 roles x 8 privileges, % functions x 4 grantees, % views and 3 function bodies equal production (6 deliberate SELECT keeps)',
    _tables / 2, _functions, _views;
END
$probe$;
ROLLBACK;
