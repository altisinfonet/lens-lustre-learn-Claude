# IMPLEMENTATION PLAN — POST CATEGORIES (Option B, slugs)

**Date:** 2026-08-12 · **PLAN ONLY. No code written. Nothing changed.**
**Approved:** normalized 46-row `categories` master table + `posts.categories` as a slug array.

---

## 0. ⚠️ ONE CORRECTION BEFORE ANYTHING ELSE

You wrote *"keep the existing hashtag/post_tags functionality intact."*

**Those are two completely different systems in this codebase**, and the distinction changes what
"save both independently" means:

| | What it actually is | Where it lives |
|---|---|---|
| **Hashtags** | `#word` typed into the caption. **Parsed at read time. No table, no column.** | `RichContentRenderer.tsx:17` — `/@\[([^\]]+)\]\(([^)]+)\)\|#(\w+)/g`, linking to `/hashtag/:tag` |
| **`post_tags`** | **Tagging PEOPLE in a photograph** — with coordinates | table: `tagged_user_id`, `photo_index`, `x_position`, `y_position`, `status` |

So the Create flow will save **three independent things**, not two:

1. **Hashtags** → nothing to save. They are characters inside `posts.content`. Untouched.
2. **People tags** → the existing second insert into `post_tags`. Untouched.
3. **Categories** → a new field on the *same* `posts` insert. **Zero extra round trips.**

**I am not touching 1 or 2.** No change to the hashtag regex, the `/hashtag/:tag` route,
`global_search_hashtags()`, `post_tags`, `TagPeopleModal`, or any of it.

---

## 1. ROUND TRIPS — WHAT PUBLISH COSTS BEFORE AND AFTER

You asked that category selection add no unnecessary network round trips.

| | Today | After |
|---|---|---|
| Upload N photos | N | N |
| `INSERT INTO posts` | 1 | **1** ← categories ride along in this same insert |
| `INSERT INTO post_tags` (only if people tagged) | 0 or 1 | 0 or 1 |
| **Added by categories** | — | **ZERO** |

`posts.categories` is a column on the row being inserted. This is precisely why Option B was the
right call: **atomicity and zero round trips are the same property.** There is no second statement
that can fail, so a post can never exist without its categories.

The 46-item list itself is fetched **once per app session** (React Query, `staleTime: Infinity`) and
shared by the Create picker, the feed strip and registration. It is not per-post.

---

## 2. DATABASE CHANGES — EXACT

**One new migration:** `supabase/migrations/20260812xxxxxx_post_categories.sql`

### 2.1 `public.categories` — the master table (46 rows)

```
slug        text PRIMARY KEY          -- stable, never changes: 'black-and-white'
name        text NOT NULL             -- English display name: 'Black & White'
icon_name   text NOT NULL             -- lucide export name, e.g. 'Contrast'
sort_order  smallint NOT NULL UNIQUE  -- controls strip order; admin-changeable
is_active   boolean NOT NULL DEFAULT true
created_at  timestamptz NOT NULL DEFAULT now()
```

- Seeded with your **46** categories. `All` is **not** a row — it is a client-side system filter.
- **RLS ON**, one SELECT policy: readable by `anon` and `authenticated` (the strip must work signed
  out, as `/hashtag/:tag` already does). Writes: admin only, via `has_role(auth.uid(),'admin')`.
- `icon_name` is stored here (your "single source of truth for icon"); the client maps that **name**
  to a lucide component through a fixed allow-list, because a React component cannot live in a row.

### 2.2 `public.posts` — one new column

```
ALTER TABLE public.posts
  ADD COLUMN categories text[] NOT NULL DEFAULT '{}';

CREATE INDEX idx_posts_categories ON public.posts USING GIN (categories);
```

`DEFAULT '{}'` is what leaves your **200 existing posts untouched and still visible in All**.

### 2.3 Enforcement — cardinality by CHECK, validity by trigger

```
ALTER TABLE public.posts
  ADD CONSTRAINT chk_posts_categories_count
  CHECK (cardinality(categories) BETWEEN 1 AND 5) NOT VALID;
```

**`NOT VALID` is load-bearing**: it applies to new and updated rows and **never re-checks the
existing 200**. No backfill, exactly as you required.

