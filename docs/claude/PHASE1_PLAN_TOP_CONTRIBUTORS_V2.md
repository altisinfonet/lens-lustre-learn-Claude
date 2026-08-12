# Phase 1 — Top Contributors V2

**50mm Retina World · 2026-08-11 · PLAN ONLY — awaiting YES**

---

## What this is

Three small database functions and one index. Nothing else.

**Phase 1 changes nothing a member can see.** The Home page keeps calling `get_top_contributors_v1`. The new functions sit beside it, unused, until you have seen the verification and approved the frontend switch.

---

## 1. What I am building

| # | Object | Purpose |
|---|---|---|
| 1 | `contributor_points_since(_since date)` | the formula — **written once**, used by both public functions |
| 2 | `get_top_contributors_v2()` | Home page top 3 |
| 3 | `get_contributor_scores(_user_ids uuid[])` | the number under a member's name |
| 4 | `idx_post_comments_user_created` | index on `post_comments (user_id, created_at)` |

**Why three functions and not two:** the scoring maths lives in exactly one place. If it lived in two functions it could drift, and the leaderboard would eventually disagree with the badge. One helper, two callers.

One migration file: `supabase/migrations/20260811160000_top_contributors_v2.sql`

---

## 2. The formula

### Daily tiers

**Posts** (max 53/day)

| Posts that day | Points each |
|---|---|
| 1st – 3rd | 10 |
| 4th – 6th | 5 |
| 7th – 10th | 2 |
| 11th onward | 0 |

**Comments written** (max 55/day)

| Comments that day | Points each |
|---|---|
| 1st – 5th | 4 |
| 6th – 15th | 2 |
| 16th – 30th | 1 |
| 31st onward | 0 |

### Weighting

```
daily_score = 3 × ( 450 × post_points/53  +  350 × comment_points/55  +  0 )

Contributor Score = SUM(daily_score) over every UTC day
```

- **Posts 45%, Comments 35%, Engagement 0%.** The unused 20% is **not** redistributed — a perfect day is 2,400 out of a possible 3,000. When Phase 2 lands, the missing 600 becomes available and nothing already earned changes.
- `× 3` is the scale constant (`SCORE_SCALE`). It makes the numbers read like 5,334 instead of 1,778. It changes no ranking and no proportion — one line to adjust later.
- Diminishing returns mean **consistency beats bursts**: one photo a day for 30 days = 7,641. Thirty photos in one day = 1,350.

### Worked check

| A day of… | Score |
|---|---:|
| 1 post | 255 |
| 3 posts | 764 |
| 10 posts | 1,350 |
| 40 posts | 1,350 (cap holds) |
| 5 comments | 382 |
| 30 comments | 1,050 |
| 10 posts + 30 comments | **2,400** (the Phase 1 maximum) |

**Deletion behaves as you specified:** 10 posts = 53 raw points. Delete one → 9 posts = 51 raw points. The day is recounted from the surviving rows, so 53 → 51, never 53 → 43. There is no subtraction anywhere in the code.

---

## 3. What counts

**Posts** — `posts` where `privacy = 'public'`. Private and friends-only earn nothing. Deleted posts do not exist, so they do not count.

**Comments written** — `post_comments` (every row that exists) plus `image_comments` where `is_flagged = false`.

- Ad comments are excluded automatically — they live in `ad_creative_comments`, a different table.
- Comments *received* on your photos count for nothing.
- No new duplicate-detection, no text scoring, no AI. Existing rules only.

**Day boundary** — `(created_at AT TIME ZONE 'UTC')::date`. UTC always, never the browser's timezone.

**Rolling window** — `utc_date >= (now() AT TIME ZONE 'UTC')::date - 29`, i.e. the 30 UTC days ending today. It moves forward on its own when the date changes; there is no job and no stored window.

---

## 4. Who is eligible

```
profile row exists          ← your deleted-profile rule
AND auth user still exists
AND is_suspended = false
AND is_banned    = false
AND no user_roles row with role = 'admin'
```

**`admin` is the only role excluded.** `judge`, `content_editor`, `registered_photographer`, `student` and `user` are all eligible.

### Your deleted-profile rule, and why it needs no maintenance

> *"If any profile deleted then instantly this record will be refreshed too."*

The score is calculated at the moment it is asked for, joined to `profiles`. **There is no stored record to refresh.** The instant a profile row is gone, that member has no score and cannot appear on the leaderboard — on the very next query. No job, no cache to invalidate, nothing that can be forgotten.

Verified live today: **Payel Kundu Basu's profile is gone**, and there is **1 orphan comment** whose author no longer has a profile. Under v2 that comment counts for nobody, automatically.

This is also a real fix. `v1` has **no such guard** — it groups by `posts.user_id` with no join to `profiles`, so a deleted member with surviving content would still rank, rendered as "Photographer" with a blank avatar.

---

## 5. Function behaviour

**`get_top_contributors_v2()`** → `(user_id uuid, position int, contributor_score integer)`

Ranked by the **rolling 30-day** score. Returns the **lifetime** Contributor Score for display. Top 3.

