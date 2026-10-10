# PHASE A — PRIVILEGE HARDENING APPLIED AND VERIFIED

**Date:** 2026-08-12 06:51:03 UTC · **Applied to production.**
**`main` untouched · branch unmerged · Phase B not started · Create/Post and the strip untouched.**

```sql
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon, authenticated;
```

---

## PRIVILEGES — BEFORE vs AFTER (production)

| Role | Before | After |
|---|---|---|
| `anon` | DELETE + INSERT + SELECT + UPDATE | **SELECT** |
| `authenticated` | DELETE + INSERT + SELECT + UPDATE | **SELECT** |
| `service_role` | DELETE + INSERT + SELECT + UPDATE | DELETE + INSERT + SELECT + UPDATE *(unchanged, correct — this is the server-side role)* |
| `categories_migration_dropped` / anon | NONE | NONE |
| `categories_migration_dropped` / authenticated | NONE | NONE |

---

## THE SIX BEHAVIOURS — ACTUAL PRODUCTION RESULTS

Tested by dropping to the real Postgres roles inside a transaction, then rolling back:

| Test | Result |
|---|---|
| anon **SELECT** | ✅ **ALLOWED — 46 rows** |
| authenticated **SELECT** | ✅ **ALLOWED — 46 rows** |
| anon **INSERT** | ✅ **DENIED — `42501 permission denied for table categories`** |
| authenticated **INSERT** | ✅ **DENIED — `42501`** |
| anon **UPDATE** (unfiltered, whole table) | ✅ **DENIED — `42501`** |
| authenticated **UPDATE** (unfiltered, whole table) | ✅ **DENIED — `42501`** |
| anon **DELETE** (unfiltered) | ✅ **DENIED — `42501`** |
| authenticated **DELETE** (unfiltered) | ✅ **DENIED — `42501`** |

### The difference this made — it is not cosmetic

**Before:** `UPDATE` and `DELETE` returned **success with 0 rows changed**. RLS filtered every
row out of the write set, so nothing was modified — but the caller got no error. A silent
zero-row write is indistinguishable from one that worked. *(This is gotcha §12.29 in the master
record: "a write that reports success but changes zero rows is almost always RLS.")*

**After:** the same statements fail loudly with `42501` at the privilege layer, before RLS is
ever consulted.

**Defence in depth now genuinely exists: GRANTs first, RLS behind them.**

---

## NOTHING ELSE AFFECTED

| Check | Result |
|---|---|
| Categories | **46** — unchanged |
| RLS still enabled on `categories` | **true** |
| Policies on `categories` | **2** — unchanged (public SELECT + admin ALL) |
| Members with interests | **77** — unchanged |
| Members holding `astro` | **20** — unchanged |
| Interests outside the taxonomy | **0** |
| `posts` columns | **15** — unchanged |
| `authenticated` INSERT on `posts`, `post_comments`, `post_reactions`, `scheduled_posts`, `profiles` | **all still `true`** — untouched |

### One thing that moved, and it was not me

`posts` went **200 → 201** during this work. The 201st row is a genuine member post:

```
2026-08-12 06:50:36 UTC   Debjani Das   "Life beyond religion"   public   3 images
```

Created **27 seconds before the REVOKE ran** (06:51:03). Ordinary live-site activity — and an
incidental confirmation that posting still works normally throughout.

---

## THE MIGRATION FILE NOW MATCHES PRODUCTION

The `REVOKE` was added to `20260812040000_category_taxonomy.sql` and pushed to the branch
(`bf90f40`), byte-verified identical. Without this the file and the database would have
diverged, and a rebuild from migrations would silently lose the hardening.

**The harness was also fixed.** My original throwaway PostgreSQL had no
`ALTER DEFAULT PRIVILEGES` rule, which is exactly why the preflight reported "SELECT only" and
missed this. It now mirrors Supabase:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
```

Re-run against that corrected harness, the migration ends with
`anon -> SELECT`, `authenticated -> SELECT`, `service_role -> ALL`, and is **still idempotent**.

> **Why this matters beyond this table.** The preflight was thorough and still wrong, because
> the harness was not faithful to production in one specific way. The lesson is not "test more"
> — it is that a harness which differs from production in any security-relevant setting will
> produce confident, wrong answers. That default-privileges line is now part of the harness for
> every future migration.

---

## STATE

- ✅ Phase A migration live, 46 categories, interests migrated, zero loss
- ✅ Privilege hardening applied and verified
- ✅ Migration file and production in sync; branch byte-verified
- ⬜ Branch `altisinfonet-patch-30` **unmerged** — `main` still `7b7fe04`
- ⬜ **Phase B not started**

**Awaiting: approval to merge, and separately to begin Phase B** (`posts.categories`,
`post_kind`, 1–5 enforcement, category-aware `get_broadcast_feed`, React Query key changes).
Create/Post and the category strip remain out of scope until later phases.
