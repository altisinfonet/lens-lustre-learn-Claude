# Realtime: the firehose, and thirteen subscriptions that cannot fire (Phase C)

**Question the plan asks:** should the platform keep subscribing to whole tables, and what does it cost?

**What the measurement actually found is two separate things, and the second is a live defect:**

1. **The firehose is real but small today.** 28 of 52 client subscriptions listen to a whole table with no filter, including `posts` and `post_reactions` — the two busiest.
2. **13 of the 52 subscriptions can never fire at all.** Their table was deliberately removed from the realtime publication in May 2026, in two migrations with **no comment explaining why**, and the client code that depended on them was left in place. It still subscribes, still reports success, and receives nothing.

Measured 2026-08-15 against production `jtdtehuqtinjxropkkcn` and the repository at `3dcd44d`. Read-only.

**One reassuring result first:** the publication set derived from the repository's migrations and the live publication **match exactly** — 29 tables, zero drift, in either direction. Whatever else is wrong here, the repo is telling the truth about what is published.

---

## Part 1 — The thirteen that cannot fire

`postgres_changes` delivers nothing for a table that is not in the `supabase_realtime` publication. The channel still connects, `.subscribe()` still reports `SUBSCRIBED`, and no error is raised anywhere. Silence is indistinguishable from "nothing has changed yet."

| Table | Subscriptions | Where |
|---|---|---|
| `judge_tag_assignments` | 2 | `EntryTagStamps.tsx:81`, `useJudgePhotoData.ts:200` |
| `admin_notifications` | 3 | `AdminLayout.tsx:63`, `AdminNotifications.tsx:86`, `useRealtimeFeed.ts:281` |
| `admin_vote_adjustments` | 2 | `useCompetitionVoteRealtime.ts:36`, `usePhotoVoteCount.ts:37` |
| `site_settings` | 1 | `liveAdminSync.ts:109` |
| `judge_comments` | 1 | `useJudgePhotoData.ts:204` |
| `judge_sessions` | 1 | `useMultiJudgeProgress.ts:123` |
| `judging_preflight_log` | 1 | `PreflightStatusBadge.tsx:48` |
| `badge_definitions` | 1 | `useBadgeDefinitions.ts:30` |
| `role_display_config` | 1 | `useRoleDefinitions.ts:29` |

### This was not an oversight in the publication — it was a deliberate removal with no reason recorded

Two migrations did it, and between them they contain **five lines of SQL and not one word of explanation**:

- `20260526114954_…sql` — the entire file is `ALTER PUBLICATION supabase_realtime DROP TABLE public.site_settings;`
- `20260526133827_…sql` — the entire file drops `judge_decisions`, `judge_scores`, `judge_comments`, `judge_tag_assignments`, `judge_sessions`.

Then on 2026-07-22, `20260722110000_realtime_judging_tables.sql` put three of them back, and that one *does* say why: *"so the Admin panel can watch judge markings live."*

**It re-added `judge_scores`, `judge_activity_logs` and `judge_decisions`. It did not re-add `judge_tag_assignments`.**

Under Judging v5 that is exactly backwards. `evaluate-round2`'s own header states the position: *"all decision-making flows through admin-defined tag clicks which write directly to `judge_tag_assignments`"*, and that function now returns `410 Gone` precisely because the old path is dead. So the repair restored live updates for the **superseded** decision tables and left the **current** one dark.

### What that costs, concretely

- **`EntryTagStamps`** fetches tags on mount and then subscribes for changes. The fetch works; the subscription never fires. So a judge sees the tag state as of when they opened the photograph, and nothing after — including a colleague's tag placed thirty seconds later. `useMultiJudgeProgress` (`judge_sessions`, also unpublished) is the multi-judge coordination view, so the same is true there.
- **`liveAdminSync`** is the mechanism that pushes an admin's setting change out to connected clients. Its `site_settings` leg is dead; its `user_roles` leg, in the same channel, works. One channel, two legs, one silently amputated. A changed site setting now reaches clients only when something else happens to refetch.
- **`badge_definitions` / `role_display_config`** are small config tables; live updates there are a nicety, not a defect.
- **`admin_notifications`** is subscribed from a *member-facing* hook (`useRealtimeFeed.ts:281`) as well as two admin screens. Dead in all three.

