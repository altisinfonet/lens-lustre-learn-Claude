# AUDIT — CATEGORY FILTER STRIP + PLAN OF WORK

**Date:** 2026-08-12 · **AUDIT ONLY. No code written. Nothing changed.**
**Awaiting:** owner approval, the **web design**, and the **full-page Create screens**.

---

## 1. DOES THE STRIP EXIST? — **NO**

Not in any form. Verified three ways:

- **`src/pages/Feed.tsx:236–270`** is the whole render head. The order is
  `PullToRefresh` (237) → `FeedStoriesBar` (241) → `TodaysBirthdayStrip` (249) →
  `WallPosts composerOnly` (270). **Nothing sits between the header and the stories row.**
- **`src/components/feed/`** contains only `FeedFriendSuggestions.tsx`,
  `FeedStoriesBar.tsx`, `TodaysBirthdayStrip.tsx`, `__tests__`. No filter/category component.
- Repo-wide search for the icons in your screenshot — `PawPrint`, `Mountain`, `Luggage`,
  `Plane`, `Footprints`, `Flower` — returns **zero hits** in `src/`.

`Feed.tsx` has **no `category` / `selectedCategory` state at all.**

**So question 2 (is it functional or decorative) does not apply.** There is nothing to make
functional. Your screenshot is the design, not a screenshot of half-built code — which is good
news: nothing to unpick.

---

## 2. WHAT ALREADY EXISTS AND IS DIRECTLY REUSABLE

This is the important part of the audit. **The horizontal-rail pattern you are asking for is
already solved twice in this codebase.**

### 2a. The rail shape — `FeedStoriesBar.tsx:334`

```
className="flex items-center gap-3.5 overflow-x-auto pb-2 scrollbar-hide px-1"
```

This is the stories row that sits directly *below* where your strip goes. Touch swipe and
trackpad both work natively from `overflow-x-auto`.

### 2b. The better rail — `FeedFriendSuggestions.tsx:184`

```
className="flex gap-2.5 overflow-x-auto overscroll-x-contain snap-x snap-mandatory
           scroll-px-4 scrollbar-hide px-4 pb-4 pt-1"
```

Cards at **:191** use `snap-start shrink-0`. **This is the closer match** and its own comments
(:168–180) explain exactly why each class is there — `snap-x` so a thumb-flick lands on an item
edge instead of halfway through one, `overscroll-x-contain` so the swipe doesn't chain to the
page, `scroll-px-4` so snap-mandatory doesn't fight the padding.

It also has **arrow-button scrolling at `:128`**:

```ts
railRef.current?.scrollBy({ left: dir * CARD_STEP, behavior: "smooth" });
```

### 2c. Keeping the active chip visible — `CinemaFullView.tsx:1649`

Already implemented, exactly the behaviour a category strip needs:

```ts
el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
```

guarded by a `lastScrolledKey` ref so it fires once per change, inside `requestAnimationFrame`.
**Copy this.** Without it, tapping "Digital Art" (item 47) and then reloading leaves the strip
scrolled to the far left with the active chip off-screen.

### 2d. `scrollbar-hide` — `src/index.css:389` and `:393`

The utility already exists. No Tailwind config change needed.

### 2e. The active-underline motion — `MobileBottomNav.tsx:182–187`

A `motion.div` with `layoutId="bottomNavIndicator"` slides the underline between tabs. Your
screenshot shows exactly that treatment on "All". **Same technique, different `layoutId`.**

### 2f. Icons — all available

`lucide-react ^0.462.0`. I checked **48 candidate icon names** covering all 46 categories:
**zero missing.** No icon library needs adding.

---

## 3. WHAT MUST BE BUILT — AND THE GAPS THAT MATTER

### 3a. ⚠️ Mouse-wheel horizontal scrolling does NOT exist anywhere

You asked specifically: *"On Web, horizontal mouse/trackpad scrolling should work."*

- **Trackpad two-finger horizontal** — ✅ works natively with `overflow-x-auto`. No code.
- **Touch swipe in the app** — ✅ works natively. No code.
- **Desktop mouse wheel (vertical wheel over the strip)** — ❌ **does NOT scroll it.**

A repo-wide search for `onWheel` finds only four places, none a horizontal rail:
`AdminFeaturedArtist.tsx:88/106` (zoom), `JuryImageViewer.tsx:187/263` (zoom), and
`PullToRefresh.tsx:87–121` (pull gesture). **Neither rail has one.**

⚠️ **And there is a conflict to design around:** `Feed.tsx:237` wraps the whole feed in
`<PullToRefresh>`, which **already binds `onWheel` at `:121`** and consumes negative `deltaY`.
A wheel handler on the strip must `stopPropagation` or PullToRefresh will fight it. This is a
real trap, not a theoretical one.

### 3b. The strip component itself

Does not exist. ~1 file. Needs: sticky under the header, 46 + "All", icon + label per chip,
active underline, snap, `scrollbar-hide`, active-chip-into-view, wheel handler, and
`aria-selected` / keyboard arrow support.

### 3c. The feed query cannot filter yet

- `src/hooks/feed/useFeedQuery.ts:77` calls
  `supabase.rpc("get_broadcast_feed", { _exclude_ids, _limit, _newest_first })`.
- **Live signature** (`supabase/migrations/20260805100000_feed_newest_first.sql`):
  `get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)`
  — **no category parameter.**
- **`src/lib/queryKeys.ts:61` — `feed: () => ["feed"]`, with NO parameters.**

⚠️ **If the key is not changed, the cache will serve "Portrait" results under "All".** The key
must become `feed(categories)` and every existing `invalidateQueries(queryKeys.feed())` call
site must still match — that is the subtle part, not the RPC change.

