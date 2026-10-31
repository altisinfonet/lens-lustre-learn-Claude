-- PROBE (read-only) · S8 / F-P7-1 + gate "0 missing migrations" —
-- which live public functions does NO migration in git create?
--
-- The name list below is every function name created by a non-PROBE,
-- non-UNAPPLIED file in supabase/migrations/ at the commit that added this
-- file (regex over CREATE [OR REPLACE] FUNCTION; 437 names; overloads
-- collapse to one name). Regenerate it if migrations change before you run it.
-- Prints function NAMES and flags only — never a body (a body may hold a
-- literal credential). Extension-owned functions are excluded.
-- Result: a list of out-of-git functions. P7 measured 24 on staging
-- (2026-10-04). OVERALL PASS = 0 rows listed.
BEGIN READ ONLY;

WITH git(name) AS (
  SELECT unnest(ARRAY[
    '_diag_emit_test', '_ensure_stats_row', '_gen_competition_order_no', '_notification_template_for_entry', '_p32r_probe', '_phase4_validate',
    '_resolve_stage_key_from_entry', '_set_competition_orders_updated_at', '_tg_entry_public_status_recompute', '_tg_round_publish_recompute', '_tg_v3_catalog_recompute', 'account_is_live',
    'acquire_judge_lock', 'ad_creatives_touch_updated_at', 'admin_delete_auth_user', 'admin_emails_for_user_ids', 'admin_flag_entry_for_review', 'admin_lookup_user_id_by_email',
    'admin_purge_orphan_user_data', 'admin_reject_wallet_transaction', 'admin_rewind_stage', 'admin_search_users', 'admin_set_photo_rejected', 'admin_wallet_credit',
    'any_photo_pending', 'applies', 'apply_decision_to_remaining', 'approve_deposit', 'are_friends', 'audit_nr_drift_at_r2_plus',
    'audit_phase_parity', 'audit_sensitive_table', 'audit_site_settings_table', 'auto_certificate_on_r4_award', 'auto_certificate_on_winner', 'auto_create_judging_rounds',
    'auto_promote_chat_to_faq', 'auto_subscribe_newsletter', 'auto_tier_judge_decision', 'backfill_judging_notifications', 'backfill_last_seen', 'backfill_stuck_verifications',
    'backfill_tag_decision_drift_admin', 'block_friend_requests_to_admins', 'can_view_post', 'change_custom_url', 'check_custom_urls_taken', 'check_friend_limit',
    'claim_username', 'classify_judging_tag', 'clear_custom_url', 'compute_entry_rank_score', 'contributor_points_since', 'create_pending_deposit',
    'create_system_post', 'cron_http_call', 'current_phase', 'current_phase_for', 'current_round_int', 'custom_url_available',
    'custom_url_ever_held', 'custom_url_fold_accents', 'custom_url_slug', 'custom_url_transliterate', 'delete_email', 'derive_decision_from_score',
    'derive_status_from_stage_key', 'detect_duplicate_post', 'drain_post_jobs', 'email_exists', 'email_queue_has_work', 'email_queue_tick',
    'email_queue_wake', 'email_queue_wake_trg', 'emit_birthday_notifications', 'emit_notification', 'enforce_admin_brand_name', 'enforce_ai_image_policy',
    'enforce_entry_fee', 'enforce_max_entries_per_user', 'enforce_non_system_tags_round4', 'enforce_photo_limit', 'enforce_post_caption_only_update', 'enforce_post_categories',
    'enforce_post_draft_rules', 'enforce_progression_decision_pending_gate', 'enforce_progression_decision_vocabulary', 'enforce_round_lock', 'enforce_status_round_consistency', 'engagement_collector_health',
    'engagement_probe_report', 'enqueue_email', 'enroll_in_course', 'ensure_member_always_has_picture', 'expiring_post_drafts', 'extract_hashtags',
    'extract_photo_hashes', 'fan_out_new_post', 'feature_add_member', 'feature_admin_state', 'feature_allowed', 'feature_allowed_me',
    'feature_member_search', 'feature_remove_member', 'feature_set_mode', 'feed_author_timeline', 'feed_candidates', 'feed_favourite_authors_before',
    'feed_hidden_posts_before', 'feed_mix_admin_stats', 'feed_mix_set', 'feed_rank_score', 'feed_score_decayed', 'feed_scores_refresh',
    'feed_signal_events_before', 'feed_signal_events_fold', 'fix_certificate_readiness_admin', 'fix_gift_drift_admin', 'fix_referral_drift_admin', 'flag_ad_comment_for_review',
    'forbid_custom_url_change', 'format_person_name', 'friend_count', 'generate_certificate_identifiers', 'generate_competition_slug', 'generate_custom_url',
    'get_ad_analytics', 'get_ad_autoscale_stats', 'get_ad_engagement', 'get_app_event_counts_admin', 'get_app_events_admin', 'get_broadcast_feed',
    'get_certificate_drift_admin', 'get_certificate_readiness_drift_admin', 'get_client_error_stats_admin', 'get_competition_duplicate_clusters', 'get_competition_raw_commitments', 'get_contributor_scores',
    'get_derived_status_drift_admin', 'get_entries_private_meta', 'get_entry_status_drift_admin', 'get_entry_status_drift_summary_admin', 'get_entry_vote_counts', 'get_favourites_feed',
    'get_feed_candidates', 'get_feed_stories_bar', 'get_flag', 'get_following_feed', 'get_gated_entry_status', 'get_gated_status_runtime_drift_admin',
    'get_gift_drift_admin', 'get_judge_collusion_admin', 'get_judge_entries_page', 'get_judge_entries_page_filtered', 'get_judge_entries_page_v1', 'get_judging_drift_admin',
    'get_judging_live_tag_progression_invariant_admin', 'get_judging_tag_assignment_counts', 'get_my_notifications_grouped', 'get_my_story_view_counts', 'get_my_unread_notifications_grouped', 'get_needs_review_recipients_for_round',
    'get_notification_drift_admin', 'get_notification_email_enabled', 'get_notification_health_stats_admin', 'get_per_photo_consensus', 'get_per_photo_placement', 'get_personal_feed',
    'get_photo_r4_awards', 'get_placement_drift_admin', 'get_post_view_counts', 'get_primary_admin_user_id', 'get_profile_admin', 'get_progression_drift',
    'get_progression_drift_admin', 'get_public_role_user_ids', 'get_public_roles_for_users', 'get_public_round_scores', 'get_push_health', 'get_referral_drift_admin',
    'get_result_visibility_invariant_admin', 'get_round_eligible_photos', 'get_round_judging_gate_admin', 'get_round_judging_gate_self', 'get_round_pending_entries', 'get_round_summary',
    'get_status_stage_key_drift_admin', 'get_stuck_verifications_admin', 'get_system_tag_catalog_drift', 'get_test_agent_health_admin', 'get_todays_birthdays', 'get_top_contributors_v1',
    'get_top_contributors_v2', 'get_top_contributors_v3', 'get_unjudged_parity_admin', 'global_search', 'global_search_hashtags', 'grants',
    'guard_needs_review_round1_only', 'guard_stage_key_immutability', 'handle_first_admin', 'handle_new_user', 'has_profile_photo', 'has_role',
    'heartbeat_judge_lock', 'hex_hamming_distance', 'is_banned', 'is_engagement_phase_locked', 'is_entry_owner', 'is_qualifying_decision',
    'is_s3_storage_enabled', 'is_vote_phase_locked', 'judge_can_access_entry', 'judge_round_open_by_id', 'judge_round_open_by_number', 'judging_invariants_check',
    'judging_write_decision_atomic', 'list_tag_decision_drift_admin', 'log_app_event', 'log_client_error', 'log_push_outcome', 'log_raw_commitments',
    'mark_expiring_post_drafts', 'media_begin_upload', 'media_mark_ready', 'media_mark_verified', 'media_migrate_post', 'media_migration_fence_digest',
    'media_migration_fence_digest_wide', 'media_migration_reconcile', 'media_quarantine', 'media_write_path_delta', 'mirror_system_tag_to_decision', 'moderate_post_content',
    'move_to_dlq', 'music_check_due', 'music_check_key_configured', 'music_check_overdue', 'music_check_record_result', 'music_check_retry_after',
    'music_library_add', 'music_library_set_active', 'music_library_set_fingerprints', 'mutual_friend_ids', 'mutual_friends_count', 'normalize_current_round',
    'normalize_hashtag', 'notif_action_phrase', 'notif_display_name', 'notif_group_key', 'notif_push_body', 'notify_ad_comment_reply',
    'notify_admin_comment_report', 'notify_admin_new_ticket', 'notify_admin_post_report', 'notify_admin_role_application', 'notify_admin_user_blocked', 'notify_badge_awarded',
    'notify_certificate_issued', 'notify_competition_vote', 'notify_course_published', 'notify_entry_status_change', 'notify_featured_artist', 'notify_friend_request_accepted',
    'notify_friend_request_received', 'notify_image_comment', 'notify_image_reaction', 'notify_journal_published', 'notify_new_competition', 'notify_new_follower',
    'notify_post_comment', 'notify_post_reaction', 'notify_post_tag', 'notify_potd_featured', 'notify_role_application_decision', 'notify_round_published',
    'notify_round_published_insert', 'notify_user_ticket_reply', 'notify_verification_decided', 'notify_verification_request_created', 'notify_verification_request_submitted', 'owns_album',
    'pg_temp', 'pj_handle_comment_notification', 'pj_handle_reaction_notification', 'post_attach_media', 'post_media_for', 'post_publish_with_media',
    'prevent_direct_custom_url_update', 'prevent_self_vote', 'process_referral_reward', 'progression_order', 'protect_admin_full_name', 'protect_system_tags',
    'protect_system_tags_fn', 'prune_activity_minutes', 'prune_client_errors', 'prune_old_notifications', 'publish_post_draft', 'publish_scheduled_posts_tick',
    'purge_feed_signals', 'purge_user_block_notices', 'push_on_notification', 'rate_limit_comments', 'rate_limit_competition_entry', 'rate_limit_competition_votes',
    'rate_limit_feed_events', 'rate_limit_image_comments', 'rate_limit_judge_scores', 'rate_limit_newsletter_subscribe', 'rate_limit_post_comments', 'rate_limit_post_reactions',
    'rate_limit_posts', 'read_email_batch', 'reap_post_drafts', 'recompute_entry_from_tag_assignments', 'recompute_entry_public_status', 'record_activity_minute',
    'record_session_end', 'record_test_agent_run', 'recount_hashtags', 'refresh_score_cache', 'refresh_viewer_buckets', 'register_push_token',
    'release_judge_lock', 'request_withdrawal', 'resolve_custom_url', 'rollup_engagement_daily', 'scheduled_posts_due', 'search_certificates',
    'search_profiles_admin', 'seed_round_publish_rows', 'send_notification_email', 'set_ad_comment_updated_at', 'set_post_tags_updated_at', 'set_updated_at_column',
    'set_write_path', 'should_test_agent_run', 'soft_void_wallet_transactions', 'submit_competition_entry', 'suggest_hashtags', 'suggest_username',
    'sync_competition_result_state_from_round_publish', 'sync_entry_status_from_decision', 'sync_fallback_avatar_to_gender', 'sync_oauth_on_login', 'sync_post_hashtags', 'sync_profiles_public_data',
    'sync_system_tag_decision_map_from_catalog', 'tag_label_to_decision', 'tg_ad_videos_link_guard', 'tg_custom_url_reject_reserved', 'tg_feature_audit_append_only', 'tg_feed_events_viewer_count',
    'tg_media_state_transition', 'tg_music_library_audit_append_only', 'tg_one_judge_per_competition', 'tg_post_media_requires_ready', 'tg_post_videos_link_guard', 'tg_posts_video_keeps_categories',
    'tg_profiles_assign_custom_url', 'tg_profiles_normalise_name', 'tg_profiles_record_custom_url_history', 'tg_user_roles_no_converter', 'tg_v3_stage_catalog_touch', 'tg_video_music_checks_append_only',
    'tg_video_source_events_append_only', 'tg_video_sources_owner_gone', 'tg_video_sources_touch', 'tg_video_versions_guard', 'tg_videos_insert_guard', 'tg_videos_state_guard',
    'throttle_competition_entry_inserts', 'touch_round_publish_updated', 'trg_entry_status_lifecycle_emit', 'trg_follows_counts', 'trg_friendships_counts', 'trg_recompute_entry_after_tag_change',
    'trg_recompute_entry_public_status', 'trg_recompute_publish_fanout', 'unregister_push_token', 'unsync_post_hashtags', 'update_post_comments_count', 'update_post_likes_count',
    'update_post_shares_count', 'username_available', 'validate_competition_entry_ai_advisory', 'validate_competition_entry_photo_meta', 'validate_competition_entry_status_transition', 'validate_feed_event_author',
    'validate_judge_criteria_scores', 'validate_judge_score_range', 'validate_post_tag_insert', 'validate_post_tag_update', 'validate_profile_full_name', 'validate_scheduled_post_window',
    'verify_certificate', 'verify_certificate_by_token', 'video_attest_lane', 'video_attest_verify', 'video_begin_upload', 'video_converter_acting',
    'video_converter_begin_version', 'video_converter_health', 'video_converter_version', 'video_day_count', 'video_delete', 'video_housekeeping',
    'video_is_converter', 'video_mark_uploaded', 'video_new_version', 'video_open_count', 'video_owner_may', 'video_publish_own_post_has_media',
    'video_publish_post', 'video_source_begin', 'video_source_cancel', 'video_source_claim', 'video_source_done', 'video_source_drop_video',
    'video_source_expire', 'video_source_fail', 'video_source_heartbeat', 'video_source_held', 'video_source_housekeeping', 'video_source_log',
    'video_source_reason_text', 'video_source_unposted_cleanup', 'video_source_uploaded', 'video_upload_info', 'video_validate_version', 'video_visible',
    'wallet_ledger_apply_v2', 'wallet_ledger_v2_diff_report', 'wallet_ledger_v2_diff_snapshot', 'wallet_ledger_v2_drift_report', 'wallet_transaction'
  ]::text[])
), live AS (
  SELECT p.proname, p.oid, p.prosecdef, p.provolatile,
         pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
), missing AS (
  SELECT l.* FROM live l WHERE lower(l.proname) NOT IN (SELECT name FROM git)
)
SELECT proname || '(' || args || ')' AS function_not_in_git,
       CASE WHEN prosecdef THEN 'DEFINER' ELSE 'invoker' END AS security,
       provolatile::text AS volatility,
       has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec
  FROM missing
UNION ALL
SELECT 'OVERALL ' || CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END || ' — ' || count(*) || ' live public function(s) in no migration',
       '', '', NULL FROM missing
ORDER BY 1;

ROLLBACK;
