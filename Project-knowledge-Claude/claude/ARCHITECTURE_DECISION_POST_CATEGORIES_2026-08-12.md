# ARCHITECTURE DECISION — POST CATEGORIES

**Date:** 2026-08-12 · **RECOMMENDATION ONLY. No code written. Nothing changed.**
**Question:** (A) normalized `categories` + `post_categories` many-to-many, or (B) array on `posts`?

---

## 0. FIRST — VERIFYING THE REVIEW YOU WERE SENT

You asked *"is it true??"*. I re-checked every claim. **All five are true.**

| Claim | Verdict | Evidence |
|---|---|---|
| Existing scroll infra to reuse | ✅ TRUE | `FeedFriendSuggestions.tsx:184` (snap rail) + `:128` (`scrollBy`); `FeedStoriesBar.tsx:334`; `index.css:389` (`scrollbar-hide`); `CinemaFullView.tsx:1649` (`scrollIntoView inline:"center"`) |
| Feed RPC has no category param | ✅ TRUE | `useFeedQuery.ts:77` → `get_broadcast_feed(_exclude_ids, _limit, _newest_first)` |
| Query key is `["feed"]` with no params | ✅ TRUE | `queryKeys.ts:61` |
| Both must change or the cache serves wrong results | ✅ TRUE | see §5 for exactly why |
| `Index.tsx` filters an already-loaded array, so it's the wrong model | ✅ TRUE | `Index.tsx:686` — client-side `.filter()` over `portfolio_images` |

**One wording correction.** The review says *"rather than five columns or an arbitrary JSON/array
implementation."* Five columns would be wrong and nobody proposed it. But a Postgres `text[]` is
**not** "arbitrary JSON" — it is a first-class typed array with GIN indexing and set operators
(`&&`, `@>`), and it is already the established pattern in this schema in **four** places:
`profiles.photography_interests` (`20260224160300:12`), `featured_artists.tags`
(`20260224165955:11`), `journal_articles.tags` (`20260227064512:13`), `posts.image_urls`
(`20260228054432:1`). That distinction matters to the decision below.

**On the build order:** you and the reviewer are right, and it matches what I proposed —
Taxonomy → Database → Create → Feed filtering → connect the strip last. **No disagreement.**

**On "existing posts stay in All":** confirmed and preserved. See §7.

---

## 1. WHAT I MEASURED (and a mistake I caught)

I built **both designs on a real PostgreSQL 16** with **200,000 posts** — that is **1,000× your
current volume** — and 46 categories, 1–5 per post.

> **A correction I owe you before the numbers.** My first data generator produced the *identical*
> category array for all 200,000 rows, so every query matched zero rows. It reported
> "array 195 ms vs join 1,560 ms" and I nearly wrote that down as a finding. `EXPLAIN` showed
> `actual rows=0` and I rebuilt it. **The numbers below are from the corrected run.** I have
> claimed an unmeasured performance property once on this project already and was wrong; I am not
> doing it twice.

### Production volume today (measured, not estimated)

| | |
|---|---|
| Posts, total | **200** |
| Posts, last 30 days | **144** |
| Posts, last 7 days | **50** |
| Members | **90** |
| Oldest post | 2026-03-13 (platform ~5 months old) |
| `posts` table size | 592 kB |

At ~50 posts/week you reach **200,000 posts in roughly 75 years.** I benchmarked there anyway.

### Feed filter — the hot path, at 200,000 posts

| Design | Execution | Buffers |
|---|---|---|
| **B** — array + GIN, `categories && ARRAY['x']` | **0.613 ms** | 111 |
| **A** — join, written well (`category_id` resolved first) | **0.428 ms** | 436 |
| **A** — join, written naively (slug resolved inside the query) | 1.797 ms | 1,093 |

> ⚠️ **Performance does not decide this.** Both are sub-millisecond at 1,000× your volume, and
> the join is *marginally faster* when written well. Anyone claiming the array is needed "for
> speed" is guessing. It is not. **I am not recommending B on performance grounds.**