The 30-day number is **never returned**, so it cannot be displayed by accident. No engagement data, no formula internals, no counts.

**`get_contributor_scores(_user_ids uuid[])`** → `(user_id uuid, contributor_score integer)`

Batched, so a feed rendering 20 cards makes one request rather than 20 — reusing the coalescing pattern already proven in `src/lib/ads/adEngagement.ts`.

All three functions: `STABLE`, `SECURITY DEFINER`, `SET search_path = 'public'`. `EXECUTE` granted to `anon` and `authenticated` — the Home page is public, as `v1` already is.

---

## 6. No Cartesian join

`v1` joins `posts` against `post_reactions` and `post_comments` in one query — a post with 10 reactions and 8 comments produces 80 intermediate rows.

V2 aggregates each side independently and combines the **totals**:

```
posts    → count per (user, UTC day) → tier ladder ─┐
                                                    ├→ full outer join on (user, day)
comments → count per (user, UTC day) → tier ladder ─┘
                                                    → weighted sum per user
                                                    → eligibility filter
                                                    → rank → top 3
```

Row counts stay linear. No multiplication.

---

## 7. What I am NOT building

Explicitly, per your verdict:

- ❌ No score ledger, no stored score
- ❌ No daily metrics table
- ❌ No cache tables
- ❌ No queue jobs, no pgmq handler
- ❌ No recomputation or rollup jobs
- ❌ No scheduled/cron work
- ❌ No preservation table
- ❌ No BEFORE DELETE or AFTER DELETE triggers
- ❌ No engagement collector, no engagement tables
- ❌ No backfill script — live calculation *is* the backfill
- ❌ No changes to `get_top_contributors_v1`
- ❌ No frontend changes in Phase 1
- ❌ No changes to any other feature

**Cascade deletion:** if deleting a post removes its comments through the existing database cascade, those comments stop counting. Accepted for Phase 1, as you decided.

---

## 8. Expected result

Computed from live data today (before the ×3 scale, these were 1,778 / 1,273 / 1,223):

**Top 3 by rolling 30 days, with Contributor Score shown:**

| | Member | Contributor Score |
|---|---|---:|
| 🥇 | Dipannita Sen | **5,334** |
| 🥈 | Amit Baran Sen | **3,819** |
| 🥉 | Mainak Mridha | **3,669** |

**This is different from what the Home page shows today** (Amit Baran Sen, Sankar Mandal, Partha Mukherjee — verified live an hour ago).

The reason is your own rule: `v1` counts comments **received** on your photos; v2 counts comments **written**. Dipannita and Amit are the members actually engaging with everyone else's work, and the old formula gave them nothing for it.

Nobody sees this change until you approve Phase 3.

---

## 9. Verification I will run and report

| # | Check |
|---|---|
| 1 | `v2` top 3 matches the hand-calculated table above, exactly |
| 2 | `v1` still exists, `prosrc` md5 still `6156d9a4b9d6d927b2fe73c3d194f38d`, length 711 |
| 3 | `v1` still returns Amit / Sankar / Partha — unchanged behaviour |
| 4 | The `admin` account has a score but never appears in `v2` |
| 5 | A `judge`-role account **is** eligible |
| 6 | The 1 orphan comment (author has no profile) counts for nobody |
| 7 | Tier ladder verified at every boundary — 3/4, 6/7, 10/11 posts; 5/6, 15/16, 30/31 comments — by evaluating the expression against a fixed list, touching no data |
| 8 | Total public posts counted by v2 = `SELECT count(*) FROM posts WHERE privacy='public'` |
| 9 | A day at 23:59 UTC and 00:01 UTC land on different UTC dates |
| 10 | `EXPLAIN` shows the new index used, and no row multiplication |
| 11 | Both public functions executable by `anon`; neither returns the 30-day score |

I will paste the **actual output** of each, not a summary.

---

## 10. Rollback

```sql
DROP FUNCTION IF EXISTS public.get_top_contributors_v2();
DROP FUNCTION IF EXISTS public.get_contributor_scores(uuid[]);
DROP FUNCTION IF EXISTS public.contributor_points_since(date);
DROP INDEX  IF EXISTS public.idx_post_comments_user_created;
```

Four statements. Everything is additive — no existing object is altered, so there is nothing to restore. And since the frontend still calls `v1` throughout Phase 1, **rolling back is invisible to members even while it happens.**

---

## 11. Steps

1. Write the migration file locally.
2. Upload to GitHub through the web editor (push is blocked) and byte-verify with `git show origin/main:… | cmp -s -`.
3. Run it on production via the Supabase SQL editor.
4. Run all 11 verification checks.
5. **STOP.** Report and wait.

---

## 12. After Phase 1

Nothing happens without your explicit approval.

- **Phase 3** (frontend) — switch the hook to `v2`, put the Contributor Score under the name with the count-up animation. This is the moment the top 3 visibly changes.
- **Phase 2** (Active Engagement) — a separate project: web + Android collector, foreground and idle detection, UTC minute buckets, `/admin/*` and `/judge/*` excluded, 30-minute daily cap, admin reporting.

I will not begin either automatically.

---

**Say YES and I start.**
