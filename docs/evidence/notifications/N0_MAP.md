# N0 — Notification map (both lanes, measured 2026-10-31)

**Gate sentence:** N0 closes when this file holds the map, the gap list and
PROBE run IDs on both lanes, plus measured sizes for N1–N8.

## Runs

| Lane | PROBE | Run | Result | UTC |
|---|---|---|---|---|
| staging (fpszggreishhuvdpkmdr) | `PROBE_20261104_0100_notifications_map.sql` | 41202968098 | PASS (rc 0) | 13:19 |
| production (jtdtehuqtinjxropkkcn) | same | 41206791083 | PASS (rc 0) | 13:49 |

Read-only, lane-asserted, `ROLLBACK`. It prints md5 + length of each function
body (never source text — four review rounds showed no screen is safe for a
public log), trigger shape, grants, cron md5, table shapes and aggregate counts.
Logs parsed with the scratch tools described in `fixtures/README.md`.
(Run 41202972066 on staging at the same minute was another runner's file.)

## 1. Every notification function, both lanes

**All 53 functions are byte-identical on staging and production.** 41 equal
git's latest definition. **12 equal the commented-out bootstrap snapshot**
`supabase/migrations/UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql`
byte-for-byte and nothing applied in git — these are the live-only pieces N1
captures (`pj_handle_tag_notification` exists only there):
`emit_birthday_notifications`, `emit_notification`,
`get_my_notifications_grouped`, `notify_entry_status_change`,
`notify_post_comment`, `notify_post_reaction`, `notify_post_tag`,
`notify_round_published`, `notify_round_published_insert`,
`pj_handle_tag_notification`, `prune_old_notifications`,
`send_notification_email`.

| Function | S md5 | P md5 | S=P | git (S / P) | flags (P, else S) | fired by (lane:table.trigger) | called by |
|---|---|---|---|---|---|---|---|
| `_notification_template_for_entry(_status text, _placement text)` | 5d26beb7 | 5d26beb7 | yes | git=latest / git=latest |  |  |  |
| `backfill_judging_notifications(_window_days integer, _dry_run boolean)` | d9d1264b | d9d1264b | yes | git=latest / git=latest | CALLS_EMIT EMAIL |  |  |
| `cron_http_call(_job text)` | c714517b | c714517b | yes | git=latest / git=latest | PUSH_HTTP |  |  |
| `email_queue_wake(_source text)` | be7cd421 | be7cd421 | yes | git=latest / git=latest | TIME_WINDOW PUSH_HTTP |  | email_queue_tick email_queue_wake_trg |
| `emit_birthday_notifications()` | e461c274 | e461c274 | yes | bootstrap snapshot / bootstrap snapshot | W_USER ON_CONFLICT DEDUP_KEY |  |  |
| `emit_notification(_kind text, _entity_id uuid, _round_number integer, _recipient_user_id uuid, _in_app_type text, _in_app_title text, _in_app_message text, _in_app_reference_id uuid, _email_template text, _email_data jsonb, _action_url text)` | 560500fe | 560500fe | yes | bootstrap snapshot / bootstrap snapshot | W_USER W_EMITLOG READS_PREFS ON_CONFLICT EMAIL SWITCH? |  |  |
| `fan_out_new_post()` | 8922d486 | 8922d486 | yes | git=latest / git=latest | W_USER SELF_CHECK? | S:posts.trg_fan_out_new_post AFTER INSERT P:posts.trg_fan_out_new_post AFTER INSERT |  |
| `first_post_reminders_tick()` | fc494d5f | fc494d5f | yes | git=latest / git=latest | W_USER READS_PREFS ON_CONFLICT DEDUP_KEY EMAIL |  |  |
| `get_my_notifications_grouped(_limit integer, _before timestamp with time zone)` | 17e4a1a0 | 17e4a1a0 | yes | bootstrap snapshot / bootstrap snapshot |  |  |  |
| `get_my_unread_notifications_grouped(_limit integer, _exclude_types text[])` | 8327d799 | 8327d799 | yes | git=latest / git=latest |  |  |  |
| `get_notification_drift_admin(_window_days integer)` | 5f9a8b83 | 5f9a8b83 | yes | git=latest / git=latest | EMAIL |  |  |
| `get_notification_email_enabled(_user_id uuid, _notif_type text)` | 31ce9654 | 31ce9654 | yes | git=latest / git=latest | READS_PREFS |  |  |
| `get_notification_health_stats_admin()` | 063c0011 | 063c0011 | yes | git=latest / git=latest | EMAIL |  |  |
| `notif_action_phrase(_type text)` | 5a821d19 | 5a821d19 | yes | git=latest / git=latest |  |  |  |
| `notif_display_name(_actor_id uuid)` | 3d1a9463 | 3d1a9463 | yes | git=latest / git=latest |  |  |  |
| `notif_group_key(_type text, _created_at timestamp with time zone, _id uuid)` | 9a430028 | 9a430028 | yes | git=latest / git=latest |  |  |  |
| `notif_push_body(_type text, _actor_id uuid, _message text)` | 52e44032 | 52e44032 | yes | git=latest / git=latest |  |  |  |
| `notify_ad_comment_reply()` | 064674d9 | 064674d9 | yes | git=latest / git=latest | W_USER SELF_CHECK? ON_CONFLICT DEDUP_KEY | S:ad_creative_comments.trg_notify_ad_comment_reply AFTER INSERT P:ad_creative_comments.trg_notify_ad_comment_reply AFTER INSERT |  |
| `notify_admin_comment_report()` | be824159 | be824159 | yes | git=latest / git=latest | W_ADMIN | S:comment_reports.trg_admin_notify_comment_report AFTER INSERT P:comment_reports.trg_admin_notify_comment_report AFTER INSERT |  |
| `notify_admin_new_ticket()` | d63cd979 | d63cd979 | yes | git=latest / git=latest | W_ADMIN SELF_CHECK? | S:support_tickets.on_new_support_ticket AFTER INSERT P:support_tickets.on_new_support_ticket AFTER INSERT |  |
| `notify_admin_post_report()` | 42a17ced | 42a17ced | yes | git=latest / git=latest | W_ADMIN | S:post_reports.trg_admin_notify_post_report AFTER INSERT P:post_reports.trg_admin_notify_post_report AFTER INSERT |  |
| `notify_admin_role_application()` | 2f1d2b81 | 2f1d2b81 | yes | git=latest / git=latest | W_ADMIN SELF_CHECK? | S:role_applications.trg_admin_notify_role_application AFTER INSERT P:role_applications.trg_admin_notify_role_application AFTER INSERT |  |
| `notify_admin_user_blocked()` | 26f04954 | 26f04954 | yes | git=latest / git=latest | W_ADMIN READS_BLOCKS ON_CONFLICT TIME_WINDOW | S:user_blocks.user_blocks_notify_admin AFTER INSERT P:user_blocks.user_blocks_notify_admin AFTER INSERT |  |
| `notify_badge_awarded()` | d39f4782 | d39f4782 | yes | git=latest / git=latest | W_USER | S:user_badges.trg_notify_badge_awarded AFTER INSERT P:user_badges.trg_notify_badge_awarded AFTER INSERT |  |
| `notify_certificate_issued()` | f497ea67 | f497ea67 | yes | git=latest / git=latest | W_USER | S:certificates.trg_notify_certificate_issued AFTER INSERT P:certificates.trg_notify_certificate_issued AFTER INSERT |  |
| `notify_competition_vote()` | 144a0223 | 144a0223 | yes | git=latest / git=latest | W_USER SELF_CHECK? | S:competition_votes.trg_notify_competition_vote AFTER INSERT P:competition_votes.trg_notify_competition_vote AFTER INSERT |  |
| `notify_course_published()` | d8246bfc | d8246bfc | yes | git=latest / git=latest | W_USER | S:courses.trg_notify_course_published BEFORE UPDATE P:courses.trg_notify_course_published BEFORE UPDATE |  |
| `notify_entry_status_change()` | 65021751 | 65021751 | yes | bootstrap snapshot / bootstrap snapshot | W_HELD CALLS_EMIT ON_CONFLICT EMAIL | S:competition_entries.trg_notify_entry_status AFTER UPDATE P:competition_entries.trg_notify_entry_status AFTER UPDATE |  |
| `notify_featured_artist()` | c4d060b3 | c4d060b3 | yes | git=latest / git=latest | W_USER | S:featured_artists.trg_notify_featured_artist AFTER INSERT P:featured_artists.trg_notify_featured_artist AFTER INSERT |  |
| `notify_friend_request_accepted()` | 0aaf3f9e | 0aaf3f9e | yes | git=latest / git=latest | W_USER | S:friendships.trg_notify_friend_accepted AFTER UPDATE P:friendships.trg_notify_friend_accepted AFTER UPDATE |  |
| `notify_friend_request_received()` | ba6cc362 | ba6cc362 | yes | git=latest / git=latest | W_USER SELF_CHECK? | S:friendships.trg_notify_friend_request AFTER INSERT P:friendships.trg_notify_friend_request AFTER INSERT |  |
| `notify_image_comment()` | efc231dd | efc231dd | yes | git=latest / git=latest | W_USER SELF_CHECK? | S:image_comments.trg_notify_image_comment AFTER INSERT P:image_comments.trg_notify_image_comment AFTER INSERT |  |
| `notify_image_reaction()` | 8abf6c1b | 8abf6c1b | yes | git=latest / git=latest | W_USER SELF_CHECK? | S:image_reactions.trg_notify_image_reaction AFTER INSERT P:image_reactions.trg_notify_image_reaction AFTER INSERT |  |
| `notify_journal_published()` | 9535dc21 | 9535dc21 | yes | git=latest / git=latest | W_USER | S:journal_articles.trg_notify_journal_published BEFORE UPDATE P:journal_articles.trg_notify_journal_published BEFORE UPDATE |  |
| `notify_new_competition()` | 9a3b04d3 | 9a3b04d3 | yes | git=latest / git=latest | W_USER | S:competitions.trg_notify_new_competition BEFORE INSERT OR UPDATE P:competitions.trg_notify_new_competition BEFORE INSERT OR UPDATE |  |
| `notify_new_follower()` | 43b65284 | 43b65284 | yes | git=latest / git=latest | W_USER SELF_CHECK? | S:follows.trg_notify_new_follower AFTER INSERT P:follows.trg_notify_new_follower AFTER INSERT |  |
| `notify_post_comment()` | 26c9714d | 26c9714d | yes | bootstrap snapshot / bootstrap snapshot |  | S:post_comments.trg_notify_post_comment AFTER INSERT P:post_comments.trg_notify_post_comment AFTER INSERT |  |
| `notify_post_reaction()` | 4b865596 | 4b865596 | yes | bootstrap snapshot / bootstrap snapshot |  | S:post_reactions.trg_notify_post_reaction AFTER INSERT P:post_reactions.trg_notify_post_reaction AFTER INSERT |  |
| `notify_post_tag()` | 98231c0a | 98231c0a | yes | bootstrap snapshot / bootstrap snapshot |  | S:post_tags.trg_notify_post_tag AFTER INSERT P:post_tags.trg_notify_post_tag AFTER INSERT |  |
| `notify_potd_featured()` | 3b4fd5ee | 3b4fd5ee | yes | git=latest / git=latest | W_USER | S:photo_of_the_day.trg_notify_potd_featured AFTER INSERT P:photo_of_the_day.trg_notify_potd_featured AFTER INSERT |  |
| `notify_role_application_decision()` | 9955f5c1 | 9955f5c1 | yes | git=latest / git=latest | W_USER | S:role_applications.trg_notify_role_decision AFTER UPDATE P:role_applications.trg_notify_role_decision AFTER UPDATE |  |
| `notify_round_published()` | e41ae90d | e41ae90d | yes | bootstrap snapshot / bootstrap snapshot | CALLS_EMIT EMAIL | S:competition_round_publish.trg_notify_round_published AFTER UPDATE P:competition_round_publish.trg_notify_round_published AFTER UPDATE |  |
| `notify_round_published_insert()` | 414dea23 | 414dea23 | yes | bootstrap snapshot / bootstrap snapshot | CALLS_EMIT EMAIL | S:competition_round_publish.trg_notify_round_published_insert AFTER INSERT P:competition_round_publish.trg_notify_round_published_insert AFTER INSERT |  |
| `notify_user_ticket_reply()` | 997ba1aa | 997ba1aa | yes | git=latest / git=latest | W_USER | S:ticket_replies.on_admin_ticket_reply AFTER INSERT P:ticket_replies.on_admin_ticket_reply AFTER INSERT |  |
| `pj_handle_comment_notification(_msg jsonb)` | 2aff8272 | 2aff8272 | yes | git=latest / git=latest | W_USER ON_CONFLICT DEDUP_KEY |  | process_post_jobs |
| `pj_handle_reaction_notification(_msg jsonb)` | a7740498 | a7740498 | yes | git=latest / git=latest | W_USER ON_CONFLICT DEDUP_KEY |  | process_post_jobs |
| `pj_handle_tag_notification(_msg jsonb)` | f9f9869c | f9f9869c | yes | bootstrap snapshot only / same | W_USER ON_CONFLICT DEDUP_KEY |  | process_post_jobs |
| `prune_old_notifications(_days integer, _max_rows integer)` | 345ac2e5 | 345ac2e5 | yes | bootstrap snapshot / bootstrap snapshot |  |  |  |
| `publish_scheduled_posts_tick()` | 18b51a84 | 18b51a84 | yes | git=latest / git=latest | PUSH_HTTP |  |  |
| `push_on_notification()` | 8610c27a | 8610c27a | yes | git=latest / git=latest | READS_PREFS SELF_CHECK? PUSH_HTTP | S:user_notifications.trg_push_on_notification AFTER INSERT P:user_notifications.trg_push_on_notification AFTER INSERT |  |
| `send_notification_email()` | 2e40fd53 | 2e40fd53 | yes | bootstrap snapshot / bootstrap snapshot | READS_PREFS SELF_CHECK? ON_CONFLICT EMAIL SWITCH? | S:user_notifications.trg_send_notification_email AFTER INSERT P:user_notifications.trg_send_notification_email AFTER INSERT |  |
| `trg_entry_status_lifecycle_emit()` | c8f4aa56 | c8f4aa56 | yes | git=latest / git=latest | CALLS_EMIT |  |  |
| `video_takedown(_video_id uuid, _reason text, _report_id uuid)` | fb9917ab | fb9917ab | yes | git=latest / git=latest | W_USER ON_CONFLICT DEDUP_KEY |  |  |

| Type | P total | P 30 d | P 7 d | P 1 d | P self | P across a block (30 d) | P duplicate rows ≤60 s (30 d) | P groups of 3+ (30 d) | P e-mailed | S total |
|---|---|---|---|---|---|---|---|---|---|---|
| `new_post_from_following` | 5069 | 754 | 198 | 0 | 0 | 0 | 0 | 0 | 4830 | 1028 |
| `post_reaction` | 2712 | 441 | 168 | 9 | 0 | 0 | 0 | 6 | 2536 | 0 |
| `post_comment` | 597 | 119 | 40 | 2 | 0 | 0 | 1 | 0 | 550 | 0 |
| `birthday` | 59 | 43 | 0 | 0 | 0 | 0 | 0 | 0 | 59 | 0 |
| `new_follower` | 409 | 32 | 6 | 2 | 0 | 0 | 1 | 0 | 397 | 51 |
| `comment_reply` | 156 | 24 | 7 | 0 | 0 | 0 | 1 | 0 | 151 | 0 |
| `tagged_post_reaction` | 81 | 14 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `friend_accepted` | 124 | 12 | 2 | 0 | 0 | 0 | 0 | 0 | 111 | 0 |
| `friend_request` | 250 | 9 | 1 | 0 | 0 | 0 | 0 | 0 | 245 | 0 |
| `tagged_post_comment` | 18 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `post_tag` | 15 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 15 | 0 |
| `potd_featured` | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `course_published` | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 12 | 0 |
| `certificate_issued` | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 0 |
| `image_reaction` | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| `badge_awarded` | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 13 | 2 |
| `ad_comment_reply` | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |

**production** — admin alerts: `backup_reminder` total=1 d30=1; `post_report` total=3 d30=3; `role_application` total=2 d30=2

**production** — settings rows: 1; switched OFF: email_reactions=1, email_comments=1, email_friend_requests=0, email_new_followers=0, email_competition_updates=0, email_gift_credits=0, email_certificates=0, email_course_updates=0, inapp_reactions=0, inapp_comments=0, inapp_social=0, inapp_competitions=0, email_weekly_digest=0, email_reengagement=0, push_enabled=0, push_reactions=0, push_comments=0, push_friend_requests=0, push_new_followers=0, push_competition_updates=0, push_new_posts=1, push_announcements=0

**production** — push tokens: android|tokens=48|members=47

**production** — e-mail log (30 d): notification-alert|pending|1296|last=2026-10-31; notification-alert|sent|1296|last=2026-10-31; reengagement-day-15|pending|15|last=2026-10-21; reengagement-day-15|sent|15|last=2026-10-21; reengagement-day-3|pending|7|last=2026-10-30; reengagement-day-3|sent|7|last=2026-10-30; reengagement-day-30|pending|35|last=2026-10-31; reengagement-day-30|sent|35|last=2026-10-31; reengagement-day-40|pending|34|last=2026-10-31; reengagement-day-40|sent|34|last=2026-10-31; reengagement-day-50|pending|31|last=2026-10-31; reengagement-day-50|sent|31|last=2026-10-31; reengagement-day-60|pending|23|last=2026-10-28; reengagement-day-60|sent|23|last=2026-10-28; reengagement-day-7|pending|8|last=2026-10-29; reengagement-day-7|sent|8|last=2026-10-29

**production** — pg_net responses retained: status=<null>|error=t|6|since=2026-10-31 08:00:00.197293+00; status=200|error=f|233|since=2026-10-31 07:50:00.158371+00

**production** — busiest recipient-day: max=18|p99=9|recipient_days=817

**production** — emit log: entry_rejected|total=11|d30=0|inapp=11|email=11|last=2026-05-03 · held results: entry_finalist|1|last=2026-07-23; entry_qualified_round|4|last=2026-07-23; entry_rejected|2|last=2026-07-19; entry_shortlisted|2|last=2026-07-19

**production** — cron: emit-birthday-notifications|30 3 * * *|t|9623754ec6613e6e97f2438bf170c030|44|emit_birthday_notifications; process-email-queue|* * * * *|t|e40a51f127f2f65d5a9dba2414d59e03|33|email_queue_tick; prune-old-notifications|20 3 * * *|t|9059b5cc5bb4a6a3512ff3cb97ec9295|50|prune_old_notifications; send-reengagement-emails|0 9 * * *|t|d3e1faeacd747b5f09c89d17fe3fb2ec|57|cron_http_call 

**production** — skipped sections: 

**staging** — admin alerts: `comment_report` total=1 d30=0; `role_application` total=4 d30=2; `wallet_ledger_v2_diff_drift` total=1 d30=0

**staging** — settings rows: 0; switched OFF: email_reactions=0, email_comments=0, email_friend_requests=0, email_new_followers=0, email_competition_updates=0, email_gift_credits=0, email_certificates=0, email_course_updates=0, inapp_reactions=0, inapp_comments=0, inapp_social=0, inapp_competitions=0, email_weekly_digest=0, email_reengagement=0, push_enabled=0, push_reactions=0, push_comments=0, push_friend_requests=0, push_new_followers=0, push_competition_updates=0, push_new_posts=0, push_announcements=0

**staging** — push tokens: 

**staging** — e-mail log (30 d): notification-alert|pending|104|last=2026-10-14

**staging** — pg_net responses retained: status=<null>|error=t|1|since=2026-10-31 07:40:00.080156+00; status=200|error=f|71|since=2026-10-31 07:25:00.082529+00

**staging** — busiest recipient-day: max=2|p99=2|recipient_days=515

**staging** — emit log:  · held results: 

**staging** — cron: emit-birthday-notifications|30 3 * * *|t|9623754ec6613e6e97f2438bf170c030|44|emit_birthday_notifications; prune-old-notifications|20 3 * * *|t|9059b5cc5bb4a6a3512ff3cb97ec9295|50|prune_old_notifications 

**staging** — skipped sections: 


Flags are pattern hints read from the source (W_USER / W_ADMIN = inserts a
notification row; READS_PREFS; READS_BLOCKS; SELF_CHECK?; ON_CONFLICT /
DEDUP_KEY; PUSH_HTTP; EMAIL). 30 triggers fire makers on each lane, the same
30 on both (table · timing · event in the "fired by" column).

### What the live bodies show (beyond git)

- **Likes, comments and tags no longer write directly**: the live
  `notify_post_reaction / _comment / _tag` (snapshot versions) queue a job;
  `process_post_jobs` → `pj_handle_reaction_notification /
  pj_handle_comment_notification / pj_handle_tag_notification` write the rows,
  with a `dedup_key` (production: 2,685 of 2,712 likes and 586 of 597 comments
  carry one).
- **Push** goes out from `push_on_notification` (AFTER INSERT, pg_net to
  send-push); **e-mail** from `send_notification_email` (AFTER INSERT; skips
  rows with `email_sent = true`) into the e-mail queue (`process-email-queue`
  cron, every minute).
- `prune_old_notifications` cron (03:20 UTC daily) and
  `emit-birthday-notifications` (03:30 UTC) run on both lanes.

## 2. Gap list

### Gaps found in git (before the live reading)

| # | Gap | Where | Size for the centre |
|---|---|---|---|
| G1 | The four **In-app** settings (`inapp_reactions`, `inapp_comments`, `inapp_social`, `inapp_competitions`) are read by **nothing**: a member turns them off and keeps getting those notifications. Dead since 2026-04-07; recorded in `src/__tests__/notificationPreferenceWiring.test.ts` as an Owner decision. | every maker | N2's decision reads them; they start working when a group goes live (N3 + N8). |
| G2 | **Weekly digest** switch (`email_weekly_digest`) controls a feature that does not exist. | settings page | N4 builds the weekly summary; N7's table hides the switch until then. |
| G3 | **Any signed-in member can create an admin alert** with any title and text: `manage-notifications` action `insert_admin_notification` checks only that the caller is signed in. | `supabase/functions/manage-notifications/index.ts:104` | N3 group 5 moves admin alerts behind the centre (type must be registered, rate-limited, duplicate-checked); edge deploy is an Owner item. |
| G4 | **Push type mapping is a hand-kept CASE** in `push_on_notification()`: any type not listed gets a push governed only by the master switch (e.g. tagged-post reactions/comments, post tags, new posts from people you follow, badge, certificate). | `20260731100000_push_on_notification.sql` | N2's registry names a push setting per type; N4's queue uses it. |
| G5 | **Grouping happens only when reading** (`notif_group_key()` in the grouped readers); each event is still one row and one push. | readers | N2 adds a per-type duplicate window and grouping key; N4 groups pushes (Android tag / iOS thread). |
| G6 | **No rate limit** on any maker. | all | N2 decision: `rate_per_hour` per type. |
| G7 | **Four edge functions write notification rows directly** (backup-reminder, judging-invariants-nightly, manage-notifications, submit-deposit). | `supabase/functions/*` | N3 group 4/5; listed in the N5 ratchet. |
| G8 | **No push receipts**: send-push counts successes in memory and prunes dead tokens; nothing records sent / failed / opened per notification, and nothing raises an alarm when pushes fail. | `supabase/functions/send-push/index.ts` | N4 delivery queue + receipts + `ops_alarms`. |
| G9 | **35 direct writers** in git (31 SQL functions by their last definition + 4 edge functions) — now pinned by the N5 ratchet (#752). | — | N3 removes them group by group. |

| G10 | **12 live functions exist only in a commented-out snapshot** — no applied migration creates them; a rebuild from git would lose them (incl. the live like/comment/tag path and the e-mail trigger). | live | **N1** captures all 12 from the snapshot text (identical md5 on both lanes; no live body needs printing). |
| G11 | **The in-app settings are dead (G1) — measured**: 1 member on production has a settings row at all (switched off e-mail for likes and comments, and new-post pushes). | production | N7 table + N3 gate make them work when a group goes live. |
| G12 | **Duplicates are rare but real**: 3 rows within 60 s of an identical row in 30 days (comment_reply, new_follower, post_comment). | production | N2 duplicate window (60 s default per type). |
| G13 | **Grouping potential is small today**: 6 like-buckets of 3+ in 30 days (max 4 on one photo in one day). | production | "A and N others" in N7 rows is enough; no server merge needed yet. |
| G14 | **Self and blocked: 0** in 30 days on every type (the makers' own checks work). | production | N2 keeps both checks; no fix needed. |
| G15 | **pg_net errors**: 6 failed of 239 HTTP calls retained today (pg_net keeps ~6 h; push and other calls mixed). No record ties a failure to a notification. | production | N4 delivery receipts + `ops_alarms`. |
| G16 | The **e-mail log writes two rows per mail** (pending + sent: 1,296 each for `notification-alert` in 30 d). Counting "sent" must filter by status. | production | N6 numbers read status = sent. |

## 3. Volumes (production, 30 days unless stated)

| Kind | 30 d | 7 d | total |
|---|---|---|---|
| new_post_from_following | 754 | 198 | 5,069 |
| post_reaction | 441 | 168 | 2,712 |
| post_comment | 119 | 40 | 597 |
| birthday | 43 | 0 | 59 |
| new_follower | 32 | 6 | 409 |
| comment_reply | 24 | 7 | 156 |
| tagged_post_reaction | 14 | 5 | 81 |
| friend_accepted | 12 | 2 | 124 |
| friend_request | 9 | 1 | 250 |
| others (badge, certificate, course, image_reaction, post_tag, potd, tagged_post_comment, ad_comment_reply) | ≤ 2 each | | 80 |
| admin alerts | post_report 3, role_application 2, backup_reminder 1 | | 6 |

Busiest member-day: 18 notifications (99th percentile 9) over 817
member-days. Push devices: 48 Android tokens / 47 members (no iOS or web).
E-mails: `notification-alert` 1,296 sent; re-engagement series 153 sent.
Every production type is in N2's 49-type registry (no "unregistered" expected
in the shadow). Staging holds seeded data only (1,081 member rows, 6 admin).

## 4. Measured sizes for N1–N8

| Step | Size, from the measurements above |
|---|---|
| N1 | 12 functions from the snapshot text (+ their triggers already in git); one equality PROBE (md5 of each live body = md5 of the captured text) on both lanes. |
| N2 | 49 types, ~1,500 rows / 30 d to replay; shadow PROBE replays one day (~50 rows/day) in well under a second. |
| N3 | One gate trigger on 2 tables (done, #760). Before a group goes live: list writers that use `RETURNING` / `ON CONFLICT` (from N1's bodies). |
| N4 | ~50 notification rows/day, each a push candidate for the 47 members with a device (48 Android tokens); ~43 notification e-mails/day. Pushes actually sent per day are NOT measurable today (no receipts — G8, G15). Queue + receipts sized for 10× that. |
| N5 | 35 direct writers in git + 1 live-only (`pj_handle_tag_notification`) for the nightly allow-list. |
| N6 | 49 types × 8 switches. |
| N7 | 17 production types to word in the app; 1 member has custom settings today. |
| N8 | 7 groups + the screens switch; Owner steps one row at a time. |

## 5. Owner items raised by N0

None new (the in-app settings decision is already on the status list).
