# Status — what is done, what is left

As of `origin/main` = **`c7c591b`**, 2026-08-14.

## ⚠ Read this first — where the Android app actually is

| Build | Version | State |
|---|---|---|
| 1073 | 1.2.2 | **What users have now** — live in Play |
| 1086 | 1.2.4 | **HALTED in Play. Do not ship.** `+ Create` sat in the middle of the top bar over the wordmark; verified members showed no blue tick. |
| **1088** | **1.2.5** | **Green, artifacts ready, waiting for the owner to upload.** Fixes both 1086 defects and carries everything 1086 carried. |

Run #88 · commit `c7c591b` ·
https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/31772341968
Artifacts: `app-debug-apk-SIDELOAD-THIS` (13.85 MB), `app-release-aab` (8.42 MB).

**Before promoting 1088, check on the phone:** `+ Create` in the left corner
clear of the wordmark · the tick on a verified member **as author AND as a
tagged name** in "with X" · hard scroll and back with no blank cards or scroll
jump · comment typing · a like moving by exactly one.

---

## Done and live

### Applied to the production database

**`get_broadcast_feed` now returns 15 columns instead of 11** — `author_name`,
`author_avatar`, `thumbnail_urls`, `categories` travel **with** the post.

This closed the "names showing as ?" complaint at its root. Previously the post
came from one request and the author's name from a second, independent one, so
"post visible, name missing" was a state the system could be in — and the client
had to invent a placeholder to fill the gap. It no longer can be.

Verified end-to-end as an anonymous caller: 200 OK, real names and avatars on
every row. Also restored the `COALESCE(_exclude_ids, '{}')` guard, so a NULL
exclusion list returns rows instead of an empty feed reported as success.

Rollback: `supabase/rollback/20260813120000_feed_author_identity_ROLLBACK.sql`
(round-trip tested).

### Shipped to web and app

| Fix | What it means for a member |
|---|---|
| **`+ Create` in the left corner** | It was dead centre on top of the wordmark in 1086. Icon only now, no caption. Measured: 24px from the edge, 8px clear of the title. |
| **The blue tick appears for verified members** | Tagged names *and* post authors. The badge now travels with the post instead of a second lookup that could come back empty. |
| **Feed windowing** | Cards unmount ~2 screens away. 100 mounted cards used to be the out-of-memory crash on a mid-range Android. |
| **14.7 MB backdrop removed** | A blurred decorative layer was downloading the full 2560px original. |
| **`maxPages: 5`** | React Query stops retaining every page ever fetched. |
| **Realtime: 9 → 5 bindings** | Two entire high-frequency tables out of the broadcast set; counters now come from the server, not client-side deltas that could drift forever. |
| **Capacitor pinned** | The native layer no longer changes with the calendar. It caught a real breakage within one build. |
| **Slow-network feed** | Stopped announcing "No posts yet" when the real problem was a dropped request. |
| **Drafts** | Stopped reporting a failed fetch as "you have no drafts". |
| **`+ Create` button** | App posts from the top bar; the Facebook-style composer row is web-only. |
| **Blue tick on tagged names** | The badge now shows with the name everywhere, including "with X". |
| **Two in-render components hoisted** | Judge scoring no longer loses in-progress scores. |

Gates on every commit: typecheck clean · **1,345 tests** · build clean ·
security audit 0 critical / 0 high. Android build green, 36/36 steps.

---

## Next up: the image derivative pipeline

**This is the biggest remaining user-visible win, and it is a project, not a
configuration tweak.**

Today there are effectively **two** sizes — a 600px thumbnail and the original.
A phone slot needing ~1,070 device px skips the 600 and downloads the **2560px
original**. What is needed:

```
original upload
   ├── thumbnail (~600px)    lists and grids
   ├── feed      (~1200px)   the feed card         ← MISSING
   ├── detail    (~2000px)   full-screen viewer    ← MISSING
   └── original              zoom / download only
```

⚠ **Choose the sizes from real device measurements, not round numbers.** The
current 600→2560 gap is exactly what arbitrary numbers produce.

⚠ **Read trap #1 first.** A previous attempt at this broke every photo for every
`www` and Android user for four days. A corrected transform layer already exists
at `src/lib/cdnImage.ts` with zero importers — read it before writing a new one.

Also in scope: **scheduled posts never get thumbnails.** `scheduled_posts` has
no thumbnail column, so every scheduled post serves full-size originals forever —
the thumbnails are generated and uploaded, then orphaned.

---

## The rest of the backlog

1. **Upload reliability** — single unchunked PUT, no retry, 5-minute presign
   expiry; a multi-photo failure orphans bytes in R2 and a manual retry orphans
   another set. Compression also runs on the main thread, twice per photo.
2. **Feed RPC at scale** — a `count(DISTINCT)` LATERAL over *every* visible post
   to return 10, a non-sargable privacy filter that forces a sequential scan, and
   an exclude-id array that grows without limit (page 20 uploads 200 UUIDs).
   ⚠ **Measure before choosing a fix.** `EXPLAIN ANALYZE` at today's row counts,
   then against a seeded 100k-post copy, then compare `is_public` denormalisation
   against fan-out. Do not build fan-out on theory.
3. **Two SECURITY DEFINER findings** — `get_post_view_counts` has no privacy
   predicate and is granted to `authenticated`; `get_contributor_scores` is
   granted to `anon` and runs a full-table aggregate per call.
4. **Instagram-style in-app photo picker** — owner confirmed he wants it. Needs
   `@capacitor-community/media`, `READ_MEDIA_IMAGES`, and a Play data-safety
   justification.
5. **Stage B2** (1–5 category minimum) — migration written, not applied, owner
   must authorise.
6. **`ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` secrets** hold wrong values.
   Harmless since CI resolves both from the keystore itself; fix at leisure.
7. **Verify on a real device** after the next Play rollout — contributor score,
   categories, comment typing, and the windowed feed under a long scroll.
8. **Retire the per-name badge lookup entirely.** `AutoBadge` is still the
   fallback in `TaggedPeople` and `UserIdentityBlock` for callers that do not
   pass `badges`. Migrate the remaining producers, then delete the fallback —
   while it exists, a caller can quietly go back to the slow, failable path.

Nothing in this list is on fire. Nothing is half-done.