### Storage at 200,000 posts

| B — `posts` with array + GIN | **40 MB** |
|---|---|
| **A — `posts` + `post_categories`** | **101 MB** (582,099 join rows) |

2.5×. Real, but irrelevant at your scale.

### Write path — 2,000 posts × 3 categories

| Design | Server time |
|---|---|
| **B** — ONE insert, categories are columns of the same row | **36.6 ms** |
| **A** — insert post, then insert its category rows | 24.0 ms + **137.3 ms** = **161 ms** |

You said *"during posting all must be perfect and very fast."* That is ~4.4× more server work —
but the real cost is worse than the number: **A needs a second network round trip from the
phone.** On a mobile connection in India that is 100–300 ms of added latency on every post, not
137 ms.

---

## 2. THE TWO FINDINGS THAT ACTUALLY DECIDE IT

Both were tested, not reasoned.

### 2a. With a join table, "1–5 categories" **cannot be a constraint at all**

```
B:  ALTER TABLE posts ADD CONSTRAINT chk CHECK (cardinality(categories) BETWEEN 1 AND 5);
    →  ACCEPTED

A:  ALTER TABLE posts ADD CONSTRAINT chk CHECK ((SELECT count(*) FROM post_categories …) BETWEEN 1 AND 5);
    →  REJECTED:  "cannot use subquery in check constraint"
```

A `CHECK` cannot reference another table. Ever. So with design A your central rule — **minimum 1,
maximum 5** — must live in a *deferred constraint trigger* or in application code.

Your own standing rule, from `PROJECT_MASTER_RECORD.md` §0 (2026-07-31):

> *"A rule enforced in one component is not a rule — policy belongs at the lowest layer that can
> enforce it."*

**Design B lets your rule be a one-line database constraint. Design A does not.**

### 2b. With a join table, a half-created post is reachable — and this codebase already has that bug

`supabase-js` **cannot span two statements in one transaction from the client.** So design A is:

```
1) INSERT INTO posts …            → commits
2) INSERT INTO post_categories …  → may fail
```

I ran exactly that and confirmed the outcome: **a post with ZERO categories exists.**

This is not hypothetical here. **`WallPosts.tsx:646–676` already does this for `post_tags`**, and
already has the failure branch: *"Post created, but some tags failed."*

A tag failing is cosmetic. **A category failing breaks the min-1 invariant and makes the post
invisible in every category filter — it would appear only under "All", permanently, with no way
for the member to know.** That is the exact "half-baked" outcome you have objected to before.

With B, the categories are columns of the same row as the post. **Atomic by construction. There is
no second statement to fail.**

---

## 3. THREE MORE SCHEMA-SPECIFIC REASONS

**RLS surface.** `post_categories` would need its own policies mirroring `posts` visibility —
including anon-readable, because posts are deliberately anon-readable for share links. That is a
new policy surface in a codebase whose own gotcha list says *"a write that reports success but
changes zero rows is almost always RLS"* (§12.29) and which has had a P0 RLS incident. **An array
column inherits `posts` RLS for free — zero new policy surface.**

**Registration interests are already `text[]`.** `profiles.photography_interests` is a text array.
With B, "show me posts matching my interests" is **one operator**: `p.categories && pr.photography_interests`
— measured at 0.25 ms, GIN-indexable. With A you must join through. B makes the two features the
same shape.

**The relationship carries no data.** This schema already shows the correct rule. `post_tags` **is**
a join table — because the relationship has attributes: `photo_index`, `x_position`, `y_position`,
`status`, `tagger_id` (`20260418111925:14–17`). A post↔category link has **nothing but the two
ids**. Use a join table when the relationship carries data; use an array when it does not.

---

## 4. RECOMMENDATION — **B, with a real taxonomy table**

Not "array instead of normalization". **Normalize the taxonomy, denormalize the link:**

