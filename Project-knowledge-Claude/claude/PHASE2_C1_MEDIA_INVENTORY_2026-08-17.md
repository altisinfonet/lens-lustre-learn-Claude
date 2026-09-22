# PHASE 2 · CONTROL CYCLE 1 — read-only media inventory

No production change. Reads only.

## THE HEADLINE

**The media engine is fully built and completely unused.** `media_objects` has
a strong, well-constrained schema, RLS, 2 policies and all eight functions
(`media_begin_upload`, `media_mark_ready`, `media_mark_verified`,
`media_quarantine`, `post_publish_with_media`, `set_write_path`, plus two state
triggers). It holds **0 rows**. `post_media` holds **0 rows**. **No client code
calls any of it** — grepped across `src/`, zero non-test references.

Everything a member uploads still goes through the old path: file → canvas
re-encode → `storage.upload` → the URL string is appended to
`posts.image_urls[]`. Phase 2 is therefore not "finish the engine" — it is
"connect the engine and migrate onto it".

## MEASURED — the existing photographs

```
total photographs                282   (was 275 this morning; 20 posts in 24h — live drift)
distinct posts                   234
host cdn.50mmretina.com          254
host Supabase storage             28
other / unknown host               0
owner missing from auth.users      0   ← every photo has a valid owner
mime                             279 webp, 3 jpg
dimensions in filename           128
NO dimensions anywhere           154   ← 55%
1080/1440 ladder marker           14   ← 5%
posts with thumbnail_urls        224 posts / 272 entries
photos whose post has no thumb    10
```

## MEASURED — storage, buckets, orphans

```
buckets   avatars PUBLIC · competition-photos PUBLIC · course-images PUBLIC
          email-assets PUBLIC · entry-originals private · journal-images PUBLIC
          national-ids private · portfolio-images PUBLIC · post-images PUBLIC
          site-assets PUBLIC · support-attachments private
storage objects              151 total (post-images 116, avatars 14, email-assets 14, site-assets 7)
storage.objects RLS policies  42
ORPHANS in post-images        46 of 116  ← referenced by no post, draft or scheduled post
post_drafts rows               2
scheduled_posts rows           1
posts.privacy                  public = 234  (nothing else exists yet)
```

## WHAT IS ALREADY PRESENT

- `media_objects` with `owner_id → auth.users ON DELETE CASCADE`, sha256 (32-byte
  check), width/height bounds, mime allow-list, `visibility ∈ public|restricted|private`,
  `state ∈ pending|verified|ready|quarantined`, `derivatives jsonb` with a check
  that a `ready` row must carry an `original` key, quarantine-needs-reason.
- All eight media functions, plus `tg_media_state_transition` and
  `tg_post_media_requires_ready`.
- GPS/EXIF design is real and documented: canvas re-encode strips metadata as a
  side effect; `exifExtract` uses a PICK list that excludes GPS; `gpsGuard`
  closes the encode-failure fallback with three outcomes — no GPS → upload
  as-is, GPS in JPEG → segments spliced and the strip re-verified, GPS in an
  undecodable file → **refused**. Fail-closed on doubt.
- A working 600px thumbnail at upload, and a `-l3` ladder generator (600/1080/1440)
  that began producing on 2026-08-16.
- `post_drafts` (with `image_urls`, `thumbnail_urls`, `expiring_at`) is the de
  facto persistence for work in progress.

## WHAT IS MISSING

- **Any row in `media_objects` / `post_media`.** The canonical metadata store is
  empty, so width/height/aspect/sha256/state/visibility exist for **no** photo.
- **Any client call** into the media engine. `post_publish_with_media` is never
  invoked; publishing uses `publish_post_draft` / direct inserts.
- **Derivatives for 268 of 282 photographs** (only 14 carry `-l3`).
- **Dimensions for 154 of 282** — the filename is the only source today and it
  is absent for 55%.
- **The canonical Image Delivery Resolver** — not started (Phase 1 item 12,
  deliberately deferred).
- **Media authorization.** `post-images` is a PUBLIC bucket; any URL is readable
  by anyone. There is no authorized delivery path, which is the long-standing
  B5 red cell.
- **Privacy transitions and CDN cache invalidation** — nothing exists; also
  moot until authorization exists.
- **Resumable / chunked upload — NONE.** No `tus`, no multipart, no chunking, no
  `Range`, no persistent client-side pending state (no localStorage/IndexedDB in
  the upload path). Recovery today is: the member re-picks the photo. `post_drafts`
  preserves *already-uploaded* URLs, not an interrupted upload.
- **No retry/backoff** in `storageUpload.ts`.

## RISKS / BLOCKERS

1. **R2/CDN objects cannot be enumerated from here.** 254 of 282 photographs live
   on `cdn.50mmretina.com`, not in `storage.objects`. Orphan and integrity
   measurement for those is impossible without Cloudflare access, which I must
   never hold. **Orphan cleanup can only be proven for the 28 Supabase-hosted
   photos + the 116 bucket objects.**
2. **46 orphaned objects already exist** in `post-images` — 40% of that bucket.
   Cause not yet established (failed publishes? deleted posts? the very
   blocker fixed today?). Must be understood before any cleanup, and cleanup is
   destructive so it needs its own cycle.
3. **154 photographs have no dimensions available anywhere.** Backfilling
   `media_objects.width/height` (NOT NULL) for them requires reading each file's
   header from the CDN. That is 154 HTTP range reads — feasible, but it is a
   real job with its own failure modes, and it is the gate on items 3 and 4.
4. **`media_objects.sha256` is NOT NULL** and there is no stored hash for any
   existing photo. Backfill requires downloading each original — 282 files,
   hundreds of MB. This is the single biggest cost in the plan and needs an
   explicit decision.
5. **The platform is live and moving** — 20 posts in the last 24 hours. Any
   backfill must be re-runnable and must tolerate rows arriving mid-flight.
6. **All 234 posts are `privacy = 'public'`.** Items 10–12 (authorization,
   privacy transitions, cache invalidation) cannot be verified against real
   private data because none exists. They will need controlled fixtures.

## EXISTING PHOTO MIGRATION — classification

| | count | basis |
|---|---|---|
| **total** | **282** | live count, moving |
| **safely migratable now** | **128** | dimensions parseable from filename; owner valid; on a known host |
| **requiring special handling** | **154** | no dimensions anywhere — needs a header read per file before `media_objects` will accept them |
| **orphaned** | **46 bucket objects** | in `post-images`, referenced by nothing. **Photos** orphaned on R2: **UNKNOWN — not enumerable from here** |
| **unknown** | **254 on R2** | existence, byte size and hash unverified from this side; only their URLs are known |

Note: 0 photographs have a missing owner, and 0 sit on an unrecognised host —
so nothing is unmigratable for ownership or addressing reasons.

## PROPOSED NEXT PRODUCTION CHANGE

**None yet.** The next cycle should still be **read-only**: establish, for a
bounded sample, whether the 154 dimension-less photographs can have width/height
read cheaply (HTTP range request on the WebP/JPEG header) without downloading
whole files, and whether sha256 can be obtained at acceptable cost — because
those two answers decide the entire shape of items 3, 4 and 5.

If they cannot, the FINAL PLAN's requirement that `media_objects` be the
canonical metadata source needs revisiting before any production write, and per
the standing rule I would **STOP and report** rather than relax the NOT NULL
columns.
