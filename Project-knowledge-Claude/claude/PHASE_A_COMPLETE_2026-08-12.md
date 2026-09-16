# PHASE A — COMPLETE AND AUDITED

**Date:** 2026-08-12
**Branch:** `altisinfonet-patch-30` · **`main` is untouched** (still `7b7fe04`)
**Migration: NOT applied to production.** **Not merged.** **No Phase B started.**

---

## 1. FILES CHANGED — ALL 10, BYTE-VERIFIED ON THE BRANCH

| File | New/Changed | What |
|---|---|---|
| `supabase/migrations/20260812040000_category_taxonomy.sql` | **NEW** | The whole migration — §2 below |
| `src/lib/categories.ts` | **NEW** | Icon allow-list, `ALL_FILTER`, 1–5 constants, **legacy-label fallback** |
| `src/hooks/useCategories.ts` | **NEW** | One cached fetch per session, shared by every surface |
| `src/components/OnboardingModal.tsx` | changed | Dropped its hard-coded list; reads the taxonomy, stores slugs |
| `src/pages/EditProfile.tsx` | changed | Same |
| `src/pages/Discover.tsx` | changed | Same, **plus a tolerant query** |
| `src/i18n/translations.ts` | changed | 46 English `cat.<slug>` keys |
| `src/i18n/translations.rest.ts` | changed | 276 keys (46 × hi, bn, mr, gu, ta, te) |
| `src/__tests__/categoryTaxonomy.test.ts` | **NEW** | 32 drift tests |
| `scripts/add-category-translations.mjs` | **NEW** | The one-shot generator, kept for auditability |

```
identical = 10    mismatch = 0
```

**Deliberately NOT touched:** hashtags (`RichContentRenderer.tsx`, `HashtagFeed.tsx`,
`global_search_hashtags`), people-tagging (`post_tags`, `TagPeopleModal`), `posts`, the
Contributor Score, the Active Engagement collector, `Index.tsx`.

---

## 2. MIGRATION CONTENTS

`20260812040000_category_taxonomy.sql` — five sections:

1. **`public.categories`** — `slug` PK · `name` · `icon_name` · `sort_order` (UNIQUE) ·
   `is_active` · `created_at`. A CHECK forces lower-case kebab slugs, because the slug is a
   storage key and one stray capital makes `categories && ARRAY['Portrait']` match nothing.
2. **The 46 rows.** Your seven mock categories are `sort_order` 1–7 so they land inside the
   visible width. **No `all` row** — All is a client-side system filter.
3. **RLS** — `SELECT` for anon and authenticated (the strip must render signed out, as the feed
   already does); all writes admin-only via `has_role`. Explicit `GRANT`s, because PostgREST
   needs them even with a permissive policy.
4. **`categories_migration_dropped`** (audit) then the interests migration:
   `profiles.photography_interests` label → slug, with `Astrophotography → astro`. Anything
   unmappable is **recorded first, then dropped** — never silently lost.
5. **Self-check** — prints eight rows including `interests_NOT_in_taxonomy`,
   `interests_still_uppercase` and `LABELS_DROPPED`, so a partial migration cannot pass unnoticed.

**Two icons are honest compromises**, because lucide-react 0.462 has no such glyph — checked
against the package, not assumed: `aerial → Plane` (no Drone) and `equine → Medal` (no Horse).
Both are one `UPDATE` from changing.

---

## 3. VALIDATION RESULTS

### On a throwaway PostgreSQL 16
```
categories_seeded          = 46
categories_active          = 46
interests_NOT_in_taxonomy  = 0
interests_still_uppercase  = 0
LABELS_DROPPED             = 1  (the deliberate "SomethingUnknown" probe)
```
Clean run **and** an idempotent second run produce identical output.
Per-row: `Astrophotography → astro` ✅ · unknown label dropped, the rest of that member's
interests kept ✅ · `NULL` and empty arrays untouched ✅.

