# Smart Photo Plan — U5 backfill (old post photos → the v2 set)

## Why this shape

The new display code (U2–U4) finds a photo's copies **only through the `-l4`
marker in its URL** (`src/lib/imageLadder.ts`, `photoSetUrl`). The S3 backfill
(`tools/media-derivatives/run.mjs`) writes a different ladder
(`post-images/<owner>/d/<media>/w600|1080|1440`) and only for posts with
`post_media` rows — on production every photo post stores its photos in
`posts.image_urls` instead. So U5 writes a `-l4` set **beside** each old photo
and, as a separate audited step, swaps the post's URLs to it.

## The three steps

| Step | What | Changes what members see? | Where |
|---|---|---|---|
| 1 copies | worker → Pages routes → `-l4` set beside each old photo, recorded only when every copy is in the store | **No** (posts keep their URLs) | `tools/media-derivatives/photo-set.mjs`, `functions/api/media/photoset/*`, `20261110_0101` |
| 2 census | which old photos have their set (PASS = none missing) | No (read-only) | `PROBE_20261110_0101_photo_set_census.sql` |
| 3 swap | posts.image_urls / thumbnail_urls / image_url / thumbnail_url → the new URLs, per post, only when every in-scope photo of it is recorded; full before/after kept | **Yes** (credited 2048 in full screen, smaller copies in the feed — on every app version) | `20261110_0102` + its ROLLBACK and PROBE |

**Gate on production:** step 3 refuses while `photo_set_v2` is `off`
(`U5-0102-PRE-003`). It runs only after the Owner has switched the new photos
on himself and said "swap OK". The rollback restores every post exactly
(fixture: byte-for-byte against a snapshot) and is safe at any time until U7.

## Names (one rule, `src/lib/media/photoSetBackfill.ts` = the SQL `photo_set_backfill_new_url`)

`<old name without .webp>-w{W}h{H}-l4.webp` (+ `-l4-r1080`, `-l4-thumb`, `-l4-r320`).
The **whole** old name is the stem, so two old photos in one folder can never
get the same new key (`x.webp` and `x-w1080h719.webp` would otherwise collide).
Copies follow the uploader's plan exactly (no upscaling; 1080 only above 1080,
320 only above 320; qualities 0.85 / 0.82 / 0.78 / 0.75). The 2048 copy carries
"© <name>, 50mm Retina World" drawn with the uploader's geometry
(`tools/media-derivatives/credit-svg.mjs`, parity test). Whose name: the owner
of the folder the photo was uploaded to (the photographer), profile full name,
else handle; an admin's photos carry the brand alone (as `resolveName`).

## Scope (measured 2026-11-03, anon read of public posts)

| Class | production (654 public photos) | staging |
|---|---|---|
| old photos in the lane's photo bucket (`post-images/…`) — **converted** | 370 `-l3` + 138 `-wWhH` + 70 plain + 19 root folder | 1 + 1 |
| avatars bucket (My Photos files, profile pictures) — shown as today | 37 | 0 |
| Supabase storage (pre-R2) — shown as today | 20 | 0 |
| other hosts (picsum test images) — shown as today | 0 | 6 |

Friends-only / only-me posts are not visible to the anon read; the census
(run as the database) counts every post.

## Safety

* Routes: admin / converter JWT only (SQL `PHOTO-BF-001`); every key derived
  server-side from the source key the SQL names; source must be an old photo in
  a member's `post-images` folder; body must be a WebP of the exact planned
  size; **never overwrite, never delete** (an existing object is taken only if it
  is a WebP of exactly that copy's size); `done` HEADs every copy before the
  record. Tests: `src/lib/media/__tests__/photoSetBackfill*.test.ts`,
  `photoSetCreditSvg.test.ts` — every one seen failing first.
* SQL: fixture `scripts/db-photo-set-backfill-fixture.mjs` on both lane shapes
  (CI `d1-photo-set-backfill-fixture.yml`).
* The backfill record keeps every old URL, which is the list U7 starts from.
* Orphan report: recorded new copies count as referenced before the swap;
  after it, the old files stay referenced through `photo_set_swap.old_*` (the
  swap rollback needs them) until U7 retires those rows.

## Known limits (independent review of #832, recorded)

* `put` checks "nothing at the key" and then writes (two R2 calls, not one
  conditional put). Only this route writes these keys and runs are
  serialised per lane (workflow concurrency), so there is no second writer.
* `photo_set_backfill_record` is callable by an admin / the converter directly,
  without the `done` route's per-copy HEAD. The worker never does that; a
  person doing it by hand could make the swap point at a missing copy.
* Photos past slot 50 of one post are not queued (no post on either lane has
  more than 10); such a post would stay MISSING in the census and never swap.
* When `thumbnail_urls` was NULL and a post mixes converted and unconverted
  photos, the swap writes NULL into the unconverted slots (the display falls
  back to the photo itself, as for any missing thumb). Rolled back exactly.