Also note `get_broadcast_feed` is **VOLATILE and re-deals on every call** (unseen-first,
fewest-viewers-first) for reach fairness. A category filter has to sit *inside* that logic, not
wrap it, or the fairness ordering breaks.

### 3d. There is nothing to filter ON

**`posts` has 15 columns and none is a category, genre or tag.** This is greenfield — covered
fully in `AUDIT_POST_CATEGORIES_2026-08-11.md`.

### 3e. i18n covers 9 of 46

`src/i18n/home.ts:29–38` has `home.catAll` + 9 `home.cat.*` keys (portrait, nature, wildlife,
landscape, abstract, documentary, street, general, aerial), translated across all 7 locales.
**37 categories have no key.** The lookup convention at `Index.tsx:705` —
`t("home.cat." + cat.toLowerCase(), cat)` — is reusable; the key set is not.

### 3f. `Index.tsx` is the WRONG model to copy

`Index.tsx:685–708`: `flex flex-wrap items-center justify-center gap-2` — a **wrapping,
centred, text-only** bar, no icons, no scrolling. It filters an already-fully-loaded array of
`portfolio_images` **client-side in memory** (`:686`), with categories **derived from the data**
(`:685`).

**None of that transfers.** The feed is a paginated RPC over `posts`, and you have explicitly
asked for a scrolling strip, not a wrapping block. Only the **i18n key convention** is reusable.

### 3g. Bottom nav has no create entry

`MobileBottomNav.tsx:29–38`. A signed-in member sees 5: Feed, Wall, **Home (centre)**, Compete,
Profile. The centre slot is **Home**, not a "+". Grep for `Plus|Create` → **nothing**. Your
screenshot shows a "Create" control top-left of the feed header; that is also not in the code.

---

## 4. ⚠️ THE COUNT — 46 OR 47?

You wrote **47 master categories**. I counted your list twice: it contains **46**.

Landscape, Nature, Wildlife, Bird, Macro, Astro, Cityscape, Architecture, Street, Documentary,
Photojournalism, Travel, Portrait, Fashion, Wedding, Newborn & Baby, Sports, Automotive,
Aviation, Food, Product, Still Life, Commercial, Industrial, Real Estate, Fine Art, Abstract,
Minimalist, Black & White, Long Exposure, Night, Aerial, Underwater, Experimental, Conceptual,
Mobile, Film, Infrared, Scientific, Cultural, Humanitarian, Lifestyle, Event, Pet, Equine,
Digital Art.

**My reading: 46 categories + "All" = 47 items in the strip.** That fits both your statements
("All is the first item", "all 47 must exist in the same strip"). **Confirm before I build the
list** — if a 47th category was dropped from the message, I need it now, not after the
taxonomy is written and translated 7 times.

---

## 5. PLAN OF WORK

Four phases. Each is independently shippable and independently verifiable. **Nothing starts
without your approval.**

### PHASE A — Taxonomy *(can start on approval; no design needed)*
The single source of truth: 46 categories with a **stable slug**, an English label, a lucide
icon, and i18n keys across all 7 locales. Deletes the triplication in `OnboardingModal.tsx:22`,
`EditProfile.tsx:29` and `Discover.tsx:19`.
**No behaviour change. Nothing visible moves.** Ships alone, safely.
*Depends on: your answer to §4, and decisions 1–3 in `AUDIT_POST_CATEGORIES_2026-08-11.md`.*

### PHASE B — Database *(needs A; no design needed)*
`posts.categories text[]`, GIN index, the 1–5 CHECK constraint, and — critically — the **three
other insert paths made safe** (album auto-post, profile-update post, scheduled-posts cron),
because a minimum-1 rule breaks all three on day one. Then `get_broadcast_feed` gains an
optional category filter *inside* its fairness ordering.
**No UI change.** Existing posts are untouched and stay under "All".

### PHASE C — The full-page Create screen *(needs A + B + YOUR SCREENS)*
Route, layout, and the 1–5 category picker. **Must reuse `WallPosts.tsx`** — 1,267 lines of
hard-won behaviour live in there (Android stale-file-handle fix, security-scan rebuild-retry,
per-photo crop, tag coordinates, schedule window, mention conversion). A clone means those bugs
come back on one of the two copies.
*Blocked on the screens you said you'd send.*

### PHASE D — The category strip *(needs A + B + C)*
The scrolling strip, wired to the query key and the RPC. Reuses §2a–2e. Builds the wheel
handler and solves the `PullToRefresh` conflict.

> **Why the strip is LAST, not first.** If the strip ships before members can categorise
> anything, **every category shows an empty feed** — because no post has a category yet. Create
> comes first so real categorised posts exist; then the strip has something to find. If you
> would rather see the strip early to check the look, say so and I will build it visually
> first — but it must not be filtering live until posts carry categories.

---

## 6. WHAT I STILL NEED FROM YOU

**Before Phase A:**
1. **46 or 47?** (§4)
2. Does registration move to all 46, or keep a shorter list while upload gets all 46?
3. **`Astrophotography` → `Astro`:** rename and migrate existing rows, or keep the long label?
   The English label IS the stored key today, so a rename is a silent data migration.
4. May I introduce **stable slugs** so labels become translatable and renameable? *(Strongly
   recommended, and cheapest now.)*

**Before Phase B:**
5. **System posts** — album upload, avatar change, scheduled: exempt from the 1-category
   minimum, or given a default?

**Before Phase C:** the **full-page Create screens**.
**Before Phase D:** the **web design**.

**Nothing above is started. This is an audit.**