Validity of each slug cannot be a `CHECK` (a CHECK cannot reference another table — I tested this
and Postgres rejects it), so:

```
trg_validate_post_categories   BEFORE INSERT OR UPDATE OF categories ON public.posts
```

Rejects any slug not present in `categories` with `is_active = true`; rejects duplicates within the
array; normalises to lower-case.

> ⚠️ **Trigger firing order.** `posts` already carries five triggers. Postgres fires BEFORE triggers
> **alphabetically**: `trg_detect_duplicate_post`, `trg_enforce_post_caption_only_update`,
> `trg_moderate_post_content`, `trg_rate_limit_posts`, then **`trg_validate_post_categories`**.
> Last is correct — rate limiting and moderation stay cheapest-first. This is deliberate, not luck.

### 2.4 `public.scheduled_posts` — one new column

```
ALTER TABLE public.scheduled_posts
  ADD COLUMN categories text[] NOT NULL DEFAULT '{}';
```

A scheduled post is a **member-composed** post. Its categories are chosen at compose time and must
travel through to publication — this is not an exemption, it is completing the feature.

### 2.5 `get_broadcast_feed` — one new parameter, one new clause

```
get_broadcast_feed(_exclude_ids uuid[], _limit int, _newest_first int, _categories text[] DEFAULT NULL)
```

The predicate goes in **exactly one place** — the `visible` CTE:

```
AND (_categories IS NULL OR p.categories && _categories)
```

Every tier (`newest`, `unseen_ranked`, `seen_ranked`) reads from `visible`, so the unseen-first /
fewest-viewers-first fairness ordering is preserved automatically. **`All` passes `NULL`** → no
predicate → uncategorised existing posts are returned unchanged.

Added as a **new parameter with a DEFAULT**, so installed Android builds calling the 3-argument form
keep working. *(Per `PROJECT_MASTER_RECORD.md` §12.27 — never break a live function that shipped
apps still call. A DEFAULT is safe; a rename would not be.)*

---

## 3. ⚠️ THE ONE DECISION I CANNOT MAKE FOR YOU

**Four code paths insert into `posts`. Only one is the composer.**

| # | Path | File | Does a human pick categories? |
|---|---|---|---|
| 1 | The composer | `WallPosts.tsx:594` | ✅ yes |
| 2 | Scheduled publish | `supabase/functions/publish-scheduled-posts/index.ts` | ✅ yes — at compose time (§2.4 carries them) |
| 3 | **Album upload auto-post** — *"added 3 photos to the album X."* | `MyPhotos.tsx:353` | ❌ **no** |
| 4 | **Profile-update post** — *"updated their profile picture."* | `profilePostHelper.ts:24` | ❌ **no** |

Applied literally, "new posts must contain 1–5 valid slugs" **breaks 3 and 4 the moment it ships** —
album uploads stop working and changing an avatar throws.

**My recommendation — Option (i): an explicit `post_kind` column.**

```
ALTER TABLE public.posts
  ADD COLUMN post_kind text NOT NULL DEFAULT 'member'
  CHECK (post_kind IN ('member','system'));
```

The trigger enforces 1–5 only when `post_kind = 'member'`. Paths 3 and 4 set `'system'`. It is
explicit, greppable, no guessing, no hidden behaviour — and it keeps your taxonomy at exactly **46
rows**.

**Option (ii):** a hidden 47th `system` row in `categories` with `is_active = false`. No new column,
but it makes the master table 47 rows, which contradicts your spec.

**Option (iii):** leave 3 and 4 uncategorised and make the constraint conditional on the caller.
I do not recommend this — the rule stops being a rule.

**This is a schema addition you did not ask for, so I will not add it without your word.**

---

## 4. FILES — EXACT LIST

### Phase A — Taxonomy *(no behaviour change; ships alone)*
| File | Change |
|---|---|
| `src/lib/categories.ts` | **NEW** — `CategorySlug` type, slug→lucide icon allow-list, `ALL_FILTER` constant |
| `src/hooks/useCategories.ts` | **NEW** — reads `categories`, `staleTime: Infinity`, one fetch per session |
| `src/i18n/translations.ts` + `translations.rest.ts` | 46 `cat.<slug>` keys × 7 locales |
| `src/__tests__/categoryTaxonomy.test.ts` | **NEW** — pins the TS icon map and the seeded DB list identical *(same drift-test pattern as `docs/error-codes.md`)* |

