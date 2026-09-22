# PHASE B3 PRE-AUDIT — the derivative worker is not the next thing to build

**Date:** 2026-08-14 · read-only survey · no production change

I set out to design the derivative worker. Mapping the existing pipeline first
turned up four defects — and **one of them would have been triggered by the very
change I was about to make.**

---

## F1 — A deletion landmine, armed by the next obvious fix. **HIGHEST SEVERITY**

`supabase/functions/detect-orphan-files/index.ts` builds its "referenced files"
set from 21 tables. For posts it reads:

```
:39   SELECT image_url FROM posts WHERE image_url IS NOT NULL
:49   SELECT unnest(image_urls) AS image_url FROM posts WHERE array_length(image_urls,1) > 0
```

Occurrences of `thumbnail_urls` in that entire file: **zero**.

So **every `-thumb.webp` in the product is unreferenced by construction.**

It is harmless today purely by accident: the function enumerates candidate files
with `storage.from(bucket).list()` — *Supabase Storage* — while live uploads go
to *R2*. It is blind to the real object store, and a tool that sees nothing
deletes nothing.

**The obvious fix is to make it R2-aware. That is exactly what Phase B orphan
cleanup was scheduled to do.** Had I written that first, it would have
classified every thumbnail in production as a 30-day-old orphan.

Two independent bugs, each individually survivable, whose *repair order* is the
whole risk. The thumbnail reference must be added **before** the R2 fix, not
with it and not after it.

## F2 — No post media is reclaimable

`purge-s3-orphans/index.ts:202` scopes its sweep to `competition-photos/` only.
There is **no orphan sweep for `post-images/` on R2 at all.**

## F3 — No upload idempotency, and no retry where it matters

`src/lib/imageUpload.ts:56,83` — the object key is `Date.now()` plus base36
random. A retried upload therefore writes **new** objects and silently orphans
the previous ones.

`s3Upload.ts:130-133, 170-177` throw immediately on a failed PUT. The retry at
`s3Upload.ts:45-97` covers the **presign call only** — never the upload itself.
A failure on photo 3 of 5 strands the two already in R2.

Combined with F2: **those orphans cannot be reclaimed by any existing tool.**
Storage grows and nothing can clean it.

`media_begin_upload` (`20260814104119:144-223`) is the first idempotency
mechanism in the codebase. That capability is genuinely new, not a duplicate.

## F4 — Scheduled posts publish with no thumbnails, and cannot do otherwise

`publish-scheduled-posts/index.ts:224-244` inserts `image_urls` and `image_url`
and never `thumbnail_urls` — and `scheduled_posts` **has no such column**
(verified on production). The publisher could not set it if it wanted to.

**Measured on production:**

| | |
|---|---|
| posts carrying images | **210** |
| of those, no thumbnail at all | **9** (4.3%) |
| of those, thumbnail/image count mismatch | **0** |

Those 9 serve a **full-resolution original wherever a thumbnail is expected** —
the same class of problem `PostMedia.tsx:355-357` documents. The 0 mismatches
are good news: the misalignment path is not currently live.

---

## No duplication with the new media tables

Worth stating plainly, because it was the question I started with:

- `verify-image-hash` and `backfill-image-hashes` operate **only** on
  `competition_entries.photo_meta` — a different table, a different feature
  (contest integrity and plagiarism clustering), hashes stored as JSONB hex with
  **no uniqueness constraint at all**.
- `posts.content_hash` is `md5(content | image_urls | image_url)` — a **URL-string
  hash** used by `detect_duplicate_post` to reject a repeat post within 10
  minutes. It has never been an image content hash, and it changes if a URL
  changes.

So `media_objects.sha256` collides with nothing.

**One conflict to manage, not a defect:** the existing layout
`post-images/<uid>/posts/<ts>-<rand>-w<W>h<H>.webp` and the new
`media/<object_id>/<rung>.webp` will coexist in one R2 bucket during the
transition, and **neither orphan tool understands the new one.**

---

## Revised B3 plan

The derivative worker moves down the list. It is the largest piece of work in
the phase and it adds objects to a store that currently has no working reclaim
path — building it first means building a faster way to leak storage.

Proposed order, one variable per cycle:

1. **B3a — defuse F1.** Add `posts.thumbnail_urls` (and the new `post_media` →
   `media_objects.derivatives` paths) to the orphan reference set. Ship this
   **alone**, verified, before anything touches R2 enumeration.
2. **B3b — F2.** Make orphan detection R2-aware and extend the sweep to
   `post-images/`, dry-run enforced, with a hard floor on how much one run may
   delete.
3. **B3c — F4.** Add `thumbnail_urls` to `scheduled_posts` and populate it in
   the publisher; run `backfill-thumbnails` for the 9 existing posts.
4. **B3d — the derivative worker**, once the store it writes into is
   observable and reclaimable.

`media_objects` and `post_media` stay empty and unreferenced through B3a–B3c.
That is deliberate: `posts.image_urls` remains authoritative until there is a
worker and a reclaim path to justify moving.
