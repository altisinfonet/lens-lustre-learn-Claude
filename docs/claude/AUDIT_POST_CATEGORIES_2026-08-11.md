# AUDIT — PER-POST CATEGORIES + FULL-PAGE CREATE

**Date:** 2026-08-11
**Status:** AUDIT ONLY. No code written. Nothing changed.
**Verdict:** Yes, this is possible on the existing build system. No new dependency, no new service, no architectural change. But there are **five things that will bite** if they are not decided before a line is written, and one of them is a silent data migration.

---

## 1. WHAT YOU ALREADY HAVE

### Registration / onboarding — you have MORE than you think, and LESS

**It works, and it is already multi-select with a minimum of 1.**

| | |
|---|---|
| Component | `src/components/OnboardingModal.tsx` — a post-signup gate modal, **not** part of `Signup.tsx` |
| Picker | Plain `<button>` chips in a `flex flex-wrap` row, toggle on click, live "N selected" counter |
| Minimum | **1, enforced** — `selectedInterests.length > 0`, toast *"Please select at least one photography interest"* |
| Maximum | **None.** No upper bound in the client or the database |
| Stored in | `profiles.photography_interests` — **`TEXT[]`** |
| Also edited at | `src/pages/EditProfile.tsx` |
| Also filtered at | `src/pages/Discover.tsx` — `.overlaps("photography_interests", selected)` |

**The list is 15 items, and it is hardcoded three times, verbatim:**

`OnboardingModal.tsx:22`, `EditProfile.tsx:29`, `Discover.tsx:19`

```
Wildlife, Street, Portrait, Aerial, Documentary, Landscape, Architecture,
Macro, Sports, Fashion, Underwater, Astrophotography, Food, Travel, Abstract
```

**Three facts about this that matter:**

1. **There is no ids/slugs layer. The English label IS the stored value.** `"Astrophotography"` is literally what sits in the database.
2. **There is no database validation at all** — no enum, no CHECK, no FK, no `categories` table. Any string can be persisted. Validity is enforced only by the client rendering a fixed list.
3. **The labels are not translated.** A Tamil or Bengali member sees "Underwater" and "Astrophotography" in English. The section heading is translated (`disc.interests`); the chips are not — and they *cannot* be, as long as the label is the storage key.

### Upload / create post

| | |
|---|---|
| Component | `src/components/WallPosts.tsx` (1,267 lines) — an **inline card at the top of the feed**, not a modal and not a page |
| Mounted at | `Feed.tsx:270` (`composerOnly`) and `PublicProfile.tsx:748` |
| Route | **There is no `/create` route.** None exists |
| Photos | Up to **10** per post, WebP q=0.92, capped 2560px, security-scanned per file |
| Stored in | `posts.image_urls[]` + `posts.thumbnail_urls[]` — **no separate images table** |
| Insert | Direct client `supabase.from("posts").insert(...)` — no RPC, no edge function |

Metadata a member can attach **today**: caption (≤2200), @mentions, `#hashtags` typed into the caption, privacy (public/friends/private), search-engine opt-out, tagged members with x/y per photo, scheduled publish.

**Not supported today:** category, genre, title, alt text, location, EXIF *(the WebP re-encode strips it)*.

### The `posts` table — 15 columns, and none of them is a category

```
id, user_id, content, content_hash, image_url, image_urls,
thumbnail_url, thumbnail_urls, privacy, indexing_disabled,
likes_count, comments_count, shares_count, created_at, updated_at
```

`Relationships: []`. **This is greenfield.** There is nothing to repurpose and nothing being under-used.

### The category strip in your screenshot — it does not exist

I searched for it specifically. `src/pages/Feed.tsx` renders, in order: stories bar → birthday strip → composer → posts. Nothing sits between the header and the stories row. A repo-wide search for the icons in your design (`PawPrint`, `Mountain`, `Luggage`, `Footprints`, `Plane`, `Flower`) returns **zero hits**.

Your screenshot is your design, not a screenshot of a half-built feature. That is good news — nothing to unpick.

**The closest working precedent** is the marketing home page (`Index.tsx:685`): categories derived from the data, `activeCategory` state, client-side `.filter()`. It works because it filters an already-loaded array of `portfolio_images`. **The feed cannot copy it** — the feed is a paginated RPC.

### The feed query — the one piece that needs care

- `src/hooks/feed/useFeedQuery.ts` → `supabase.rpc("get_broadcast_feed", { _exclude_ids, _limit, _newest_first })`
- **Query key is `["feed"]` with no parameters** (`src/lib/queryKeys.ts:61`)
- The RPC is deliberately VOLATILE — it re-deals on every call ("unseen first, fewest viewers first, then newest") for reach fairness
- Page size 10, infinite scroll, first page persisted to localStorage

A category filter has to be threaded into **both** the RPC signature and the query key. If the key is not changed, the cache will serve "Portrait" results under "All".

### Bottom nav

`src/components/MobileBottomNav.tsx` — a signed-in member sees 5 tabs: Feed, Wall, **Home (centre)**, Compete, Profile. **The centre slot is Home, not a "+" composer.** There is no create entry point anywhere in the bottom nav today.

---

## 2. YOUR NEW LIST vs WHAT IS STORED

Your list is **46 categories**. Registration currently has **15**.

I checked all 15 against your 46. **Fourteen match exactly. One does not:**

> **`Astrophotography` (stored today) vs `Astro` (your list).**

That single word is a data migration, not a rename. Every member who picked it has the string `"Astrophotography"` sitting in `profiles.photography_interests`, and `Discover`'s `overlaps` query matches on that exact string. Change the label without migrating the rows and those members silently lose the interest and stop appearing in that Discover filter.

