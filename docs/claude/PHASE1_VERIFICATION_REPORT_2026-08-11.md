# Phase 1 — Verification Report

**50mm Retina World · Top Contributors V2 · 2026-08-11**

**Status: COMPLETE. Stopped as instructed. Awaiting approval before Phase 2 or the frontend switch.**

Every figure below is actual output from production or from the repository. Nothing is estimated.

---

## 1. What was created

**Commit `a57bb82` on `main`** — one file, 285 lines, 13,824 bytes.

`supabase/migrations/20260811160000_top_contributors_v2.sql`

Byte-verified after commit:

```
git show origin/main:supabase/migrations/20260811160000_top_contributors_v2.sql \
  | cmp -s - supabase/migrations/20260811160000_top_contributors_v2.sql
→ IDENTICAL ✓
```

**Four database objects, all new:**

| Object | Type |
|---|---|
| `contributor_points_since(_since date)` | function (formula + eligibility, shared) |
| `get_top_contributors_v2()` | function (public) |
| `get_contributor_scores(_user_ids uuid[])` | function (public) |
| `idx_post_comments_user_created` | index on `post_comments (user_id, created_at)` |

Migration executed on production: **`Success. No rows returned`**. No errors, no warnings, no lint dialogs.

---

## 2. What was changed

**Nothing.** No existing table, column, policy, function, trigger or index was altered or dropped.

The migration contains only `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION` on three names that did not previously exist, `COMMENT ON`, `REVOKE` and `GRANT` — all scoped to the new objects.

---

## 3. What was NOT changed

| | |
|---|---|
| `get_top_contributors_v1` | untouched — verified by md5, see §9 |
| Frontend | `git diff 5b7874f..a57bb82 -- src/` → **0 files** |
| The Home page hook | still `supabase.rpc('get_top_contributors_v1')` at `src/hooks/useTopContributors.ts:21` |
| Any other feature | not touched |
| Members | **see nothing different** |

Also not built, as instructed: no score ledger, no daily metrics table, no cache table, no queue jobs, no pgmq handler, no recompute or rollup jobs, no cron, no preservation table, no triggers of any kind, no engagement collector, no backfill script.

---

## 4. Migrations created

One: `supabase/migrations/20260811160000_top_contributors_v2.sql`

---

## 5. Objects created — md5 verified against the committed file

Function bodies computed from the repository file, compared against `pg_proc.prosrc` on production:

| Function | Committed md5 | Live md5 | Length | Match |
|---|---|---|---|---|
| `contributor_points_since` | `0fb5e020ab35f3345b9646c134300c80` | `0fb5e020ab35f3345b9646c134300c80` | 3373 | ✅ |
| `get_top_contributors_v2` | `74713575015ac6b56430482fade16590` | `74713575015ac6b56430482fade16590` | 710 | ✅ |
| `get_contributor_scores` | `d835a4edd4ae09f5d5e673ce99bf1af2` | `d835a4edd4ae09f5d5e673ce99bf1af2` | 146 | ✅ |

**The repository and the live database are byte-identical.** No drift.

**Index created** — live `pg_indexes` for `post_comments`:

```
idx_post_comments_parent_id, idx_post_comments_post_created,
idx_post_comments_post_id, idx_post_comments_user_created ← NEW,
post_comments_pkey
```

---

## 6. RLS and grants verification

No tables were created, so no new RLS policies exist. Security is enforced entirely through function grants.

Live `information_schema.routine_privileges`:

