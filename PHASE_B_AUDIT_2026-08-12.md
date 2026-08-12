# Phase B Audit — Categories on Posts, and a Category-Aware Feed

**Date:** 2026-08-12
**Status:** Implementation complete, fully tested, **NOT applied to production, NOT merged to main**
**Migration:** `supabase/migrations/20260812070000_post_categories.sql`
`sha256 a1d470a4cdc9f3a6543961ee140f3fab738c45de97d13f19140744b5755c9f46` — 23,526 bytes, 471 lines

---

## 0. Read this first — the one thing that is not safe

**This migration cannot be applied to production on its own. Applying it today stops all member posting, immediately, for every member.**

Phase B's trigger requires 1–5 categories on a member post. The composer that sends them is `WallPosts.tsx`, and Phase B was explicitly forbidden to touch it — the category picker is Phase C. So today the composer sends nothing, and the database would refuse every post with `POST-CAT-002`.

This is not a defect in the migration; it is a coupling between two phases that were scoped separately. But it means "Phase B is approved" and "Phase B can be applied" are two different decisions, and I do not want the first to be mistaken for the second.

Everything else in the migration is independently safe: the columns, the GIN index, the max-5 constraint, slug validation, `create_system_post()`, the scheduled-posts column, and the 4-argument feed RPC. **Only the minimum is coupled.**

**Two ways forward — your call:**

| | What happens | Cost |
|---|---|---|
| **(1) Ship together** | Apply the migration and deploy the Phase C build in the same window | Simplest. But posting is broken for the minutes between the two, and a rollback means rolling back both |
| **(2) Split the migration** | Ship everything except `POST-CAT-002` now; add the minimum in Phase C's own migration | Nothing is ever broken, each half is separately reversible. Costs one extra migration file and a re-run of the test suite |

I recommend **(2)**. It is the only option where a live site is never in a broken state, and the split is a six-line change. I have not made it, because it changes enforcement semantics you specified, and that is your decision, not mine.

The tripwire is in code, not in memory: `postCategoriesPhaseB.test.ts` asserts the composer still sends no categories, and **starts failing the moment Phase C ships** — which is the signal the migration became safe to apply.

---

## 1. Exact migration SQL

Full file: `supabase/migrations/20260812070000_post_categories.sql`. Structure:

| § | What | Notes |
|---|---|---|
| 1 | `posts.categories text[] NOT NULL DEFAULT '{}'`, `posts.post_kind text NOT NULL DEFAULT 'member'`, GIN index | Default `'{}'` is what leaves the 204 existing posts alone — no backfill, no `UPDATE` anywhere in the file |
| 2 | `CHECK (cardinality(categories) <= 5)` | Validated immediately; safe because every existing row has 0 |
| 3 | `enforce_post_categories()` + `trg_validate_post_categories` | The normaliser and the three rules |
| 4 | `create_system_post()` | The only way to create a system post |
| 5 | `scheduled_posts.categories text[]` | Carries the compose-time choice to publish time |
| 6 | 4-arg `get_broadcast_feed`, plus 3-arg and 2-arg wrappers | One implementation, three signatures |
| 7 | Self-check block | 8 values, each annotated with its expected result |

**The three error codes:**

- `POST-CAT-001` — unknown or **inactive** category slug
- `POST-CAT-002` — a member INSERT with 0 categories
- `POST-CAT-003` — a categorised post cannot be stripped back to 0

**Why the minimum is a trigger and not a `CHECK`.** A `CHECK` is re-evaluated on every `UPDATE`. `cardinality >= 1` would therefore make all 204 existing uncategorised posts uneditable — a member editing an old caption would get a constraint error on a post they never categorised. The trigger can tell `INSERT` from `UPDATE`; a `CHECK` cannot.

**Why the trigger is `SECURITY INVOKER`.** The first version was `DEFINER`, and it was bypassable: inside a `SECURITY DEFINER` function `current_user` is the function's *owner*, so `current_user IN ('authenticated','anon')` was always false, the client check never fired, and a plain client `INSERT` carrying `post_kind:'system'` with zero categories was **accepted**. My own test caught it. `session_user` is no good either — PostgREST connects as `authenticator` and then `SET ROLE`s. `INVOKER` is the only thing that distinguishes a member from `create_system_post()`.

**Category order is preserved.** A plain `SELECT DISTINCT` returned `{night,street}` for input `['street','night']` — silently reordering the member's own choice. Fixed with `WITH ORDINALITY` + `DISTINCT ON`, keeping first occurrences.

---

## 2. Exact Feed RPC changes

**One line was added to the feed logic. One.**

