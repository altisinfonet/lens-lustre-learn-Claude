-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261013_0001 — align staging privileges and three functions with production
-- Lane: STAGING ONLY. Refuses any other lane.
--
-- Restores staging's exact pre-20261013_0001 state for every object 20261013_0001 touched:
--   * re-GRANTs each privilege 20261013_0001 revoked, to the same role, granted by the
--     same owner (postgres) — nothing else is granted;
--   * RESETs security_invoker on the seven views (staging had no option set);
--   * puts back staging's previous bodies of custom_url_transliterate,
--     custom_url_slug and generate_custom_url verbatim (ACL kept).
-- PROOF OF EXACTNESS: RB-POST-001 recomputes the (object, grantee, privilege,
-- grantor, grant option) set plus view options and body hashes and requires the
-- fingerprint staging had before 20261013_0001 (4752 lines, 2cb0116d0ea8909342522333d9868924).
-- Only the ORDER of entries inside an aclitem[] can differ (a re-granted role
-- is appended); order carries no meaning in PostgreSQL.
--
-- RB-PRE-001 refuses unless the objects are exactly in 20261013_0001's post-state, so
-- this cannot run before 20261013_0001, twice, or over a later change.
--
-- WHEN TO USE IT: only for a caller that 20261013_0001 demonstrably broke. Prefer a
-- small PR that re-grants the ONE privilege that caller needs (with its own
-- evidence) over this file, which re-opens everything 20261013_0001 closed. This file
-- is valid only until the next migration touches any of these objects; after
-- that RB-PRE-001 refuses by design and a targeted re-grant is the only route.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — this file is for STAGING only and p32.lane reads %. '
      'Dispatch apply-migration.yml with target=staging (it sets p32.lane = ''staging'').',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _n  int;
  _fp text;
BEGIN
  -- RB-PRE-001 · the touched objects are exactly in 20261013_0001's post-state.
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
  IF _n <> 3733 OR _fp IS DISTINCT FROM '9d0aa7be29390cec83399062bb593d61' THEN
    RAISE EXCEPTION 'ALIGN-0001-RB-PRE-001: the objects are not in 20261013_0001''s post-state (not applied, already rolled back, or changed since) — refusing (read % lines, md5 %; expected 3733, 9d0aa7be29390cec83399062bb593d61)', _n, _fp
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Every touched object is owned by the role running this file, so each
  -- REVOKE / GRANT acts as the owner and is recorded with grantor = owner.
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
      ]::text[]))
  SELECT count(*) INTO _n FROM (
    SELECT c.relowner AS o FROM pg_class c JOIN _tabs ON _tabs.n = c.relname::text WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    UNION ALL SELECT c.relowner FROM pg_class c JOIN _vws ON _vws.n = c.relname::text WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
    UNION ALL SELECT p.proowner FROM pg_proc p JOIN _fns ON _fns.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' WHERE p.pronamespace = 'public'::regnamespace
    UNION ALL SELECT p.proowner FROM pg_proc p JOIN _defs ON _defs.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' WHERE p.pronamespace = 'public'::regnamespace
  ) o WHERE o.o <> current_user::regrole;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ALIGN-0001-RB-PRE-002: % touched object(s) are not owned by % — a REVOKE would not act as the owner', _n, current_user
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. table privileges, granted back ──────────────────────────────────────
-- 127 table(s)
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public._v3_quarantine_decisions,
  public._v3_quarantine_tag_assignments,
  public.activity_logs,
  public.ad_conversions,
  public.ad_creative_comments,
  public.ad_creative_reactions,
  public.ad_creative_shares,
  public.ad_creatives,
  public.ad_impressions,
  public.admin_notifications,
  public.admin_vote_adjustments,
  public.ai_chat_usage,
  public.album_photos,
  public.badge_definitions,
  public.bank_details,
  public.blocked_keywords,
  public.certificate_testimonials,
  public.certificates,
  public.chat_questions,
  public.comment_reactions,
  public.comment_reports,
  public.comments,
  public.competition_entries,
  public.competition_entry_counts,
  public.competition_judges,
  public.competition_judging_tags,
  public.competition_orders,
  public.competition_payment_details,
  public.competition_round_publish,
  public.competition_votes,
  public.competitions,
  public.course_enrollments,
  public.course_modules,
  public.courses,
  public.custom_url_history,
  public.db_audit_logs,
  public.email_send_log,
  public.email_send_state,
  public.email_templates,
  public.email_unsubscribe_tokens,
  public.entry_score_cache,
  public.faq_entries,
  public.featured_artists,
  public.featured_photos,
  public.feed_events,
  public.follows,
  public.friendships,
  public.gift_announcements,
  public.gift_credits,
  public.held_result_notifications,
  public.hero_banners,
  public.highlight_items,
  public.highlights,
  public.image_comments,
  public.image_reactions,
  public.journal_articles,
  public.judge_activity_logs,
  public.judge_award_tags,
  public.judge_comments,
  public.judge_decisions,
  public.judge_entry_assignments,
  public.judge_entry_locks,
  public.judge_scores,
  public.judge_sessions,
  public.judge_tag_assignments,
  public.judging_config,
  public.judging_preflight_log,
  public.judging_rounds,
  public.judging_tags,
  public.lesson_progress,
  public.lessons,
  public.newsletter_subscribers,
  public.notification_emit_log,
  public.notification_preferences,
  public.office_staff,
  public.photo_albums,
  public.photo_of_the_day,
  public.portfolio_images,
  public.post_comment_reactions,
  public.post_reactions,
  public.post_reports,
  public.post_shares,
  public.post_tags,
  public.posts,
  public.profile_stats,
  public.profile_views,
  public.profiles,
  public.profiles_public_data,
  public.push_config,
  public.push_delivery_log,
  public.push_tokens,
  public.raw_commitments,
  public.referral_codes,
  public.referrals,
  public.role_applications,
  public.role_display_config,
  public.round_snapshots,
  public.scheduled_boosts,
  public.scheduled_posts,
  public.search_recents,
  public.site_settings,
  public.stories,
  public.story_views,
  public.support_tickets,
  public.suppressed_emails,
  public.system_flags,
  public.system_tag_decision_map,
  public.test_agent_config,
  public.test_agent_runs,
  public.ticket_replies,
  public.user_badges,
  public.user_devices,
  public.user_notifications,
  public.user_roles,
  public.v3_mirror_log,
  public.v3_stage_catalog,
  public.v3_tag_label_alias,
  public.vote_adjustment_cleanup_log,
  public.wallet_ledger_audit_log,
  public.wallet_ledger_idempotency,
  public.wallet_ledger_shadow_log,
  public.wallet_ledger_v2_diff_log,
  public.wallet_ledger_v2_rows,
  public.wallet_reconciliation_log,
  public.wallet_transactions,
  public.wallets,
  public.withdrawal_requests
