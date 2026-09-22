# PHASE A — PRODUCTION PREFLIGHT: ALL SIX CHECKS PASS

**Date:** 2026-08-12 · **Migration NOT yet applied — blocked on the browser, see §7.**

**The exact file that will run** — pulled from the remote branch, not a local copy:

```
supabase/migrations/20260812040000_category_taxonomy.sql
sha256  31acba7dcafb89024ceba7469c956e6e401de75aa4e942c6e0063a2c1495ec41
bytes   14,713
```

---

## CHECK 1 — Phase A infrastructure only. `posts` untouched. No Phase B. ✅

**Every mutating statement in the file, all 14:**

| Target | Statements |
|---|---|
| `public.categories` | CREATE TABLE · INSERT (46) · ENABLE RLS · 2× DROP/CREATE POLICY · 2× GRANT |
| `public.categories_migration_dropped` | CREATE TABLE · ENABLE RLS · REVOKE · INSERT |
| `public.profiles` | **1 UPDATE**, `SET photography_interests = …` and nothing else |

**`posts` appears exactly twice in the whole file — both inside `COMMENT` strings** (lines 53
and 223), never in a statement.

**Absent entirely:** `posts.categories` · `post_kind` · `post_categories` · `scheduled_posts` ·
`get_broadcast_feed` · any CHECK or trigger on `posts`. **Phase B is not started.**

## CHECK 2 — the 46 match the approved master list exactly ✅

```
approved count              : 46
seeded count                : 46
in approved but NOT seeded  : NONE
seeded but NOT approved     : NONE
VERDICT                     : EXACT MATCH
```

Integrity: **no duplicate slugs** · **sort_order is exactly 1..46** · **no non-kebab slug**.

## CHECK 3 — `All` is not a category ✅

```
rows with slug 'all' or name 'All' : NONE
```

All remains a client-side system filter that applies no predicate — which is precisely what
keeps existing uncategorised posts visible under it.

## CHECK 4 — `Astrophotography → astro` is the only rename ✅

The mapping has exactly **one** special case, and it appears twice (once in the audit capture,
once in the UPDATE — identical logic):

```
WHEN 'astrophotography' THEN 'astro'
ELSE replace(lower(btrim(old_label)), ' ', '-')
```

Everything else is a mechanical lower-case + space→dash. Verified live against production
earlier the same day:

```
distinct labels on prod : 15
WOULD_BE_DROPPED        : NONE
members affected        : 77
Astrophotography        : 20 members
```

## CHECK 5 — RLS proven with real roles, not reasoned ✅

Run as actual `anon` and `authenticated` roles on a throwaway PostgreSQL 16:

| Actor | Read `categories` | Write | Read audit table |
|---|---|---|---|
| `anon` | **46 rows** ✅ (strip works signed out) | `ERROR: permission denied` | `false` |
| `authenticated`, non-admin | **46 rows** ✅ | INSERT / UPDATE / DELETE all `ERROR: permission denied` | `false` |

Table privileges are **SELECT only** for both roles — so writes are impossible at the GRANT
layer *before* RLS is even consulted. Two independent layers, not one.

After every attempt: `categories still = 46`, `portrait name still = Portrait`. **Nothing was
written.**

## CHECK 6 — idempotent ✅

The exact production file run **three times in a row** against a database seeded with the real
fifteen production labels. Identical output every time:

```
categories_seeded          = 46
categories_active          = 46
interests_NOT_in_taxonomy  = 0
interests_still_uppercase  = 0
LABELS_DROPPED             = 0
labels_dropped_detail      = none
```

---

## 7. WHY IT HAS NOT RUN YET

The Chrome window is minimised — `document.hidden = true`, `innerWidth = 0` — and the Supabase
dashboard is a client-rendered app that mounts **nothing** at that size. `window.monaco` is
`undefined`, so there is no editor to load the SQL into. This is the same blocker that stopped
the Phase 2a migration earlier today; it cleared the moment the window was restored.

**Nothing is wrong with the migration. It is one restored window away from running.**

## 8. WHAT RUNS THE MOMENT IT CLEARS

1. Live preflight snapshot — `categories` absent, posts count, posts column count, and the md5s
   of the three Contributor Score functions **before**.
2. Load the exact file, **hash-verified in the editor** (`3157200067 / 14713`) before Run.
3. Run, and confirm the eight self-check rows.
4. Post-migration verification — 46 rows, no `all`, RLS + grants, interests migrated,
   `LABELS_DROPPED`, `posts` **unchanged** (same row count, same column count), and the three
   score functions **byte-identical to before**.

**Phase B will not start.**