```
categories            ← a REAL table. 46 rows. slug (PK), sort_order, icon_name, is_active.
                        Single source of truth. Admin-orderable. Validates writes.

posts.categories      ← text[] of slugs, 1–5, GIN indexed.
                        CHECK (cardinality BETWEEN 1 AND 5)
                        + a validation trigger against `categories` for membership.
```

You get normalization exactly where it pays — one authoritative, manageable, orderable list — and
you avoid the join **only** for the link, which carries no data.

**And `sort_order` on that table answers your strip requirement directly**: it decides which
categories appear first in the visible width, without a code change.

To keep the TS render list (icons must be TS) and the DB list from drifting, pin them with a test
— **the pattern this repo already uses** for `docs/error-codes.md` vs `errorCodes.ts`.

---

## 5. WHY BOTH THE RPC *AND* THE QUERY KEY MUST CHANGE

`queryKeys.ts:61` is `feed: () => ["feed"]`. React Query caches by key. If only the RPC gains a
filter and the key stays `["feed"]`, then: member views All → 10 posts cached under `["feed"]`;
member taps Portrait → **same key, cache hit, All's posts render as Portrait.** The reviewer is
right, and it is worse than "stale" — it is silently wrong.

The filter itself goes in **exactly one place**. I read the whole function: every tier
(`newest`, `unseen_ranked`, `seen_ranked`) reads from the single `visible` CTE. Adding the
predicate there preserves the unseen-first / fewest-viewers-first fairness ordering automatically.
**One clause, one place** — true for either design.

---

## 6. THE HONEST CASE *AGAINST* MY RECOMMENDATION

You should decide with this in front of you.

| Design A genuinely wins | Weight |
|---|---|
| **True FK integrity.** An array can hold a slug not in the taxonomy; a trigger is weaker than a real FK. | Real, mitigated |
| **Per-link metadata later** — "primary category", "who assigned it", a confidence score. Adding that to an array means restructuring. | ⚠️ **The one real future risk** |
| **Analytics `GROUP BY`** — measured 70 ms vs 112 ms at 200k. Faster, but this is an admin query, not the hot path. | Minor |
| **Renaming a category** is one UPDATE. | **Neutralised by stable slugs** — the label lives in i18n, the slug never changes |

**If you still prefer A**, it is a defensible choice and I will build it properly. The cost is
explicit: the 1–5 rule becomes a deferred constraint trigger instead of a `CHECK`; post creation
becomes a `SECURITY DEFINER` RPC so it stays atomic — which means restructuring the insert path
inside the 1,267-line composer; and `post_categories` needs its own RLS policies. **All doable.
None free.**

---

## 7. YOUR RULE — EXISTING POSTS — PRESERVED EITHER WAY

```
Existing post  →  categories = '{}' (empty)  →  ALL ✓   specific category ✗
New post       →  1–5 categories             →  ALL ✓   selected categories ✓
```

"All" applies **no predicate at all**, so an uncategorised post is returned unchanged. A category
filter uses `&&`, which an empty array never satisfies.

**No backfill. No retrospective classification. No migration of the 200 existing posts.** The
`CHECK (cardinality BETWEEN 1 AND 5)` must therefore be added `NOT VALID` so it applies to new and
updated rows only and never rejects the existing 200. *(That is also what makes the three system
insert paths — album auto-post, profile-update post, scheduled-posts cron — survive; they still
need an explicit decision, §8.)*

---

## 8. STILL WAITING ON YOU

1. **Approve A or B.**
2. Registration: all 46, or a shorter list there while upload gets 46?
3. `Astrophotography` → `Astro`: rename + migrate the existing rows, or keep the long label?
4. Stable slugs — confirmed yes?
5. **System posts** (album upload, avatar change, scheduled): exempt from the 1-category minimum, or given a default?
6. Full-page Create screens · web design.

**Nothing started. Awaiting approval.**
