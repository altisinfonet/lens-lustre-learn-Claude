# PHASE A — APPLIED TO PRODUCTION AND VERIFIED

**Date:** 2026-08-12 · **Migration `20260812040000_category_taxonomy.sql` is LIVE.**
**`main` untouched · Create/Post flow untouched · Phase B not started.**

Applied via the Supabase Management API (`POST /v1/projects/{ref}/database/query`) because the
dashboard UI does not render in a minimised window. The SQL was **hash-verified in the browser
before execution** — `3157200067 / 14713 bytes`, byte-identical to the file on the branch
(`sha256 31acba7d…`).

---

## MIGRATION OUTPUT (first run, production)

```
categories_seeded          = 46
categories_active          = 46
members_with_interests     = 77
interests_NOT_in_taxonomy  = 0
interests_still_uppercase  = 0
distinct_interest_slugs    = 15
LABELS_DROPPED             = 0
labels_dropped_detail      = none
```

---

## THE NINE REQUESTED CHECKS — ACTUAL PRODUCTION RESULTS

| # | Check | Result |
|---|---|---|
| 1 | `public.categories` exists | ✅ **yes** |
| 2 | Exactly 46, matching the approved taxonomy | ✅ **46 live, 46 approved, 0 missing, 0 extra — EXACT MATCH.** `sort_order` 1–46, no duplicate slugs, no bad slug format. First seven: `wildlife, portrait, street, landscape, macro, travel, aerial` |
| 3 | `All` is not a database category | ✅ **0 rows** with slug or name `all` |
| 4 | `Astrophotography` migrated to `astro` | ✅ **20 members now hold `astro`; 0 still hold `Astrophotography`** |
| 5 | Zero labels lost or unmapped | ✅ **`interests_NOT_in_taxonomy = 0`, audit table = 0 rows, members with interests still 77, distinct slugs still 15** — the same 15 values, now as slugs |
| 6 | Anonymous / authenticated read works | ✅ **both roles: 46 rows** |
| 7 | Non-admin writes denied | ✅ **see below — proven, not assumed** |
| 8 | Idempotent | ✅ **ran 3× on production**, identical output, state unchanged |
| 9 | No `posts` / `post_kind` / `scheduled_posts` / Feed changes | ✅ **see below** |

### Check 9 in detail — before vs after

| | Before | After |
|---|---|---|
| `posts` rows | 200 | **200** |
| `posts` columns | 15 | **15** |
| `scheduled_posts` columns | 18 | **18** |
| `posts.categories` or `post_kind` | — | **0 — neither exists** |
| `get_broadcast_feed` signatures | `(_exclude_ids, _limit)` ;; `(_exclude_ids, _limit, _newest_first)` | **identical** |
| Contributor Score fn md5s | `0fb5e020ab` / `d835a4edd4` / `7471357501` | **identical** |

**Phase B has not begun. The Feed is untouched. The Contributor Score is untouched.**

### Check 7 in detail — and a correction to my own preflight

Tested by dropping to the real roles inside a transaction and rolling back:

| Actor | Action | Result |
|---|---|---|
| `anon` | SELECT | **46 rows** ✅ |
| `authenticated` | SELECT | **46 rows** ✅ |
| `anon` | INSERT | **DENIED** — `42501: new row violates row-level security policy` |
| `authenticated` | INSERT | **DENIED** — `42501` |
| `authenticated` | UPDATE one row | **0 rows updated** |
| `authenticated` | DELETE one row | **0 rows deleted** |
| `authenticated` | **UPDATE every row, unfiltered** | **0 rows updated** |
| `authenticated` | read audit table | **DENIED** — `42501: permission denied` |

Live state after all of it: **46 categories, `portrait` still named `Portrait`.**

> ⚠️ **I have to correct something I told you in the preflight.**
>
> I said writes were stopped by **two** independent layers — table GRANTs *and* RLS — because on
> my throwaway PostgreSQL `anon` and `authenticated` had `SELECT` only. **On production they hold
> `SELECT + INSERT + UPDATE + DELETE`.** Supabase ships an `ALTER DEFAULT PRIVILEGES` rule that
> grants everything on new `public` tables to those roles, and my migration adds a `GRANT SELECT`
> without ever revoking that default. My harness had no such default, so it never showed.
>
> **The outcome I reported is still correct — non-admin writes do not change anything — but the
> mechanism is not what I described. There is ONE layer holding, not two: RLS.** That is why I
> re-tested it above rather than repeating the claim, and why I checked affected-row counts
> instead of trusting "no error": `UPDATE` and `DELETE` under RLS return success with **zero rows
> touched**, which looks identical to working. (This is gotcha §12.29 in the master record, hitting
> my own verification.)
>
> **Recommended follow-up, not applied:** add
> `REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon, authenticated;`
> so the belt exists alongside the braces. It is a one-line hardening change and I have not made
> it, because it is beyond the migration you approved.

---

## WHAT IS NOW TRUE ON PRODUCTION

- `public.categories` — 46 rows, RLS on, one public SELECT policy, one admin-only ALL policy.
- `public.categories_migration_dropped` — exists, **empty**, RLS on with zero policies,
  unreadable by anon and authenticated.
- `profiles.photography_interests` — **77 members migrated from English labels to slugs**, all
  15 distinct values inside the taxonomy, `Astrophotography → astro` for 20 members, nothing lost.

## ⚠️ THE ONE THING THAT MUST HAPPEN NEXT

**The branch is still unmerged, and that is now the safe order.** The database is ready; the
frontend that reads it is not deployed. Members currently see the **old 15-item hard-coded
list** — which still works, because the legacy fallback means old labels and new slugs both
resolve. Nothing is broken in either direction.

When the branch merges, the pickers switch to the 46 from the database.

**Waiting on you: approval to merge `altisinfonet-patch-30`, and separately to start Phase B.**
