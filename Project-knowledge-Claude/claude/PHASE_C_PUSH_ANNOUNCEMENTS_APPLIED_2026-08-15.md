# Phase C — Announcements Push Switch: APPLIED (2026-08-15)

**Applied version:** `20260815064043_push_announcements_switch` (connector-assigned — **drift #14**, both repo files renamed to match).
**Authorised against:** `GO c314554c5ebbbec4c746cc0f0612c9488fda8cd3` (owner, 2026-08-15).
**Commits:** `a4f616b` migration · `2fe9134` rollback · `a575e55` hook · `ad8159d` gate · `4a028d1` page · `f781c1d` evidence. All seven files byte-identical on origin; 0 unpushed. Suite **1,600 passed | 1 skipped**, tsc clean, security-audit PASS.

## What it closes
N2 of the notification matrix. `journal_published` and `course_published` are deliberately barred from **email** under BUG-038 ("mass broadcast types never email the whole base"), then fell through `push_on_notification`'s CASE to `ELSE true` and reached **every registered device**. The only defence was `push_enabled`, which also silences comments and follows.

## What shipped
- `notification_preferences.push_announcements` — `NOT NULL DEFAULT true`. Owner chose default ON: the reach is wanted; the opt-out was what was missing.
- One `WHEN` branch, placed **below** the specific category branches (so it shadows none) and **above** `ELSE true` (so it cannot fall through).
- Settings page: "Announcements from 50mm Retina World", in the push section, disabled when the master switch is off. **Visible to members only after the next app build.**

## Deliberately NOT included — on the record
- **`new_competition`** is not re-pointed at the new column. It already has `push_competition_updates`, a switch members understand; moving it would silently change behaviour for anyone who had set it.
- **`birthday`** (`emit_birthday_notifications`) also fans out daily and is also ungated in push, but it is *social*, not a platform announcement. Folding it in would decide a separate product question inside a migration approved for a different one.

## Proof
Rehearsed **before** apply inside one `DO` block ended by `RAISE EXCEPTION`, then repeated on the **applied** function. Identical both times:

| Probe | Setting | Result |
|---|---|---|
| journal_published | announcements ON | **1** push (expect 1) |
| journal_published | announcements OFF | **0** (expect 0) |
| course_published | announcements OFF | **0** (expect 0) |
| post_comment + new_competition | announcements OFF | **2** (expect 2) — shadows nothing |

Rollback-file body was md5-compared against the live definition *before* being written — 2067 bytes, `23007fdc…`, exact match; the migration diffs from it by exactly one line. After each rehearsal: column absent, function md5 restored, 0 probe rows, preferences untouched.

**7 mutations**, all caught: branch deleted · moved above the competition branch · moved below `ELSE true` · master switch moved below it · hook default flipped to false · `?? true` fallback removed · page toggle rebound to another column.

## SELF-CAUGHT: I measured a moving baseline and called it proof
The first rehearsal counted **total** rows in `net.http_request_queue` before/after each probe. That queue is not a still pond — `net._http_response` shows the platform's own cron workers posting through it roughly **every 10 seconds**. A cron request landing mid-probe would have inflated a delta, and I would have reported a push that did not happen (or masked one that did). I noticed only because a follow-up count read `1` where it should have read `0`, and chased it instead of dismissing it.

Re-ran the whole post-apply verification counting **only** queue rows carrying a unique probe marker, which cron traffic can never match: same result, 1/0/0/2. Same class as the CDN probe that measured GitHub's CSP instead of the CDN — right number, wrong method, and the method is what fails silently next time.

**Proven no member was contacted:** `push_delivery_log` still 60 rows with its newest entry dated 2026-08-02, and zero non-cron entries in `net._http_response` in the last 30 minutes.

## Owner decision also recorded this cycle
The five dead switches (`inapp_reactions`, `inapp_comments`, `inapp_social`, `inapp_competitions`, `email_weekly_digest`) **stay as they are**, by explicit instruction after being shown the reasoning both ways. They remain declared in `notificationPreferenceWiring.test.ts` so a sixth cannot appear silently. Standing consequence, stated once and not repeated: "Weekly Digest" continues to offer members an email that does not exist.

## Next unblocked Phase C items
backup/RESTORE proof (a restore executed, not assumed) · realtime firehose decision · `/profile` unbounded queries · CDN economics.
