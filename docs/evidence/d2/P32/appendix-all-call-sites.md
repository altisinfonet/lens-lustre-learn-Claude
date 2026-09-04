# P32 · Appendix — every RPC call site in `src/**`

Generated from the sweep, not hand-typed. `handled` = the window contains an explicit
error branch, a throw, a toast, or a catch. It is a SIGNAL, not the verdict — the verdicts
for the unhandled set are in the main inventory and were read individually.

**100 production call sites, 85 distinct functions.**

| function | file:line | error branch present |
|---|---|---|
| `acquire_judge_lock` | `src/hooks/judging/useJudgingLock.ts:73` | yes |
| `admin_flag_entry_for_review` | `src/components/judge/CinemaFullView.tsx:1747` | yes |
| `admin_reject_wallet_transaction` | `src/components/admin/AdminTransactions.tsx:514` | yes |
| `admin_search_users` | `src/components/AdminGiftCredit.tsx:59` | yes |
| `admin_set_photo_rejected` | `src/modules/admin/EntriesModule.tsx:27` | yes |
| `admin_wallet_credit` | `src/components/AdminGiftCredit.tsx:212` | yes |
| `admin_wallet_credit` | `src/components/admin/AdminWalletTab.tsx:121` | yes |
| `app_has_role` | `src/hooks/social/useFriendFollow.ts:91` | **no** |
| `approve_deposit` | `src/components/admin/AdminTransactions.tsx:486` | yes |
| `are_friends` | `src/hooks/profile/useProfileData.ts:69` | **no** |
| `backfill_judging_notifications` | `src/components/admin/NotificationsHealthAudit.tsx:57` | yes |
| `backfill_tag_decision_drift_admin` | `src/components/admin/JudgingInvariantsAudit.tsx:151` | yes |
| `change_custom_url` | `src/pages/EditProfile.tsx:517` | yes |
| `check_custom_urls_taken` | `src/pages/EditProfile.tsx:203` | **no** |
| `claim_username` | `src/components/OnboardingModal.tsx:338` | yes |
| `clear_custom_url` | `src/pages/EditProfile.tsx:530` | yes |
| `email_exists` | `src/pages/ForgotPassword.tsx:39` | yes |
| `enroll_in_course` | `src/pages/CourseDetail.tsx:61` | yes |
| `filter_moderated_user_ids` | `src/pages/HashtagFeed.tsx:73` | **no** |
| `fix_certificate_readiness_admin` | `src/components/admin/AwardsIntegrityAudit.tsx:72` | yes |
| `fix_gift_drift_admin` | `src/components/admin/WalletReconciliationAudit.tsx:72` | yes |
| `fix_referral_drift_admin` | `src/components/admin/WalletReconciliationAudit.tsx:90` | yes |
| `fn` | `src/hooks/feed/usePostDrafts.ts:94` | **no** |
| `fn` | `src/lib/media/postMediaWrite.ts:81` | yes |
| `get_ad_engagement` | `src/lib/ads/adEngagement.ts:84` | yes |
| `get_app_event_counts_admin` | `src/components/admin/AdminAppEvents.tsx:126` | yes |
| `get_app_events_admin` | `src/components/admin/AdminAppEvents.tsx:127` | yes |
| `get_broadcast_feed` | `src/hooks/feed/useFeedQuery.ts:91` | yes |
| `get_certificate_drift_admin` | `src/components/admin/CertificateDriftAudit.tsx:58` | yes |
| `get_certificate_readiness_drift_admin` | `src/components/admin/AwardsIntegrityAudit.tsx:56` | yes |
| `get_competition_duplicate_clusters` | `src/hooks/judging/useJudgeIntegrityData.ts:65` | yes |
| `get_competition_raw_commitments` | `src/hooks/judging/useJudgeIntegrityData.ts:34` | yes |
| `get_contributor_scores` | `src/lib/contributorScore.ts:39` | yes |
| `get_course_lessons_for_editor` | `src/pages/CourseEditor.tsx:311` | **no** |
| `get_entry_status_drift_admin` | `src/components/admin/EntryStatusDriftAudit.tsx:48` | yes |
| `get_entry_status_drift_summary_admin` | `src/components/admin/EntryStatusDriftAudit.tsx:49` | yes |
| `get_feed_stories_bar` | `src/components/feed/FeedStoriesBar.tsx:75` | yes |
| `get_gated_entry_status` | `src/hooks/judging/useGatedEntryStatus.ts:58` | yes |
| `get_gift_drift_admin` | `src/components/admin/WalletReconciliationAudit.tsx:51` | yes |
| `get_judge_collusion_admin` | `src/components/admin/CollusionAudit.tsx:46` | yes |
| `get_judging_drift_admin` | `src/components/admin/JudgingForensicDriftAudit.tsx:57` | yes |
| `get_judging_tag_assignment_counts` | `src/pages/admin/AdminTagSemanticsAudit.tsx:95` | **no** |
| `get_lesson_content` | `src/pages/LessonView.tsx:39` | yes |
| `get_my_certificate_entries` | `src/pages/Certificates.tsx:131` | **no** |
| `get_my_notifications_grouped` | `src/hooks/notifications/useNotificationHistory.ts:30` | yes |
| `get_my_story_view_counts` | `src/components/feed/FeedStoriesBar.tsx:82` | yes |
| `get_my_story_view_counts` | `src/components/profile/ProfileStories.tsx:335` | **no** |
| `get_my_unread_notifications_grouped` | `src/hooks/notifications/useNotificationsQuery.ts:193` | **no** |
| `get_notification_drift_admin` | `src/components/admin/NotificationsHealthAudit.tsx:39` | yes |
| `get_notification_health_stats_admin` | `src/components/admin/NotificationsHealthAudit.tsx:40` | yes |
| `get_placement_drift_admin` | `src/components/admin/AwardsIntegrityAudit.tsx:55` | yes |
| `get_post_view_counts` | `src/hooks/feed/useFeedQuery.ts:210` | **no** |
| `get_profile_admin` | `src/components/admin/AdminFeaturedArtist.tsx:505` | **no** |
| `get_profile_admin` | `src/components/admin/ProfileTypeaheadPicker.tsx:35` | **no** |
| `get_profile_visible_fields` | `src/hooks/profile/useProfileData.ts:79` | **no** |
| `get_progression_drift_admin` | `src/components/admin/JudgingDriftAudit.tsx:44` | yes |
| `get_public_final_votes` | `src/lib/finalVoteTotals.ts:28` | yes |
| `get_public_role_user_ids` | `src/lib/adminBrand.ts:35` | **no** |
| `get_public_role_user_ids` | `src/pages/Discover.tsx:68` | **no** |
| `get_public_roles_for_users` | `src/hooks/profile/useProfileData.ts:67` | **no** |
| `get_public_roles_for_users` | `src/lib/profileMapCache.ts:324` | **no** |
| `get_public_round_scores` | `src/components/competition/PublicJudgeScoresReveal.tsx:99` | yes |
| `get_referral_drift_admin` | `src/components/admin/WalletReconciliationAudit.tsx:52` | yes |
| `get_round_judging_gate_admin` | `src/components/admin/JudgeUIvsDBGateAudit.tsx:133` | yes |
| `get_round_summary` | `src/components/judge/CompleteRoundDialog.tsx:79` | yes |
| `get_test_agent_health_admin` | `src/pages/admin/AdminTestAgent.tsx:84` | yes |
| `get_unjudged_parity_admin` | `src/components/admin/UnjudgedParityAudit.tsx:50` | yes |
| `has_role` | `src/hooks/social/useFriendshipMutations.ts:36` | yes |
| `heartbeat_judge_lock` | `src/hooks/judging/useJudgingLock.ts:109` | yes |
| `increment_managed_page_view` | `src/pages/ManagedPageView.tsx:69` | yes |
| `is_s3_storage_enabled` | `src/lib/s3Upload.ts:22` | **no** |
| `issue_course_completion_certificate` | `src/pages/CourseDetail.tsx:85` | yes |
| `judging_invariants_check` | `src/components/admin/JudgingInvariantsAudit.tsx:113` | yes |
| `list_tag_decision_drift_admin` | `src/components/admin/JudgingInvariantsAudit.tsx:97` | yes |
| `mutual_friend_ids` | `src/components/MutualFriends.tsx:30` | **no** |
| `mutual_friend_ids` | `src/components/discover/DiscoverCard.tsx:38` | **no** |
| `mutual_friend_ids` | `src/pages/Friends.tsx:155` | **no** |
| `mutual_friends_count` | `src/components/MutualFriends.tsx:29` | **no** |
| `mutual_friends_count` | `src/hooks/social/useFriendFollow.ts:98` | **no** |
| `mutual_friends_count` | `src/pages/Friends.tsx:151` | **no** |
| `process_referral_reward` | `src/components/admin/AdminReferrals.tsx:124` | yes |
| `process_referral_reward` | `src/pages/CompetitionSubmit.tsx:328` | swallowed (`.then(() => {})`) |
| `register_push_token` | `src/lib/native/push.ts:83` | yes |
| `register_push_token` | `src/lib/native/push.ts:93` | yes |
| `release_judge_lock` | `src/hooks/judging/useJudgingLock.ts:59` | yes |
| `release_judge_lock` | `src/hooks/judging/useJudgingLock.ts:165` | swallowed (`.then(() => {})`) |
| `request_withdrawal` | `src/hooks/wallet/useWalletWithdrawals.ts:46` | yes |
| `resolve_custom_url` | `src/pages/CustomUrlProfile.tsx:20` | **no** |
| `resolve_custom_url` | `src/pages/EditProfile.tsx:226` | **no** |
| `search_certificates` | `src/pages/VerifyCertificate.tsx:112` | yes |
| `search_profiles_admin` | `src/components/admin/ProfileTypeaheadPicker.tsx:50` | **no** |
| `submit_competition_entry` | `src/hooks/competition/useCompetitionEntryMutations.ts:35` | yes |
| `suggest_username` | `src/components/OnboardingModal.tsx:211` | **no** |
| `unregister_push_token` | `src/lib/native/push.ts:134` | yes |
| `username_available` | `src/components/OnboardingModal.tsx:228` | yes |
| `verify_certificate` | `src/pages/VerifyCertificate.tsx:84` | yes |
| `verify_certificate_by_token` | `src/pages/CertificateVerifyByToken.tsx:44` | yes |
| `verify_staff_id` | `src/pages/IDVerification.tsx:59` | yes |
| `wallet_transaction` | `src/hooks/wallet/useWallet.ts:66` | yes |
| `wallet_transaction` | `src/hooks/wallet/useWallet.ts:79` | yes |