TO anon, authenticated;

-- 6 table(s)
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.auth_login_attempts,
  public.client_errors,
  public.contributor_engagement_daily,
  public.media_objects,
  public.media_repair_audit,
  public.member_activity_minutes
TO anon, authenticated;

-- 2 table(s)
GRANT INSERT, UPDATE, DELETE ON TABLE
  public.hashtags,
  public.post_hashtags
TO anon, authenticated;

-- 2 table(s)
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.post_drafts,
  public.post_media
TO anon;

-- 1 table(s)
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.categories
TO anon, authenticated;

-- 1 table(s)
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.post_drafts
TO authenticated;

-- 1 table(s)
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.post_media
TO authenticated;

-- ── 2. function EXECUTE, granted back ──────────────────────────────────────
-- 36 function(s)
GRANT EXECUTE ON FUNCTION
  public.app_has_role(_user_id uuid, _role text),
  public.derive_status_from_stage_key(_stage_key text),
  public.filter_moderated_user_ids(_ids uuid[]),
  public.get_entries_private_meta(_entry_ids uuid[]),
  public.get_entry_status_drift_admin(),
  public.get_entry_status_drift_summary_admin(),
  public.get_gated_status_runtime_drift_admin(p_entry_ids uuid[]),
  public.get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer),
  public.get_judging_drift_admin(),
  public.get_lesson_content(_lesson_id uuid),
  public.get_per_photo_placement(p_entry_ids uuid[]),
  public.get_profile_admin(_id uuid),
  public.get_profile_visible_fields(_target uuid),
  public.get_progression_drift_admin(),
  public.get_public_final_votes(_entry_ids uuid[]),
  public.get_public_role_user_ids(_role text),
  public.get_public_roles_for_users(_user_ids uuid[]),
  public.get_round_judging_gate_admin(_competition_id uuid, _round_number integer),
  public.get_round_judging_gate_self(_competition_id uuid, _round_number integer),
  public.get_round_pending_entries(p_competition_id uuid, p_round integer),
  public.get_round_summary(p_competition_id uuid, p_round_number integer),
  public.get_system_tag_catalog_drift(),
  public.get_test_agent_health_admin(),
  public.get_top_contributors_v3(),
  public.get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer),
  public.global_search(term text, section text, username_only boolean),
  public.global_search_hashtags(term text),
  public.increment_managed_page_view(_page_id text),
  public.mirror_system_tag_to_decision(),
  public.post_media_for(_post_ids uuid[]),
  public.record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text),
  public.search_profiles_admin(q text),
  public.send_notification_email(),
  public.verify_staff_id(_id_number text),
  public.wallet_ledger_v2_diff_report(p_window interval),
  public.wallet_ledger_v2_drift_report(p_window interval)