> **A bug the harness caught before production could:** the audit table was created *after* the
> statement that writes to it. It failed loudly on a throwaway database. Production never saw it.

### Against live production data (read-only)
```
distinct labels on prod : 15
WOULD_BE_DROPPED        : NONE
members affected        : 77
Astrophotography        : 20 members
```
Exactly the fifteen the mapping was built for. **Zero data loss when this runs.**

### Tests
- **32 new drift tests, all passing** — they parse the seed block out of the migration itself
  and check the TypeScript against it, the same trick that keeps `docs/error-codes.md` honest.
- **6 mutations tried, all 6 caught**: removing an icon from the allow-list; adding an `all`
  row; deleting one Tamil translation; breaking the `Astrophotography` mapping; making Discover
  query slugs only; keeping unrecognised values instead of dropping them.
- `sourceEncoding.test.ts` **green** — no mojibake in 322 new Indic strings.
- **Full suite: 1,211 passing** (up from 1,179), **same 2 pre-existing judging failures**
  (`complete-round-progression-decisions.spec.ts` — PENDING item 4 / P10).
- `npx tsc --noEmit -p tsconfig.app.json` — **3 errors, unchanged baseline, none in changed files.**

### The triplication is gone
`grep -rn "INTEREST_OPTIONS" src/` → **no matches.**

---

## 4. THE SEQUENCING FIX (approved, and now in)

`profiles.photography_interests` moves from English labels to slugs. A migration and a deploy
cannot land in the same instant, so without a fallback a member would briefly see their saved
interests unselected — and a save would then wipe them, silently.

- **Read** — `normaliseInterests()` accepts **both** shapes and always yields slugs.
  Used by OnboardingModal and EditProfile.
- **Query** — Discover asks for the slug **and** its old label (`withLegacy`), so the filter
  works whichever side of the migration a row is on instead of returning nobody.
- The label map is **frozen at the fifteen values verified live on 2026-08-12.** It is not a
  general-purpose parser and must not grow — anything new is already a slug.

**Result: the migration and the deploy are safe in either order, with no window.**

---

## 5. REMAINING RISKS

1. **⚠️ The migration has not run. Nothing is live.** Until it does, `public.categories` does not
   exist — so `useCategories()` returns `[]` and the interest pickers in Onboarding, EditProfile
   and Discover render **no chips at all**. **This branch must not be merged before the migration
   is applied.** Merging first would break registration.
2. **Registration now offers all 46**, not the old 15. That is the taxonomy being the single
   source of truth, and it follows from your instruction — but it is a visible product change to
   the signup flow, so it should be a deliberate decision rather than a side effect.
3. **Translation quality.** The 322 Indic strings are my work, not a native speaker's. The
   structure is verified (every key present, none left as raw English, encoding clean); the
   wording deserves a human pass. `Equine → अश्व` and `Astro → खगोल` in particular are literary
   rather than colloquial.
4. **`types.ts` is still stale** — it does not know `categories` exists, which is why
   `useCategories` narrows through `unknown`. Regeneration belongs in Phase B.
5. **Two weak icons** — `aerial` and `equine`, as above.
6. **Android is unaffected either way** until a new AAB is cut.

---

## 6. WHAT HAPPENS NEXT — AND WHERE THE SCREENS FIT

**This is not the last step.** Phase A only builds the vocabulary.

```
A  Taxonomy      ✅ COMPLETE (on a branch, migration not applied)
B  Database      ⬜ posts.categories, post_kind, CHECK + trigger,
                    scheduled_posts.categories, get_broadcast_feed filter
C  Create        ⬜ NEEDS YOUR POSTING-STEP SCREENS (web + app)
D  Strip         ⬜ needs the web design
```

**The screens are needed at Phase C, one step after next.** Nothing is blocked on them today —
Phase B is pure database and changes no UI. I will ask for them the moment Phase B is approved
and verified.

**Awaiting:** approval to apply the migration to production, and to start Phase B.
