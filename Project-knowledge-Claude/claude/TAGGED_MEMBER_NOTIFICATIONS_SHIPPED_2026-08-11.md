# Tagged members now get the post's like and comment notifications — shipped 2026-08-11

Supersedes the finding in `claude/TAG_NOTIFICATION_FANOUT_FINDING_2026-08-11.md`.

## What the owner asked for

> "Build like All tagged person will get all notification untill bering removed
> the tag. This is the normal you buld worng."

And, when asked whether the tag must be approved first:

> "Here is Approval of Tag is not required, I asked if tagged automcatically
> tagging will happedned just anyone can remove himself from tag On post
> 'Remove me from tag', so why approval of tag is coming ??"

He is right, and the app already worked that way — his 2026-08-10 ruling
("Show immediately to public, but tagged person only can remove my Tag
anytime") is what `TaggedPeople.tsx` and "Remove tag of me" implement. So a tag
is treated as **live** while its status is `pending` or `approved`, and the
notifications stop the instant it becomes `removed` or `declined`. There is no
approval gate anywhere in this.

Channels: **in-app + push, no email** (his choice, from the volume figure — 19
tags × 16 likes × 8 comments would have been up to 480 emails from one post).

## Shipped

Two new notification types: `tagged_post_reaction`, `tagged_post_comment`.

**Database** — `supabase/migrations/20260811090000_tagged_members_get_post_notifications.sql`,
run by hand in the Supabase SQL editor:

1. `notif_action_phrase` — two new phrases ("reacted to a photo you are tagged
   in.", "commented on a photo you are tagged in."). No apostrophe, because the
   parity test's regex cannot see past one and a SQL literal would need it
   doubled.
2. `notif_group_key` — both types join the "noisy" list, so 16 likes collapse
   into ONE bell line per day, exactly as they already do on your own photo.
3. `get_notification_email_enabled` — both types pinned to `false`, placed above
   the `ELSE true` catch-all.
4. `pj_handle_reaction_notification` — after the owner's row, a loop over live
   tags. Excludes the actor and the post owner.
5. `pj_handle_comment_notification` — same, and also excludes the parent-comment
   author, who already gets `comment_reply` about that exact comment.

One deliberate behaviour change: the reaction handler used to `RETURN` early
when the owner liked their own photo. That is now a guard around the owner's
row only, so a self-like still reaches the tagged people. No existing recipient
gains or loses a row.

The dedup key carries the recipient id
(`tagged_post_reaction:<reaction>:<user>`). Without that, the unique index
`uniq_user_notifications_dedup_key` would have let the first tagged member
through and silently swallowed the other 18.

**Client**

- `describe.ts` — two `ACTION_CATALOG` entries, with plural forms for the
  grouped case.
- `notificationLinks.ts` — both types open `/post/<id>`, not `/dashboard`.
- `NotificationBell.tsx` — Heart / MessageCircle icons, category "Photo Tags".

**Tests** — `src/__tests__/taggedPostNotifications.test.ts`, 21 tests pinning
the four rules that matter, all comment-stripped so they cannot pass by matching
their own documentation. `pushCatalogParity.test.ts` now finds the LATEST
migration defining the catalog rather than a hard-coded filename, so the next
change cannot silently compare the app against a superseded copy.

## Gates

tsc clean · `npx vite build` ✓ · vitest **1092 pass / 2 fail** (the two known
judging tests, P10, unrelated) · security audit PASS · four mutations each
turning exactly the expected test red.

## Live verification

- All six files byte-verified on `origin/main` with
  `git show origin/main:<path> | cmp -s - <path>`.
- **The deployed database source is byte-identical to the committed migration.**
  md5 of each function body computed from the file and compared to `pg_proc`:

  | function | md5 | len |
  |---|---|---|
  | `notif_action_phrase` | `8af8d9f4cb8b14f1135647b94e534ad1` | 962 |
  | `notif_group_key` | `38b48062bd15e933c4d93185ea6469ab` | 429 |
  | `get_notification_email_enabled` | `275bb7a679a9320fa21ea45d4b71a282` | 2264 |
  | `pj_handle_reaction_notification` | `a774049856fe5243f9c8994b64e77128` | 2729 |
  | `pj_handle_comment_notification` | `2aff8272e868837e7bff2c371b298839` | 3142 |

  (The first run differed by 8 characters of comment decoration; the two
  handlers were re-run from the file so the record is exact.)
- **Nothing else changed.** A behaviour fingerprint of
  `get_notification_email_enabled` over 3 real users × 27 existing types was
  taken before and after: `bb2e1b136cc8e75f2fa8ab68b95de09a` both times.
- No accidental function overloads: `duplicate_overloads = 0`.
- New phrases, `email_enabled = false` for both types, and a day-bucketed group
  key all confirmed by calling the live functions.
- Deployed web bundle scanned: 29 asset files, the new phrase and the new type
  both present.
- Recipient check on production: the one post that carries a live tag
  (`da13f68b-…8b45`, 1 tag, status `pending`) resolves to **AVIJIT SHEEL** as
  the person the next like or comment will notify.

## Still open

- **Android build is NOT cut.** The app still ships 1071 and contains none of
  this. Waiting on his go-ahead.
- **Sponsored ads need Like / Comment / Share** (his second instruction the same
  day). Nothing exists for it: `ad_creatives`, `ad_impressions` and
  `ad_conversions` are the only ad tables — no reactions, no comments, no
  shares. He chose the full build plus a new `/ad/<id>` permalink page. Not
  started.
