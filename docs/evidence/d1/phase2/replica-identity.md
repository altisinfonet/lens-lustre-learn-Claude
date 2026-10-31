# P2 · replica identity of every table in `supabase_realtime` (production) — and why

Units 2-D1-03 / 2-D1-05 (A-2), ruled by R-61 and narrowed by R-62. Applied by
`supabase/migrations/20260920_0002_p2_replica_identity_production.sql` (production lane only).
Harness: `p2-0002-run-tests.sh`, transcript `p2-0002-transcript.txt`.

**Source:** the Owner's production reading, 2026-09-26 18:50 UTC (`claude/2026-09-27-AUDITOR-PHASE-2-PRODUCTION-READING.sql`,
key `publication`), as recorded verbatim in R-62. 29 tables: 26 `d`, 3 `f`. D1 did not read production.

## One line per table (29)

| # | table | before (reading) | after 0002 | why |
|---|---|---|---|---|
| 1 | `public.certificates` | d | d | default; the PK identifies the row |
| 2 | `public.competition_entries` | d | d | default; the PK identifies the row |
| 3 | `public.competition_round_publish` | f | **d** (0002) | `f`→`d` by 0002; its filter column (`competition_id`) is inside the PK `(competition_id, round_number)` — every event its subscribers receive today they still receive (harness steps 2/3b) |
| 4 | `public.competition_votes` | d | d | default; the PK identifies the row |
| 5 | `public.competitions` | d | d | default; the PK identifies the row |
| 6 | `public.course_enrollments` | d | d | default; the PK identifies the row |
| 7 | `public.courses` | d | d | default; the PK identifies the row |
| 8 | `public.featured_artists` | d | d | default; the PK identifies the row |
| 9 | `public.follows` | d | d | default; the PK identifies the row |
| 10 | `public.friendships` | d | d | default; the PK identifies the row |
| 11 | `public.gift_announcements` | d | d | default; the PK identifies the row |
| 12 | `public.image_comments` | d | d | default; the PK identifies the row |
| 13 | `public.image_reactions` | d | d | default; the PK identifies the row |
| 14 | `public.journal_articles` | d | d | default; the PK identifies the row |
| 15 | `public.judge_activity_logs` | d | d | default; the PK identifies the row |
| 16 | `public.judge_decisions` | d | d | default; the PK identifies the row |
| 17 | `public.judge_scores` | d | d | default; the PK identifies the row |
| 18 | `public.judging_rounds` | d | d | default; the PK identifies the row |
| 19 | `public.photo_of_the_day` | d | d | default; the PK identifies the row |
| 20 | `public.post_comments` | d | d | default; the PK identifies the row |
| 21 | `public.post_reactions` | d | d | default; the PK identifies the row |
| 22 | `public.post_shares` | d | d | default; the PK identifies the row |
| 23 | `public.posts` | d | d | default; the PK identifies the row |
| 24 | `public.profiles` | f | **f** | **FULL, JUSTIFIED.** `useAuth.tsx`'s ban/suspension guard reads `payload.old` on UPDATE. (DELETE does not need FULL because `id` is the PK; the `useAuth.tsx` comment claiming otherwise is logged for correction, not changed in Phase 2.) |
| 25 | `public.scheduled_posts` | f | **f** | **FULL, JUSTIFIED.** `useScheduledPosts.ts` filters on `user_id`; with DEFAULT a DELETE (a cancelled post) is not delivered to the member's other devices (F-P2-1, measured two ways: harness step 8 and the staging probe below). Low-write table (R-62). |
| 26 | `public.support_tickets` | d | d | default; the PK identifies the row |
| 27 | `public.user_badges` | d | d | default; the PK identifies the row |
| 28 | `public.user_notifications` | d | d | default; the PK identifies the row |
| 29 | `public.user_roles` | d | d | default; the PK identifies the row |

Counts after 0002: **27 `d`, 2 `f`** (`profiles`, `scheduled_posts`) — exactly what 0002's POST-002 asserts.

## `profiles` — the justification, stated with the correct reason
1. **`payload.old` is read on UPDATE.** `useAuth.tsx` ejects a member when an UPDATE moves `is_banned` or `is_suspended`
   from false to true: `wasRestricted = payload.old.is_suspended || payload.old.is_banned`. Under DEFAULT the old-row
   image of an UPDATE is the primary key only (harness step 3b: `U competition_round_publish` carries only
   `competition_id,round_number` once DEFAULT, while `U profiles`, still FULL, carries every column), so
   `wasRestricted` would always be false and the "only on a change" condition would be lost.
2. **DELETE does not need FULL.** Realtime evaluates a DELETE's filter against the old-row image; under DEFAULT that is the
   primary key, and the guard's filter is `id=eq.<id>` — the primary key. The comment at `useAuth.tsx` lines 212–218 says
   otherwise; R-62 logs it for correction and does not change it in Phase 2 (Standing Rule 21).
3. **What made FULL expensive was write volume, and P1 removes it.** After P1's cut-over the decode share (48.2 % at
   the reading) is re-measured; if still material, the Auditor reopens this row.

## `scheduled_posts` — F-P2-1, the reason it keeps FULL (R-62)
Realtime reads the old row to evaluate a subscription's filter on a DELETE. `useScheduledPostsRealtime` filters on
`user_id`, which is not in the primary key `(id)`.

**Measured on staging, 2026-09-26 ~19:15 UTC, read-only**, with Realtime's own `realtime.is_visible_through_filters()`
(`p2-0002-realtime-filter-probe.sql`):

| case | old-row image | delivered |
|---|---|---|
| `scheduled_posts` DELETE, filter `user_id=eq.<me>`, FULL | `id, user_id, …` | **true** |
| `scheduled_posts` DELETE, filter `user_id=eq.<me>`, DEFAULT | `id` | **false** |
| `competition_round_publish` DELETE, filter `competition_id=eq.<c>`, DEFAULT | `competition_id, round_number` | true |
| `competition_round_publish` DELETE, no filter (`useGatedEntryStatus`), DEFAULT | `competition_id, round_number` | true |

**Measured on the scratch fixture** (harness step 8): wal2json run with `realtime.list_changes()`'s own options hands
Realtime `id` alone for a `scheduled_posts` DELETE under DEFAULT, so the filtered DELETE is not delivered.

The only DELETE path for `scheduled_posts` is a member cancelling a pending post (`useCancelScheduledPost`); the
publisher only UPDATEs. Under DEFAULT the member's other tabs and devices would keep showing the cancelled post.
R-62: keep FULL; it is a low-write table.

**Caveat.** The `realtime` schema functions were read on staging. Production's Realtime version was not read; the
probe file is read-only and can be run there to confirm.
