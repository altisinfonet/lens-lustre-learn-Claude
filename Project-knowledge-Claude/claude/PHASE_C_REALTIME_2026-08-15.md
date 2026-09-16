# Phase C — Realtime: firehose + 13 dead subscriptions (2026-08-15)

**Commits:** `3019ee1` audit · `e89d45e` gate (7 mutations) · `c9e07eb` evidence. Byte-identical on origin, 0 unpushed. Suite **1,610 passed | 1 skipped**, tsc clean, security-audit PASS.

Closes the plan's **risk #2** ("realtime firehose, decision pending"). It turned out to be two separate things, and the second is a live defect.

## Verified first: the repo tells the truth about what is published
The publication set derived from migrations (ADDs minus later DROPs) and the live `pg_publication_rel` **match exactly** — 29 tables, zero drift either way. That is what makes a repo-derived gate honest rather than a snapshot of a belief.

## Part 1 — 13 of 52 subscriptions cannot fire
`postgres_changes` delivers nothing for an unpublished table. The channel connects, `.subscribe()` reports `SUBSCRIBED`, no error anywhere. Silence is indistinguishable from "nothing has changed yet".

**This was not an oversight — it was a deliberate removal with no reason recorded.**
- `20260526114954` — the whole file is `ALTER PUBLICATION supabase_realtime DROP TABLE public.site_settings;`
- `20260526133827` — drops `judge_decisions`, `judge_scores`, `judge_comments`, `judge_tag_assignments`, `judge_sessions`.

Five lines of SQL, not one word of explanation, and the client code that depended on them was left running. Then `20260722110000` put three back and *does* say why — *"so the Admin panel can watch judge markings live"*. It re-added `judge_scores`, `judge_activity_logs`, `judge_decisions`. **It did not re-add `judge_tag_assignments`** — which under Judging v5 is the table every decision is written to (`evaluate-round2`'s own header, and that function now returns `410 Gone`).

**So the repair restored live updates for the superseded decision tables and left the current one dark.**

What it costs:
- **`EntryTagStamps`** fetches on mount, then subscribes. Fetch works; subscription never fires → a judge sees the tag state from when they opened the photograph and nothing after, including a colleague's tag placed seconds later. `useMultiJudgeProgress` (`judge_sessions`) same.
- **`liveAdminSync`** exists to push an admin's setting change to clients. Its `site_settings` leg is dead; its `user_roles` leg *in the same channel* works. One channel, two legs, one silently amputated.
- **`admin_notifications`** is subscribed from a **member-facing** hook (`useRealtimeFeed.ts:281`) plus two admin screens. Dead in all three.

**Blast radius: `judge_tag_assignments` holds 0 rows, none in 30 days** — no round running, so nobody has been shown a stale board yet.

## Part 2 — The firehose, measured
28 of 52 subscriptions have no filter. `useRealtimeFeed` alone opens **nine** unfiltered legs per signed-in member (posts ×3, post_reactions ×2, follows ×2, friendships ×2).

Rows created last 7 days: `post_reactions` **314**, `posts` 39, `follows` 30, `friendships` 11. So ~45 reactions/day considered for delivery to every connected member — nothing today. The shape is the finding: cost grows as *(connected clients × changes)*, and both factors are what a growing platform grows. 11 subscriptions *are* correctly filtered — the right pattern already exists here.

## Decisions for the owner
- **D1 — publish or delete each of the 13?** My reading: publish `judge_tag_assignments` + `judge_sessions` (correctness, and `EntryTagStamps` already filters by `entry_id` so no added load); publish `site_settings` **or** delete the dead leg — today it is neither; delete `admin_notifications` from the member hook; delete the small config-table subscriptions.
- **D2 — do `posts`/`post_reactions` stay unfiltered?** Not urgent; the repair (broadcast from a trigger) is a design change.
- **D3 — should a dead subscription be able to arrive unnoticed?** No argument on the other side; **shipped**, needs no decision.

## Shipped
`docs/realtime-firehose-decision.md` · `src/__tests__/realtimeSubscriptions.test.ts` — every subscription must name a table the repo's own migrations published (and did not later drop), or be in `DEAD_SUBSCRIPTIONS` with what it awaits. Expected publication **derived at run time**, never hardcoded.

**7 mutations**, all behaved. The sharpest: making the derivation *order-insensitive* (drops applied after adds) was caught by the positive control on `judge_scores` — the one table dropped in May and re-added in July, and therefore the only one that distinguishes an ordered derivation from an unordered one.

The positive control **deliberately fails when D1 is decided**: it asserts `judge_tag_assignments` is not published, so the day it is, the test tells whoever did it to flip the expectation and delete the ledger entry in the same change. That makes the record move *with* the decision — which is exactly what did not happen in May.
