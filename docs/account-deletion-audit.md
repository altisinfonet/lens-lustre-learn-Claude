# Account Deletion Audit (checklist item 6, P0)

**Question:** when a member deletes their account, is everything they own actually deleted?
**Answer: no.** 41 tables of their data survive, including their photographs, their bank details and their wallet.

Measured 2026-08-15 against production `jtdtehuqtinjxropkkcn`. Nothing here is inferred from design notes — every claim below names how it was established.

---

## Why this matters more than a normal bug

`delete-my-account`'s own header says it deletes *"their own account and all associated data"*, states it is *"Required for Google Play / Apple 'delete account' policy and general privacy"*, and the function **sends the member an erasure-confirmation email** when it finishes.

So the platform tells the member — in writing — that their data is gone, while their photographs remain on the public CDN and their bank details remain in the database. That is not only a privacy failure; it is a written assurance that is not true, made to satisfy an app-store policy.

**Current blast radius: nobody has been harmed yet.** 94 auth users, 94 profiles, and orphan counts of **0** for posts, wallets, bank_details, support_tickets, user_notifications and stories. One orphaned `post_comments` row exists. So the gap is real but has essentially never been exercised — this is being found before a member relies on it, not after.

---

## How deletion works today

Three mechanisms run, and between them they cover about half the surface:

1. **Explicit deletes in `delete-my-account`** — 17 tables (comment_reports, competition_judges, follows, friendships, judge_comments, judge_scores, judge_tag_assignments, portfolio_images, post_reports, profile_views, profiles, referrals, reports, role_applications, user_roles, verification_requests, withdrawal_requests).
2. **`admin_purge_orphan_user_data(uuid)`** — a further 17 (ad_conversions, ai_chat_usage, auth_login_attempts, feed_events, raw_commitments, custom_url_history, held_result_notifications, notification_emit_log, post_tags, and the judge_* working state), plus stripping the departing member from other people's scheduled-post tag arrays.
3. **Database `ON DELETE CASCADE`** — but only **28 foreign keys in the entire schema** point at `auth.users` or `profiles`. Everything else has no link at all, so the database removes nothing on its own.

That third point is the root cause. **78 user-owned columns have no foreign key**, so deletion coverage is whatever someone remembered to write by hand — and a table added next month is uncovered by default, silently.

---

## What survives (41 tables)

Grouped by what a decision about them actually costs.

**Their own content — the member would expect this gone**
`posts` · `post_drafts` · `scheduled_posts` · `stories` · `highlights` · `photo_albums` · `featured_photos` · `competition_entries`

**Their words on other people's things — a product decision, not obvious**
`comments` · `post_comments` · `image_comments` · `post_reactions` · `comment_reactions` · `image_reactions` · `post_comment_reactions` · `post_shares` · `competition_votes` · `ad_creative_comments` · `ad_creative_reactions` · `ad_creative_shares` · `certificate_testimonials`

Deleting these removes context from conversations other members are still having. Anonymising ("a deleted member") is the usual answer. Either way it must be chosen, not defaulted.

**Financial — retention may be legally *required*, deletion may be legally *wrong***
`wallets` · `wallet_transactions` · `wallet_ledger_v2_rows` · `wallet_reconciliation_log` · `competition_orders` · `bank_details` · `referral_codes` · `gift_announcements`

Most jurisdictions require keeping transaction records for years. **`bank_details` is the exception that needs no debate:** an account number for an account that no longer exists serves no accounting purpose and is pure liability. It should go, or be reduced to the last four digits if the ledger needs a reference.

**Support and operational**
`support_tickets` · `ticket_replies` · `user_notifications` · `user_badges` · `user_devices` · `newsletter_subscribers` · `push_delivery_log` · `client_errors` · `activity_logs` · `member_activity_minutes` · `contributor_engagement_daily` · `v3_mirror_log`

---

## The part with no argument on the other side: the photographs

`delete-my-account` touches **no storage at all** — grep for storage/S3/R2/bucket in it returns only comments. So:

- the member's photographs stay in R2, and
- because their `posts` rows also stay, the orphan sweep never sees the files as unreferenced, so **they are never collected either**, and
- per the [privacy transition matrix](./privacy-transition-matrix.md), those CDN URLs are readable by anyone, forever, with no login.

A member who deletes their account today keeps their photographs publicly downloadable on the internet indefinitely, and receives an email saying their data was erased.

---

## Recommendation

**Do not fix this by writing 41 more DELETE statements.** Two reasons: three of the four groups above need an owner decision first, and mass deletion is exactly what the standing Deletion Protocol forbids without enumeration, a dry run, a reviewed count and a threshold.

Proposed order:

1. **Immediately, no decision needed:** delete `bank_details`, and delete the member's own content (`posts`, drafts, scheduled, stories, highlights, albums) together with their R2 objects. This is what the member asked for and what the email already claims.
2. **Owner decision:** their words on others' content — delete, or anonymise to "deleted member"?
3. **Owner decision, possibly with an accountant:** which financial rows must be retained, and for how long.
4. **Structural, so this cannot recur:** add a regression test that fails when a table gains a user-owned column that is neither cascade-covered nor named in the deletion path. Coverage stops depending on memory. This is the same shape as the newTableGrants gate that already stops new tables shipping open to anonymous access.
5. **Until 1–3 ship:** the erasure-confirmation email should not claim complete erasure.

**Nothing was changed by this audit.** It is read-only: catalogue queries and one function read.