```sql
AND (_categories IS NULL OR p.categories && _categories)
```

It sits inside the `visible` CTE. Every ranking tier (`newest`, `unseen_ranked`, `seen_ranked`) reads *from* `visible`, so the unseen-first / fewest-viewers-first fairness ordering is inherited unchanged. Filtering anywhere else — or wrapping the result — would have broken reach fairness.

`_categories IS NULL` means "All": no predicate at all. That is exactly what keeps the 204 uncategorised posts visible.

**Signature compatibility.** `PROJECT_MASTER_RECORD` §12.27 forbids adding a parameter to a function installed apps still call. Two signatures existed. Adding a `DEFAULT`ed 4th parameter to the 3-arg version would have made every 3-argument call ambiguous. So:

- the 4-arg version takes **no default** on `_categories`
- the 2-arg and 3-arg versions were **replaced by thin wrappers** that call the 4-arg with `NULL`

One implementation, both old call shapes preserved exactly. Signature count stays at 3.

### A pre-existing defect found while proving this — not caused by Phase B

A **positional or named 2-argument** call to `get_broadcast_feed` is ambiguous. I proved this three ways:

1. **On production, today, with Phase B not applied** — `select count(*) from public.get_broadcast_feed(_exclude_ids=>'{}'::uuid[], _limit=>5)` returns `ERROR 42725: function ... is not unique`. Production currently has exactly two signatures, `(uuid[],integer,integer)` and `(uuid[],integer)`.
2. **In isolation** — two dummy functions with only the *pre-Phase-B* shapes (2-arg, and 3-arg with all defaults) reproduce the same error with no 4-arg function anywhere.
3. The 3-arg named call works on production and returns rows normally.

**Who this affects:** git history shows a build that called it with only `_exclude_ids` and `_limit` (`5b6000a`, `66750d2`). Anyone still running that old Android APK hits this today. `useFeedQuery` catches the error and falls back to a chronological query, so they see posts — but without fairness ordering, silently.

**Phase B neither causes nor worsens this.** Fixing it means dropping the 2-arg signature, which is a separate decision with its own blast radius. **Flagged, not acted on.**

---

## 3. Exact React Query key changes

This was the most dangerous part of the client work, and it is worth being precise about why.

```ts
feed: (categories?: string[] | null) =>
  ["feed", categories && categories.length ? [...categories].sort() : null] as const,

/** Prefix for every feed cache entry, whatever the category. */
feedAll: () => ["feed"] as const,
```

- `null` is "All". Empty array and `undefined` both collapse to `null`, so there is one spelling of "no filter".
- Slugs are **sorted**, so Portrait-then-Street and Street-then-Portrait are one cache entry, not two that can disagree.
- The array is copied before sorting — the caller's selection state is not mutated.

**The failure this created, and how it was closed.** `invalidateQueries` matches by **prefix** and was never at risk. `setQueryData` is **exact-key** and was. With the key changed, every existing exact-key write would have silently updated the All cache only: on any category tab a deleted post would linger, a like would not register, a realtime arrival would never appear. **Nothing would error.** The feed would just stop reacting.

So every writer now fans out:

- `useFeedCacheUpdaters.ts` — `enqueue()` walks `getQueryCache().findAll({ queryKey: feedPrefix })` and queues a batched update per variant.
- `mapPosts()` does the same walk, but deliberately **outside** the batch: an optimistic mutation must land in the tick the member clicked, not 150 ms later.
- `WallPosts.tsx` and `PostCard.tsx` — the exact-key writers now loop; all invalidations use `feedAll()`.

**`insertPost` is the only updater that is narrowed.** Removals and counter updates apply everywhere — a deleted post must vanish from all variants. An *arrival* must not: `belongsIn(post, cats)` is the client mirror of the RPC's `&&`, so a Landscape post never pops into the Portrait feed.

---

## 4. All `posts` insertion paths audited

Four paths exist. Every one was examined and three were changed.

| Path | Kind | Before | After |
|---|---|---|---|
| `WallPosts.tsx:594` | member | direct insert, no categories | **unchanged** — Phase C owns the picker. This is the deploy-order coupling in §0 |
| `pages/MyPhotos.tsx:353` — "added N photos to the album X." | system | direct insert | → `create_system_post()` |
| `lib/profilePostHelper.ts:24` — "updated their profile picture." | system | direct insert | → `create_system_post()` |
| `functions/publish-scheduled-posts/index.ts:219` | member | direct insert, no categories | now carries `row.categories`; new `categories_rejected` failure branch |

