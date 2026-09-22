# Like / Comment / Share on sponsored ads — SHIPPED 2026-08-11

Owner: *"For All sponsored Ad, Like Comment share is required like a normal
post."* He chose the full build and a new `/ad/<id>` permalink page.

**Status: live on the web and on production Postgres. Verified end to end.**

## Files (all 11 on origin/main, each byte-verified with `cmp`)

New: `supabase/migrations/20260811120000_ad_creative_engagement.sql`,
`src/lib/ads/adEngagement.ts`, `src/components/ads/AdEngagementBar.tsx`,
`src/components/ads/AdComments.tsx`, `src/pages/AdDetail.tsx`,
`src/__tests__/adEngagement.test.ts`

Edited: `AdZone.tsx`, `App.tsx`, `describe.ts`, `notificationLinks.ts`,
`NotificationBell.tsx`

## Design decisions

- **Engagement keys to `ad_creatives.id`.** The legacy single-image-per-zone
  path has no id, so it gets no action row — the `chosen &&` guard in AdZone
  enforces that. A synthetic id would have merged every zone's legacy image into
  one shared comment thread.
- **Three new tables, not a nullable column on `post_comments`.** Reusing the
  post tables was the smaller diff and was rejected: they carry the busiest
  triggers on the site.
- **The blocklist is reused, not copied** — `enforce_comment_blocklist()` reads
  only `NEW.content`. A flagged ad comment lands in the SAME `comment_reports`
  queue via a new nullable `ad_comment_id`.
- **Deleted-account write lock** on all three tables, in the shape of
  `20260806160000`.
- **`get_ad_engagement(uuid[])`** — one round trip for a screen of 16 ads.
- **No "Share to your wall."** It would publish an advertisement under a
  member's own name. Share copies `/ad/<id>` and records the share.
  **Owner still to confirm.**
- **`ad_comment_reply`** notification; obeys the existing comment-email switch;
  groups like every other reply.

## Gates

tsc clean · `vite build` ✓ · vitest **1122 pass / 2 fail** (the two known
judging tests) · security audit PASS · three mutations each turning exactly one
test red (drop the `chosen` guard, drop `ignoreDuplicates`, drop a table from
the liveness lock).

## Production verification

**Function source is byte-identical to the committed migration** — md5 of each
body computed from the file and compared to `pg_proc`:

| function | md5 | len |
|---|---|---|
| `flag_ad_comment_for_review` | `8305b8d1603b4d53a2c6b4450124b030` | 485 |
| `get_ad_engagement` | `6326096d48d34221516415d306c5c331` | 929 |
| `get_notification_email_enabled` | `31ce96541fe5dd3eb4d60f9a0680734a` | 2431 |
| `notif_action_phrase` | `5a821d19c886190adaf52494a75c610f` | 1056 |
| `notif_group_key` | `9a4300286a8e7edef87030744c5241ae` | 475 |
| `notify_ad_comment_reply` | `064674d9531b5145da2f628487d02279` | 858 |
| `set_ad_comment_updated_at` | `5bdc21b8fa8fb1231bdb021e09a5bc8e` | 53 |

Structure: **3** new tables · **11** permissive policies · **9** restrictive
liveness guards (3 × 3) · **4** triggers on `ad_creative_comments` · the
`comment_reports.ad_comment_id` column present with **0** rows touched.

**Nothing else moved.** The email-policy behaviour fingerprint over 3 real users
× 27 existing notification types is `bb2e1b136cc8e75f2fa8ab68b95de09a` — the
identical hash measured before this change AND before the tagged-notification
change earlier today. `ad_comment_reply` correctly returns `true` (respects the
member's comment-email preference).

**Live functional test** on www.50mmretina.com:
- Deployed bundle scanned (27 assets): `get_ad_engagement` and
  `ad_creative_comments` both present.
- The story-card ad in the feed now draws the post action row — thumbs-up,
  speech bubble, paper plane.
- Tapping Comment opened the thread ("No comments yet." + composer).
- Posted a real comment: it appeared with author name, avatar, "Just now",
  Reply and the ⋯ menu, and the count went to 1. That exercises the RLS INSERT,
  the account-liveness restrictive policy, both content triggers and the RPC.
- Deleted it from the ⋯ menu; the thread returned to "No comments yet." and the
  count cleared. No test data left behind.
- `/ad/dca6f317-…1883` renders: back-to-Feed, publisher header with logo, name,
  verified tick and "Sponsored", the full image, the action row and the thread.

## Not built

- **Admin engagement column** in `/admin/advertisements`. Counts are readable
  via the RPC; the panel does not show them yet.
- **Comment reactions and pinning** on ad comments — deliberate; both are
  additive later.
- `AdminCommentReports` does not yet render the ad side of `ad_comment_id`, so
  an auto-flagged ad comment is stored in the queue but shows without its text.

## Still on hold

**Android build.** The app ships 1071 and contains none of today's work — not
the Instagram corrections, not the tagged notifications, not this.