**This is exactly why the label-as-key design has to go before the list grows to 46.** With 15 hardcoded strings in 3 files it was survivable. At 46, used in registration *and* on every upload *and* in a feed filter *and* in the strip, it is not.

---

## 3. IS IT POSSIBLE? — YES

Nothing here is exotic. Everything maps onto patterns already in this codebase.

| What you asked for | How it lands | Difficulty |
|---|---|---|
| 1–5 categories per image | New `posts.categories text[]` + GIN index. Same shape as `profiles.photography_interests`, which already works | **Easy** |
| Min 1 / max 5 enforced | DB `CHECK (array_length between 1 and 5)` + client gate. **Must be both** — see risk #1 | **Easy, but see risk #1** |
| Same list at registration and upload | One shared constant/table, imported everywhere. Deletes the triplication | **Easy** |
| Category strip filters the feed | Add `_categories` param to `get_broadcast_feed`, add it to the query key | **Medium** — touching the hottest query in the app |
| "All" = everything | Pass null/empty → RPC skips the filter. Old posts keep working untouched | **Easy** |
| Old posts stay in "All" only | Exactly what happens with no backfill. **No migration of existing posts needed** — as you asked | **Free** |
| Full-page Create, web + app | New route + move the composer into it | **Medium-high** — see risk #2 |

**On storage shape:** `text[]` with a GIN index and the `&&` overlap operator, not a join table. A join table is more textbook, but it adds a join to the single hottest query in the product, and you already have a working precedent for `text[]` filtering in `Discover`. One column, one index, one operator.

---

## 4. THE FIVE THINGS THAT WILL BITE

### Risk 1 — "minimum 1 category" will break three other code paths *(this is the big one)*

The composer is **not** the only thing that inserts into `posts`. There are four paths:

| Path | File | Has a human choosing categories? |
|---|---|---|
| The composer | `WallPosts.tsx:594` | Yes |
| **Album upload auto-post** | `MyPhotos.tsx:353` — *"added N photos to the album X"* | **No** |
| **Profile-update post** | `lib/profilePostHelper.ts:24` — fires on avatar/cover change | **No** |
| **Scheduled posts** | `supabase/functions/publish-scheduled-posts/index.ts:217` — service-role insert | **No** — and it does not carry the field |

Put a `NOT NULL` / minimum-1 constraint on the table and **three of the four break immediately** — album uploads stop working, changing an avatar throws, and the scheduled-posts cron starts failing silently at 5-second intervals.

They need either an exemption (a system-post flag) or a default. This must be decided up front, not discovered in production.

*Separately, while I was in there: `publish-scheduled-posts` already drops `thumbnail_urls` on the way through, so scheduled posts serve full-size images in feed grids. Pre-existing, unrelated, but it will need the same fix when categories are threaded through.*

### Risk 2 — the full-page Create must **move** the composer, not clone it

`WallPosts.tsx` carries 1,267 lines of hard-won behaviour: the Android stale-file-handle fix, the security-scan rebuild-and-retry path, per-photo opt-in crop, tag coordinates, the schedule window, mention conversion, structured logging with correlation IDs.

If the new page reimplements any of that, you get two composers that drift, and bugs you already fixed come back on one of them. The page has to **reuse** it — the same component, or the composer internals lifted into a shared hook.

Note the composer is also mounted on `PublicProfile` (your Wall). Whatever happens must keep the Wall working.

### Risk 3 — 46 categories will not fit in the strip

Your design shows **8** chips (All + 7). You have **46**. Something has to decide which 7–10 appear, and whether the rest are reachable.

This is a product decision, not a technical one, and I am not going to guess it.

### Risk 4 — labels as storage keys

Already covered above. If this is not fixed now, the categories can never be translated into your 7 languages, and every future rename is a data migration.

The fix is small **if done first**: store a stable slug, display a translated label. Done later, it is 46 strings across every post in the database.

### Risk 5 — hashtags already do this job badly, and will now overlap

Hashtags are your de-facto classification today, and they are `ilike '%#tag%'` — an unindexed full-table scan that matches substrings (`#street` also matches `#streetphotography`). Categories will sit right next to them doing a similar job, properly.

Not a blocker. But it is worth deciding whether hashtags stay as free-form flavour and categories become the real taxonomy, or whether they merge.

---

## 5. DECISIONS I NEED FROM YOU BEFORE ANY CODE

1. **Registration:** does it move from 15 categories to all 46, or does registration keep a shorter list while upload gets all 46?
2. **`Astrophotography` → `Astro`:** rename and migrate the existing rows, or keep the longer label in your list?
3. **Slugs:** may I introduce a stable id per category now, so the labels become translatable and renameable? (Strongly recommended, and cheapest today.)
4. **The strip:** which categories appear, and how are they chosen — fixed list, admin-configurable, or most-used?
5. **System posts** (album upload, avatar change, scheduled): exempt from the minimum, or given a default category?
6. **Are the 46 final?** Some are close cousins that members will confuse — Nature/Wildlife/Bird, Documentary/Photojournalism, Fine Art/Conceptual/Experimental, Commercial/Product/Industrial. Merging is much easier before launch than after.

---

## 6. SHAPE OF THE WORK (for later — not started)

Roughly four phases, each independently shippable and each verifiable before the next:

1. **Taxonomy** — one shared source of truth, slugs, i18n labels, de-triplicate the three files. *No behaviour change.*
2. **Database** — `posts.categories`, GIN index, CHECK constraint, the four insert paths made safe, `get_broadcast_feed` gains an optional filter. *No UI change.*
3. **Create page** — full-page composer, web + app, reusing the existing composer. Category picker with the 1–5 gate.
4. **Feed strip** — the chip row, wired to the query key.

Existing posts are never touched. They stay visible under "All", exactly as you asked.

**Nothing above is started. This is an audit.**