### Phase B — Database *(no UI change)*
| File | Change |
|---|---|
| `supabase/migrations/20260812xxxxxx_post_categories.sql` | **NEW** — everything in §2 |
| `src/integrations/supabase/types.ts` | regenerate *(currently stale — this is why every call needs `as any`)* |

### Phase C — Create *(needs your screens)*
| File | Change |
|---|---|
| `src/components/post/CategoryPicker.tsx` | **NEW** — 1–5 selection, min/max gate |
| `src/components/WallPosts.tsx` | `categories` added to the **existing** insert at `:594`; publish button gated on ≥1. **No other change.** |
| `src/pages/CreatePost.tsx` + `src/App.tsx` | **NEW** full-page route, reusing `WallPosts` |
| `src/hooks/feed/useScheduledPosts.ts` | carry `categories` |
| `supabase/functions/publish-scheduled-posts/index.ts` | carry `categories` into the insert |

### Phase D — Feed filter + strip
| File | Change |
|---|---|
| `src/components/feed/CategoryStrip.tsx` | **NEW** — reuses the `FeedFriendSuggestions.tsx:184` snap rail, `scrollbar-hide` (`index.css:389`), `scrollIntoView({inline:"center"})` (`CinemaFullView.tsx:1649`), `layoutId` underline (`MobileBottomNav.tsx:182`). Adds the **wheel→horizontal handler that does not exist anywhere yet**, with `stopPropagation` so it does not fight `PullToRefresh`'s existing `onWheel` at `:121` |
| `src/lib/queryKeys.ts:61` | `feed: (categories?) => ["feed", categories ?? null]` — **and every existing `invalidateQueries(queryKeys.feed())` call site checked** |
| `src/hooks/feed/useFeedQuery.ts:77` | pass `_categories`; thread the selection into the key |
| `src/pages/Feed.tsx:241` | mount `<CategoryStrip>` above `<FeedStoriesBar>` |

### Deliberately NOT touched
`RichContentRenderer.tsx` · `HashtagFeed.tsx` · `global_search_hashtags` · `post_tags` ·
`TagPeopleModal` · `Index.tsx` gallery filter · `profiles.photography_interests` ·
`get_top_contributors_v2` and the whole scoring path · the Active Engagement collector.

> One thing I found and am **leaving alone** because it is unrelated: `publish-scheduled-posts`
> already drops `thumbnail_urls`, so scheduled posts serve full-size images in feed grids.
> Pre-existing. Logged, not fixed here.

---

## 5. ORDER, AND WHAT BLOCKS WHAT

```
A  Taxonomy        → needs §3 answered only for the seed list. Can start now.
B  Database        → needs A + §3 answered.
C  Create          → needs A + B + YOUR SCREENS.
D  Feed + strip    → needs A + B + C + THE WEB DESIGN.
```

Each phase is separately verifiable: A and B change nothing visible, so they can ship and sit
inert while you review the Create screens.

---

## 6. HOW I WILL PROVE EACH PHASE

- The migration runs on a **throwaway PostgreSQL 16** first — including a test that the 200
  existing uncategorised posts still return from `get_broadcast_feed(NULL)` and are **rejected**
  from a category filter.
- Every claim byte-verified against `main`; typecheck with `-p tsconfig.app.json` (the config CI
  actually uses); full suite; new tests mutation-tested.
- Live verification on production before I call anything done.

---

## 7. WAITING ON YOU

1. **§3 — `post_kind`, or one of the alternatives?** *(blocks Phase B)*
2. **`Astrophotography` → `astro`:** registration currently stores the label `Astrophotography`.
   Migrate those rows to the new slug, or leave the interests field alone for now? *(blocks Phase A)*
3. Registration: all 46, or keep its shorter list?
4. Full-page Create screens *(blocks C)* · web design *(blocks D)*.

**Nothing started.**