**Blast radius today:** `judge_tag_assignments` holds **0** rows and has had none in 30 days — no judging round is running, so nobody has yet been shown a stale board. Found before it was exercised.

---

## Part 2 — The firehose

`postgres_changes` without a `filter` asks the server to consider **every** change on that table for **every** connected subscriber, and to decide per subscriber whether their RLS policies permit delivery. The work grows with *(connected clients × changes)*, not with either alone. That is why a filter, or a broadcast fanned out from a trigger, is the shape for a busy table.

**28 of 52 subscriptions have no filter.** The busiest:

| Table | Unfiltered subs | Rows created last 7 days | Last 30 days |
|---|---|---|---|
| `post_reactions` | 2 (INSERT, DELETE) | **314** | 917 |
| `posts` | 3 (INSERT, UPDATE, DELETE) | 39 | 154 |
| `follows` | 2 (INSERT, DELETE) | 30 | 284 |
| `friendships` | 2 (UPDATE, DELETE) | 11 | 169 |

`useRealtimeFeed` alone opens **nine** unfiltered legs for every signed-in member: posts ×3, post_reactions ×2, follows ×2, friendships ×2.

So today, every reaction anyone gives is considered for delivery to every connected member — roughly **45 a day** across a handful of concurrent clients. That is nothing. The shape is what matters: the cost is a product, and both factors are the ones a growing platform grows.

**Eleven subscriptions are correctly filtered** (`user_notifications` by `user_id`, `friendships` by `addressee_id`, `scheduled_posts` by `user_id`, `profiles` by `id`, and so on) — the pattern already exists in this codebase and is used well where somebody thought about it.

---

## The decision the plan asks for

Three questions, and they are genuinely the owner's:

**D1 — Do the thirteen dead subscriptions get their tables published again, or get deleted?**
Publishing costs firehose load; deleting costs the feature. They should not all go the same way. My reading of the evidence:
- `judge_tag_assignments` and `judge_sessions` — **publish**, with a filter. Judging v5 routes every decision through them and a stale board is a correctness problem in the one place this platform sells fairness. `EntryTagStamps` already filters by `entry_id`, so it would not add firehose load.
- `site_settings` — **publish**, or delete `liveAdminSync`'s dead leg. Today it is neither: a mechanism that exists, looks alive, and does nothing.
- `admin_notifications` in `useRealtimeFeed.ts:281` — **delete**. It is an admin table subscribed from a member-facing hook.
- The rest are small config tables; deleting the subscription is honest and cheap.

**D2 — Do `posts` and `post_reactions` stay unfiltered?**
Not urgent at 45 reactions a day. It becomes the dominant realtime cost long before it becomes visible, and the repair (broadcast fanned out from a trigger to only interested clients) is a design change, not a patch.

**D3 — Should a subscription to an unpublished table be allowed to fail silently?**
This is the one with no argument on the other side. Whatever is decided about D1 and D2, the fourteenth dead subscription should not be able to arrive unnoticed. That part is shipped with this document — see below — and needs no decision.

---

## What shipped alongside this

`src/__tests__/realtimeSubscriptions.test.ts` — every `postgres_changes` subscription in the client must name a table the repository's own migrations have added to `supabase_realtime` (and not later dropped), or be listed in `DEAD_SUBSCRIPTIONS` with what it is waiting on. The expected publication is **derived from the migrations at run time**, never hardcoded, so it cannot drift from the SQL that produces it — and it was verified to match production exactly on the day it was written.

It does not delete or publish anything. Which way each of the thirteen goes is D1, and a test that picked would be making that call by default.

**Nothing was changed by this audit.** A source scan, the publication catalogue, and six counting queries.