TO PUBLIC;

-- 18 function(s)
GRANT EXECUTE ON FUNCTION
  public.admin_emails_for_user_ids(_ids uuid[]),
  public.admin_lookup_user_id_by_email(_email text),
  public.cleanup_certificate_references(),
  public.contributor_points_since(_since date),
  public.engagement_collector_health(),
  public.engagement_probe_report(_days integer),
  public.feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer),
  public.feed_rank_score(_id uuid, _bucket integer, _seed text),
  public.get_judging_live_tag_progression_invariant_admin(),
  public.get_photo_r4_awards(p_entry_ids uuid[]),
  public.get_result_visibility_invariant_admin(),
  public.get_status_stage_key_drift_admin(),
  public.media_migration_fence_digest(_fence timestamp with time zone),
  public.media_migration_fence_digest_wide(_fence timestamp with time zone),
  public.media_migration_reconcile(),
  public.media_write_path_delta(_since timestamp with time zone),
  public.tg_media_state_transition(),
  public.tg_post_media_requires_ready()
TO PUBLIC, anon, authenticated;

-- 7 function(s)
GRANT EXECUTE ON FUNCTION
  public.admin_delete_auth_user(_uid uuid),
  public.admin_purge_orphan_user_data(_uid uuid),
  public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text),
  public.expire_gift_credit(_gift_id uuid),
  public.mark_expiring_post_drafts(_days integer),
  public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid),
  public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)
TO authenticated;

-- 7 function(s)
GRANT EXECUTE ON FUNCTION
  public.get_ad_engagement(_creative_ids uuid[]),
  public.get_app_event_counts_admin(_hours integer),
  public.get_app_events_admin(_hours integer, _code text, _severity text, _limit integer),
  public.get_client_error_stats_admin(_hours integer),
  public.get_course_lessons_for_editor(_course_id uuid),
  public.get_my_certificate_entries(),
  public.suggest_hashtags(prefix text, max_results integer)
TO PUBLIC, anon;

-- ── 3. views: staging had no security_invoker option ───────────────────────
ALTER VIEW public.entry_final_votes RESET (security_invoker);
ALTER VIEW public.entry_final_votes_legacy RESET (security_invoker);
ALTER VIEW public.entry_public_status RESET (security_invoker);
ALTER VIEW public.judge_tag_assignments_public_r4 RESET (security_invoker);
ALTER VIEW public.judging_progression_audit RESET (security_invoker);
ALTER VIEW public.profiles_public RESET (security_invoker);
ALTER VIEW public.v_judging_drift RESET (security_invoker);