Both system paths run under the **member's own session**, not `service_role` — which is exactly why they could not simply declare `post_kind` themselves, and why `create_system_post()` had to exist. It is `SECURITY DEFINER`, always writes `user_id = auth.uid()`, and takes **no** `post_kind` and **no** `categories` parameter. There is nothing for a caller to forge.

The scheduled publisher is deliberately **not** a system path — a human did choose those categories at compose time; routing it through `create_system_post()` would throw the member's choice away.

`useScheduledPosts.ts` carries `categories` from compose to storage. It is typed optional for now because the column does not exist on production yet, so the generated `types.ts` does not carry it.

A test asserts that **exactly two** direct inserts remain and names them. A fifth appearing is a path nobody has considered w.r.t. categories, and it fails CI.

---

## 5. Test results

### 5a. Database — PostgreSQL 16.13, faithful replica

**The harness was rebuilt for this audit**, because the previous one was not faithful in two ways I want on the record:

1. It seeded "legacy" posts *after* applying Phase B, so the new rule correctly rejected them and the legacy assertions were measuring the harness, not the migration. Now legacy posts are seeded **before** Phase B, in the real order.
2. **It had none of the four production `BEFORE` triggers on `posts`.** So every claim about how the category trigger interacts with duplicate detection, moderation, rate limiting and the caption guard was untested. All four are now pulled verbatim from production and installed.

Trigger order confirmed on the replica, matching the migration's claim exactly:

```
trg_detect_duplicate_post → trg_enforce_post_caption_only_update
  → trg_moderate_post_content → trg_rate_limit_posts
  → trg_validate_post_categories
```

Production also has three **AFTER INSERT** triggers (`trg_enqueue_post_created`, `trg_fan_out_new_post`, `trg_flag_post_review`). They run after the row is settled and cannot influence `NEW`.

| Test | Result |
|---|---|
| **0 categories** on a member post | REFUSED — `POST-CAT-002` |
| **1 category** | ACCEPTED |
| **5 categories** | ACCEPTED |
| **6 categories** | REFUSED — `posts_categories_max_5` |
| `not-a-category` | REFUSED — `POST-CAT-001` |
| `'all'` as a slug | REFUSED — `POST-CAT-001` |
| An **inactive** category | REFUSED — `POST-CAT-001` |
| `' Portrait '` | ACCEPTED, normalised to `portrait` |
| 6 values with duplicates | stored as `portrait,street,macro` |
| Insert order | `film,abstract,night,macro,street` — preserved |
| Dedupe order | keeps **first** occurrence |
| Client sends `post_kind:'system'`, 0 cats | REFUSED — `POST-CAT-002` |
| Client sends `post_kind:'system'`, 1 cat | accepted, **stored as `member`** |
| Client `UPDATE`s to `post_kind='system'` | **pinned back to `member`** |
| `create_system_post()` ×2 | `system / 0 cats`, attributed to the caller |
| 5 legacy posts | present, empty, `post_kind='member'` |
| Feed — All (4-arg NULL) | 13/13 |
| Feed — 3-arg (installed Android) | 13 |
| Feed — named 4-arg | 13 |
| Feed — no args | 10 (correct: default `_limit=10`; raising it gives 13) |
| Feed — landscape / portrait / both / wildlife | 2 / 2 / 3 / 0 |
| Legacy posts under a category filter | 0 — correct |
| System post: in All / in a category | 1 / 0 |
| `newest` tier count, All and filtered | 3 / 2 |
| Tier vocabulary | `newest,unseen` — unchanged |
| Recycled tier under a filter | 1 |
| `exclude_ids`, `limit` | honoured |
| Idempotency — applied twice | identical self-check both runs |

### 5b. Trigger interaction — the part that was previously untested

| Test | Result |
|---|---|
| Author edits caption on a legacy post | SUCCEEDS |
| Author **recategorises** their own post | SUCCEEDS |
| Author **adds** categories to an old uncategorised post | SUCCEEDS |
| Author strips all categories | REFUSED — `POST-CAT-003`, value intact |
| Author sets `post_kind='system'` | pinned to `member` |
| Author changes `privacy` | REFUSED — "Only the caption can be edited" |
| Non-author strips categories | REFUSED — `POST-CAT-003` |
| Moderation on a blocked keyword | fires **before** the category rule is reached |
| Duplicate detection with categories present | still fires |

#### Correction I have to make

My migration comment claimed `enforce_post_caption_only_update` guards an **allow-list**. Read from production, it is a **deny-list**: it refuses an author's UPDATE only if `user_id`, `image_url`, `image_urls`, `thumbnail_url`, `thumbnail_urls`, `privacy`, `created_at` or `content_hash` changes. Everything else is permitted.

