# Pending jobs — as of 2026-08-13 (session close)

`origin/main` = `8259c5b`. Local-only commit `41b1989` (two SQL files, **not**
pushed, **not** applied). Newest applied migration in production is still
`20260813171159 feed_author_identity`.

---

## A. Blocked on the owner

| # | Job | State |
|---|---|---|
| A1 | **Apply `20260813190000_post_image_meta.sql`** — adds `posts.image_meta` (jsonb, per-slide, index-aligned), backfills the 105 slides whose filename carries `-wWhH`, and takes `get_broadcast_feed` from 15 to 16 returned columns across all three overloads. | Written + rollback written. **Not applied.** Awaiting review. |
| A2 | **Stage B2** — 1–5 category minimum. | Migration written previously, not applied, needs authorisation. |

## B. In flight — the image derivative pipeline

| # | Job | Note |
|---|---|---|
| B1 | Ship the two SQL files to GitHub via the Upload page. | **Only after A1 is applied.** Otherwise the repo carries a migration the database has never seen. |
| B2 | Backfill dimensions for the **153 slides with none**. | Server-side. `supabase/functions/backfill-thumbnails/` is the proven vehicle — same URL parsing (Supabase + CDN hosts), same batch shape. |
| B3 | Wire `src/lib/cdnImage.ts` into exactly one surface. | It has **zero non-test importers** today. Must land with a test asserting a non-test importer exists — trap #11 (`CreatePostModal.tsx` / `gallery.ts` were dead for weeks with green tests). |
| B4 | **Test `/cdn-cgi/image/` from the Android WebView origin.** | ⚠ NOT DONE. Verified today from `www` only: apex fails, `www` and `cdn` return 200. The app is a **third origin** and is the one that showed no photos for builds 1035–1051. Nothing ships before this. |
| B5 | Generate 1080/1440 derivatives (option C: store new, transform legacy). | Needs the encode off the main thread or done server-side — see D1. |
| B6 | Scheduled posts never get thumbnails. | Verified in the live schema: `scheduled_posts` has `image_url`/`image_urls` and **no thumbnail column**. 1 row today, so it is cheap now and only gets worse. |

## C. Defects found 2026-08-13, not yet fixed

| # | Defect | Severity |
|---|---|---|
| C1 | `src/__tests__/postCategoriesPhaseB.test.ts:51` pins `MIGRATION` to the hardcoded, **superseded** `20260812070000_post_categories.sql`. **Trap #8 recurring, live right now.** Each assertion was checked against the live definition — production still satisfies all of them, so nothing is broken — but the test would not notice if that stopped. Fix: resolve the newest definition at run time, as `feedFreshness.test.ts:49-60` already does. | Real, not urgent |
| C2 | `/cdn-cgi/image/` responses carry **no CORS headers**. `fetch()` fails on all widths; an `<img>` with `crossOrigin="anonymous"` fails to load entirely. `src/lib/imageCompression.ts:150-157` sets exactly that, and feeds `downloadImageAsJpeg()` → `DownloadButton`. A transformed URL must never reach the download or save-file path. Today it does not. Needs a guard **and** a test, or B3/B5 can silently turn "Download" into "opens a tab". | Latent, becomes real with B5 |
| C3 | Stored originals are ~2× heavier than their own resolution needs — 335 KB as served vs 157 KB for a local q82 re-encode of the same 2000×1333 pixels. Upload-encoder question, independent of the ladder. | Cost, not correctness |
| C4 | `get_broadcast_feed` 2-arg and 3-arg carry `PUBLIC EXECUTE`; the 4-arg does not. Postgres's create-time default, not a decision. Three SECURITY DEFINER functions over the same rows disagreeing about who may call them. | Normalised inside A1 — rides with it |

## D. Pre-existing backlog, untouched this session

1. **Upload reliability** — single unchunked PUT, no retry, 5-minute presign expiry; a multi-photo failure orphans bytes in R2 and a manual retry orphans another set. Compression runs on the main thread, twice per photo. ⚠ B5 would make this **4 encodes per photo** if done naively on the client.
2. **Feed RPC at scale** — `count(DISTINCT)` LATERAL over every visible post to return 10, a non-sargable privacy filter forcing a sequential scan, an exclude-id array that grows without limit. ⚠ **Measure before choosing a fix** — and at 210 posts today's `EXPLAIN ANALYZE` will say almost nothing, so this needs a seeded 100k-post copy before it can honestly start.
3. **Two SECURITY DEFINER findings** — `get_post_view_counts` has no privacy predicate and is granted to `authenticated`; `get_contributor_scores` is granted to `anon` and runs a full-table aggregate per call.
4. **Instagram-style in-app photo picker** — owner confirmed he wants it. Needs `@capacitor-community/media`, `READ_MEDIA_IMAGES`, Play data-safety justification.
5. **`ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` secrets** hold wrong values. Harmless — CI resolves both from the keystore itself.
6. **Verify on a real device** after the next Play rollout — contributor score, categories, comment typing, windowed feed under a long scroll.

---

## Not yet run this session

The full gate — `npx tsc --noEmit`, `npx vitest run`, `npm run build`,
`node scripts/security-audit.mjs` — has **not** been run. Nothing has needed it:
no TypeScript, no source file and no test has been changed. It must run before
anything in B or C is shipped.

No Android build has been cut, and none should be until a batch is complete.