-- ── 4. the three handle functions: staging's previous definitions ──────────
CREATE OR REPLACE FUNCTION public.custom_url_transliterate(_s text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _out     text := '';
  _i       int;
  _ch      text;
  _m       record;
  _pending boolean := false;
  _schwa   boolean := false;
  _prev_virama boolean := false;
  _in_conjunct boolean := false;
BEGIN
  IF _s IS NULL OR _s = '' THEN RETURN ''; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.transliteration_map m
     WHERE m.script IN ('bengali','devanagari','gujarati')
       AND position(m.ch in _s) > 0
  ) INTO _schwa;

  FOR _i IN 1..length(_s) LOOP
    _ch := substr(_s, _i, 1);
    SELECT latin, kind INTO _m FROM public.transliteration_map WHERE ch = _ch;

    IF _m.kind IS NULL THEN
      IF _pending THEN
        IF _schwa AND _ch ~ '[^[:alnum:]]' AND NOT _in_conjunct THEN
          _pending := false;
        ELSE
          _out := _out || 'a'; _pending := false;
        END IF;
      END IF;
      _out := _out || _ch;
      _prev_virama := false; _in_conjunct := false;

    ELSIF _m.kind = 'consonant' THEN
      IF _pending THEN _out := _out || 'a'; END IF;
      _out := _out || _m.latin;
      _pending := true;
      _in_conjunct := _prev_virama;
      _prev_virama := false;

    ELSIF _m.kind = 'matra' THEN
      _pending := false;
      _out := _out || _m.latin;
      _prev_virama := false; _in_conjunct := false;

    ELSIF _m.kind = 'virama' THEN
      _pending := false;
      _prev_virama := true;

    ELSE
      IF _pending THEN _out := _out || 'a'; _pending := false; END IF;
      _out := _out || _m.latin;
      _prev_virama := false; _in_conjunct := false;
    END IF;
  END LOOP;

  IF _pending AND (NOT _schwa OR _in_conjunct) THEN _out := _out || 'a'; END IF;

  RETURN _out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_url_slug(_full_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parts text[];
  _clean text[] := '{}';
  _p     text;
  _key   text;
  _conv  text;
  _stem  text;
BEGIN
  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RETURN NULL;
  END IF;

  _parts := regexp_split_to_array(btrim(_full_name), '\s+');

  FOREACH _p IN ARRAY coalesce(_parts, '{}') LOOP
    _key := btrim(lower(_p), ' .,;:!?"''()[]{}<>');

    SELECT latin INTO _conv FROM public.name_part_spellings WHERE part = _key;

    IF _conv IS NOT NULL THEN
      _p := _conv;
    ELSE
      _p := public.custom_url_fold_accents(
              public.custom_url_transliterate(lower(_p)));
      _p := regexp_replace(_p, '[^a-z0-9]', '', 'g');
    END IF;

    IF _p <> '' THEN _clean := _clean || _p; END IF;
  END LOOP;

  IF array_length(_clean, 1) IS NULL THEN
    RETURN NULL;
  ELSIF array_length(_clean, 1) = 1 THEN
    _stem := _clean[1];
  ELSE
    _stem := _clean[1] || '.' || _clean[array_length(_clean, 1)];
  END IF;

  _stem := left(_stem, 30);
  _stem := regexp_replace(_stem, '[._]+$', '');
  _stem := regexp_replace(_stem, '^[.]+', '');

  IF length(_stem) < 3 THEN
    RETURN NULL;
  END IF;

  RETURN _stem;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_custom_url(_full_name text, _user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _stem      text;
  _candidate text;
  _suffix    text;
  _n         int := 2;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'generate_custom_url requires a user id: it is needed both for the fallback value and to let a member keep a URL they already hold';
  END IF;

  _stem := public.custom_url_slug(_full_name);

  IF _stem IS NULL THEN
    _stem := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  END IF;

  IF public.custom_url_available(_stem, _user_id) THEN
    RETURN _stem;
  END IF;

  WHILE _n < 1000 LOOP
    _suffix    := _n::text;
    _candidate := regexp_replace(left(_stem, 30 - length(_suffix)), '[._]+$', '') || _suffix;
    IF public.custom_url_available(_candidate, _user_id) THEN
      RETURN _candidate;
    END IF;
    _n := _n + 1;
  END LOOP;

  _candidate := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  IF public.custom_url_available(_candidate, _user_id) THEN
    RETURN _candidate;
  END IF;

  RAISE EXCEPTION 'generate_custom_url could not find a free URL for % (stem %)', _user_id, _stem;
END;
$function$;

DO $postconditions$
DECLARE
  r    record;
  _bad text := '';
  _n   int;
  _fp  text;
BEGIN
  -- RB-POST-001 · every touched object holds exactly its pre-20261013_0001 grants, options and bodies.
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
  IF _n <> 4752 OR _fp IS DISTINCT FROM '2cb0116d0ea8909342522333d9868924' THEN
    RAISE EXCEPTION 'ALIGN-0001-RB-POST-001: the restored state is not staging''s pre-20261013_0001 state (read % lines, md5 %; expected 4752, 2cb0116d0ea8909342522333d9868924)', _n, _fp
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The three handle functions: body hash, ACL and attributes (staging's previous).
  FOR r IN
    SELECT v.*, p.oid AS fn_oid, md5(p.prosrc) AS got_md5, p.proacl::text AS got_acl, p.prosecdef AS got_secdef,
           p.provolatile::text AS got_vol, p.proconfig::text AS got_config
      FROM (VALUES
      ('custom_url_transliterate(_s text)', '9e2023ec0c89c78b8025e449a3ea33de', '{postgres=X/postgres,service_role=X/postgres}', true, 's', '{search_path=public}'),
      ('custom_url_slug(_full_name text)', '1d90e947c4601a5343b296c24f26456e', '{postgres=X/postgres,service_role=X/postgres}', true, 's', '{search_path=public}'),
      ('generate_custom_url(_full_name text, _user_id uuid)', 'ac7795f596d061728f612e553bfbd614', '{postgres=X/postgres,service_role=X/postgres}', true, 'v', '{search_path=public}')
      ) AS v(sig, want_md5, want_acl, want_secdef, want_vol, want_config)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.fn_oid IS NULL OR r.got_md5 IS DISTINCT FROM r.want_md5 OR r.got_acl IS DISTINCT FROM r.want_acl
       OR r.got_secdef IS DISTINCT FROM r.want_secdef OR r.got_vol IS DISTINCT FROM r.want_vol
       OR r.got_config IS DISTINCT FROM r.want_config THEN
      _bad := _bad || E'\n  RB-POST-002 S ' || r.sig || ' body/ACL/attributes differ (md5 ' || coalesce(r.got_md5, 'missing') || ')';
    END IF;
  END LOOP;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'ALIGN-0001-RB-POST:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'ALIGN-0001 ROLLBACK: staging restored to its pre-20261013_0001 grants, view options and function bodies';
END
$postconditions$;

COMMIT;