| Function | Grantees |
|---|---|
| `contributor_points_since` | **`postgres`, `service_role` only** |
| `get_top_contributors_v2` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` |
| `get_contributor_scores` | `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role` |

The `REVOKE` worked: the shared helper — which takes any date and returns **every** member's score — is **not callable by `anon` or `authenticated`**. Nobody can enumerate all scores. The two public wrappers reach it because they are `SECURITY DEFINER`.

The two public functions are `anon`-executable, matching `v1`, because the Home page is public. This is exactly why they return nothing but a user id, a position and one number.

---

## 7. Backfill verification

**No backfill script exists or was needed** — the score is calculated live from current data, so all history counts automatically from the first query.

### Independent cross-check of the whole formula

I wrote a **second, separate implementation** of the formula as a plain query and compared it against the deployed function for **every** member:

```
49 users in independent calc / 49 in function
mismatches: 0
max score:  5334
```

**Zero mismatches across all 49 scoring members.** The function agrees exactly with an independently-written implementation.

### Tier ladder — evaluated in the database, every boundary

```
Posts:    1→10  2→20  3→30  4→35  5→40  6→45  7→47  8→49  9→51  10→53  11→53  40→53
Comments: 1→4   4→16  5→20  6→22  15→40  16→41  29→54  30→55  31→55  100→55
```

Boundaries 3/4, 6/7, 10/11 and 5/6, 15/16, 30/31 all behave correctly. Caps hold at 40 posts and 100 comments.

```
1 post          =  255
9 posts         = 1299
10 posts        = 1350
perfect day     = 2400   (posts 45% + comments 35%, engagement 0%)
```

> The **255** figure confirms the correction discussed before execution: the formula takes post *points* (10 for one post), not the post *count*.

---

## 8. Delete and recalculation verification

Run **without modifying a single row** — the scenarios were computed by excluding rows in a read-only query, so nothing on the live site was touched.

Subject: **Dipannita Sen**, the top-scoring member.

| Scenario | Score | Change |
|---|---|---|
| Baseline | **5,334** | — |
| Newest post deleted | **5,079** | **−255** |
| Newest post made private | **5,079** | **−255** |
| Newest comment deleted | **5,296** | **−38** |

Three things this proves:

1. **Deleting a post reduces the score** by exactly the tier-recount amount — not a hard-coded decrement.
2. **A private post contributes exactly nothing.** Making a post private produces the *identical* score to deleting it.
3. **Deleting a comment reduces the score** — here by 38, because on that day it was her 6th–15th comment and therefore worth 2 tier points, not 4. The ladder is being recounted, not subtracted from.

**Tier recount confirmed:** 10 posts = 1,350 → 9 posts = 1,299, a loss of 51, not 135.

Deletion works because **there is no stored score to update.** The next query simply does not find the row.

---

## 9. `get_top_contributors_v1` verification

| | Value |
|---|---|
| `prosrc` md5 | **`6156d9a4b9d6d927b2fe73c3d194f38d`** |
| Length | **711** |
| Expected (pre-migration, recorded in the audit) | `6156d9a4b9d6d927b2fe73c3d194f38d` / 711 |
| **Match** | ✅ **byte-for-byte unchanged** |

Live `v1` output right now:

```
Amit Baran Sen   105.0
Sankar Mandal     73.0
Partha Mukherjee  67.0
```

> Earlier today `v1` returned 104.0 / 72.0 / 65.0 for the same three people. The small increase is **new member activity in the intervening hours**, not a change to the function — its md5 is identical. The Home page is unaffected.

### For comparison, `v2` returns

```
#1  Dipannita Sen    5,334
#2  Amit Baran Sen   3,820
#3  Mainak Mridha    3,668
```

**The top 3 will change when the frontend is switched.** Expected and previously flagged: `v1` counts comments *received*; `v2` counts comments *written*.

### Other behaviour checks

| Check | Result |
|---|---|
| Admin account has real content | `50mm Retina World` — **12 public posts, 4 comments** |
| Admin rows from `get_contributor_scores()` | **0** ✅ |
| Admin rows in `get_top_contributors_v2()` | **0** ✅ |
| `judge` role eligible | **SOMNATH PAL → score 3,285** ✅ |
| Non-public posts on the platform | 0 (filter proven by simulation instead — §8) |
| Orphan comments (author has no profile) | 1 — excluded, counts for nobody ✅ |

The admin exclusion is a strong result: the account has 12 posts and 4 comments that *would* score well, and **both** public functions return **zero rows** for it.

---

## 10. Errors and warnings

**No errors.** The migration returned `Success. No rows returned` on the first run.

### One honest correction to a claim I made

In the plan I said `v2` would be **faster** than `v1` because it avoids the Cartesian join. **Measured on production, that is wrong today:**

| | Execution time | Shared buffers |
|---|---|---|
| `get_top_contributors_v1()` | **8.58 ms** | 1,441 |
| `get_top_contributors_v2()` | **16.48 ms** | 2,197 |

`v2` costs about **twice** as much right now, because it makes two passes (rolling 30 days *and* lifetime) and joins `profiles` and `auth.users` for the eligibility filter, while `v1` makes one pass with no eligibility check at all. At 193 posts the Cartesian join is cheap, so avoiding it buys nothing yet.

Both are negligible against a ~1.6 s Home TTFB. The picture reverses as the platform grows — that is the point of the next line — but I should not have claimed a win I had not measured.

### The Cartesian claim itself IS verified

| Measure | Rows |
|---|---:|
| Source posts in the last 30 days | **137** |
| `v1` intermediate rows after its 3-way join | **1,047** ← 7.6× multiplication |
| `v2` post-day aggregate rows | **135** |
| `v2` comment-day aggregate rows | **60** |

`v1` explodes 137 rows into 1,047. `v2` never exceeds its sources — 195 rows total. The multiplication is gone; it simply does not matter yet at this size.

### Two minor notes

- The Supabase editor's RLS lint dialog appeared once during verification, for a scratch probe I had written. **I cancelled it — nothing ran, no table was created.** The migration itself triggered no dialog.
- `image_comments` holds **0 rows**, so it contributes nothing today. It is included in the calculation for correctness and deliberately has no index yet.

---

## 11. Exact rollback procedure

```sql
DROP FUNCTION IF EXISTS public.get_top_contributors_v2();
DROP FUNCTION IF EXISTS public.get_contributor_scores(uuid[]);
DROP FUNCTION IF EXISTS public.contributor_points_since(date);
DROP INDEX  IF EXISTS public.idx_post_comments_user_created;
```

Then, optionally, delete `supabase/migrations/20260811160000_top_contributors_v2.sql` via the GitHub web editor.

**Why this is completely safe:**

- Every object is new. Nothing existing was modified, so there is nothing to restore.
- The frontend never called the new functions, so dropping them cannot break a page.
- `v1` is untouched and still serving the Home page — **rollback is invisible to members even while it happens.**

---

## STOPPED

Phase 1 is complete and verified. **I have not started the frontend switch and I have not started Phase 2 (Active Engagement).**

Two things need your approval, separately:

**Phase 3 — frontend.** Switch `useTopContributors.ts` to `v2` and put the Contributor Score under the member's name with the count-up animation. **This is the moment the top 3 visibly changes** to Dipannita Sen, Amit Baran Sen and Mainak Mridha.

**Phase 2 — Active Engagement.** The separate collector project: web + Android, foreground and idle detection, UTC minute buckets, `/admin/*` and `/judge/*` excluded, 30-minute daily cap, admin reporting.

Neither will begin without you saying so.