The conclusion I drew was right; the mechanism I wrote down was wrong, and the difference matters, because it flips the default for every future column: **any column added to `posts` is author-editable unless explicitly denied.** For Phase B that cuts both ways — `categories` being absent from the deny-list is what lets a member recategorise at all, and `post_kind` being absent from it means the pin in my trigger is the *only* thing stopping an author promoting their own post. The comment is corrected in the migration.

This is the same class of mistake as the Phase A preflight, where I reported the right outcome via the wrong mechanism. Both times the fix was to stop reasoning from a scaffold and read production.

### 5c. Client

- **Typecheck:** 3 errors — **exactly the pre-existing baseline** (`useAdminEntryOverride.ts`, `useNotificationPreferences.ts` ×2). Zero new.
- **Full suite:** **1,241 passed**, 1 skipped, **2 failed**. The 2 failures are the known P10 judging tests, unrelated and unchanged. Baseline before Phase B was 1,211 passed / same 2 failed → **+30 new tests, all passing**.

New file `src/__tests__/postCategoriesPhaseB.test.ts` (30 tests) covers the cache key, the fan-out, all four insert paths, the migration read as text (filter appears exactly once, inside `visible`; the three ranking expressions byte-identical; no `UPDATE public.posts`; `SECURITY INVOKER` confirmed), and the deploy-order tripwire.

---

## 6. Hashtags and people-tagging — untouched, as required

> *"Hashtags are NOT being replaced or changed. Keep the existing hashtag/post_tags functionality intact."*

- **Hashtags** have no table and no column. `#word` is parsed out of `posts.content` at **read** time by `RichContentRenderer`. Phase B does not touch `posts.content`, its parsing, or its rendering.
- **`post_tags`** — tagging *people* in a photograph, with coordinates — is not referenced by the migration except in a comment saying it is untouched. A test asserts no `ALTER`/`DROP` against it.

---

## 7. Files changed

**New:**
- `supabase/migrations/20260812070000_post_categories.sql`
- `src/__tests__/postCategoriesPhaseB.test.ts`

**Modified** (246 insertions, 48 deletions across 9 files):
- `src/lib/queryKeys.ts` — `feed(categories?)`, `feedAll()`
- `src/hooks/feed/useFeedQuery.ts` — `_categories` to the RPC, `overlaps` in the fallback, `useFeedQuery(userId, categories?)`
- `src/hooks/feed/useFeedCacheUpdaters.ts` — fan-out, `belongsIn`, guarded `insertPost`
- `src/components/WallPosts.tsx`, `src/components/post/PostCard.tsx` — looped writers, prefix invalidation
- `src/pages/MyPhotos.tsx`, `src/lib/profilePostHelper.ts` — `create_system_post()`
- `src/hooks/feed/useScheduledPosts.ts`, `supabase/functions/publish-scheduled-posts/index.ts` — categories carried through

---

## 8. Remaining risks

| # | Risk | Severity | Status |
|---|---|---|---|
| 1 | **Applying Phase B before Phase C stops all member posting** | **Blocking** | Documented in the migration header; test tripwire in place; awaiting your choice of (1) or (2) in §0 |
| 2 | 2-argument `get_broadcast_feed` is ambiguous | Low, **pre-existing** | Proved on production today. Old APKs fall back to chronological. Not touched |
| 3 | Scheduled posts composed before Phase C carry no categories and will fail at publish time | Low | Fails cleanly as `categories_rejected` with the row preserved, not silently. Worth checking the pending queue before applying |
| 4 | Generated `types.ts` is stale — `categories`/`post_kind` absent | Low | Narrowed through `as any`/`UntypedRpc` as elsewhere in this codebase. Regenerate after applying |
| 5 | Android APKs keep the 3-arg call until a new AAB | Low | Verified working: 3-arg returns rows normally |
| 6 | 322 `cat.*` translations exist but no UI reads them yet | None | Phase C/D |

---

## 9. What I did NOT do

- Did **not** apply the migration to production.
- Did **not** merge to `main`.
- Did **not** touch `WallPosts.tsx`'s composer fields, the Create flow, or the category strip.
- Did **not** modify hashtag parsing or `post_tags`.
- Did **not** change the Contributor Score or the Active Engagement collector.
- Did **not** split the migration or weaken `POST-CAT-002` — that is your decision in §0.

---

## 10. What I need from you

1. **Approve or reject the Phase B audit.**
2. **Choose (1) ship-together or (2) split-the-migration** from §0. If (2), I will produce the split and re-run the full suite before anything is applied.
3. Phase C is blocked on the posting-step screens you said you have ready — for Web and App.
