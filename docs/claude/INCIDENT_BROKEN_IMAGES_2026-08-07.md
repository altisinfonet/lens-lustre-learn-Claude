# Incident: "image broken — not fetching from source" (2026-08-07)

Owner report with 5 phone screenshots (~11:49): many posts show the branded
"50mm RETINA WORLD" placeholder instead of the photo — Feed and Wall, "happened
with many profile". Some posts loaded fine (Jul 28 trees, hands photo); the
broken ones included every Tanmay De Apr 7 post and Sudip Roy's Jul 29 post.
Avatars loaded fine throughout.

## Root cause — MEASURED, two bugs interacting

**Bug 1 (mine, shipped this morning in d636408): the thumbnail address was
GUESSED, not read.** `buildCdnThumb()` derived `<original>-thumb.webp` on
cdn.50mmretina.com by string rule. Measured against production data
(anon-key REST, 168 posts with images):

| posts | stored thumbnail location | result with derivation |
|---|---|---|
| 104 | cdn.50mmretina.com (derived == stored) | worked |
| **56** | **Supabase storage** (`.../storage/v1/object/public/post-images/...-thumb.webp`) | **derived CDN address does not exist → broken** |
| 8 | none on record | fell back (heavy but fine) |
| 0 | misaligned arrays | — |

The pre-R2-migration posts have CDN originals but Supabase-hosted thumbnails.
The uploader records the true address in `posts.thumbnail_urls`; the derivation
ignored the authoritative column. (Verified: the stored Supabase thumb for the
"Heaven" post returns 200 image/webp, 62KB. Note: cdn.50mmretina.com returns
403 to this sandbox for ALL urls — Cloudflare bot-blocking; do not read
sandbox 403s as real status.)

**Bug 2 (latent, in src/lib/imageFallback.ts): the global retry timer clobbers
an src the component legitimately changed.** ProgressiveImage's onError DID
swap the dead thumb for the original via React — but the global capture-phase
retrier had already scheduled a retry OF THE DEAD THUMB, and its 400ms/1200ms
timers wrote that dead url straight over React's healthy fallback (React does
not re-write an attribute its virtual DOM says is unchanged). After 2 dead
retries the retrier permanently installed the branded placeholder. That is
exactly the screenshot. The existing recycled-node guard (dataset check)
could not catch this because the dataset was written by the retrier itself.

## The fix (on main, commits 2d35606 → cf74402 + follow-ups)

1. `src/lib/imageFallback.ts` — the retry timer now ALSO drops the retry when
   the element's current (stripped) src is no longer the url being retried.
   Whatever changed the address wins. Pinned in imageFallbackRecycle.test.ts.
2. **Never guess again**: `buildCdnThumb` deleted. PostMedia takes a
   `thumbUrls` prop; ProgressiveImage shows the STORED thumbnail verbatim
   (whichever host), the original when none, GIF/SVG always original.
   Pinned in PostMediaFrame.test.tsx (incl. "never derives by string rule").
3. Plumbing: `UnifiedPost.thumbnail_urls`; useUserPostsQuery maps it (its
   select("*") already fetched it); useFeedQuery batch-fetches
   `posts.id,thumbnail_urls` for the page's ids inside the existing
   Promise.all — the do-not-touch get_broadcast_feed RPC is NOT touched.
   PostCard passes thumbs only when the array aligns 1:1 with images.

Net effect: the 56 broken posts are fixed AND get real 600px thumbnails
(better than pre-incident, when they shipped full originals); the 104 keep
working; the 8 with no record show originals as always.

Verification: tsc exit 0; full suite 905 passed / 25 failed (the documented
pre-existing set, none in touched files) / 1 skipped; changed-file lint debt
identical to origin; every landed file byte-diffed against origin/main.

## Delivery state
- WEB: fix is on main → Cloudflare Pages deploys automatically. Fixed for
  browsers as soon as the deploy completes.
- APP: build 1057 bundles the broken code. **Build 1058 must be cut** to carry
  the fix to phones. Two cosmetic pushes also pending (imageFallbackRecycle
  test pin, marker bump to 2026-08-07-7) — blocked because the Chrome
  extension disconnected mid-push; complete them before/with the 1058 cut.

## Lessons
- **Read the authoritative data, never derive an address by string rule.**
  posts.thumbnail_urls existed the whole time and says exactly where each
  thumb lives. The derivation "safe fallback" reasoning missed that a global
  error handler owned the failure path.
- **Any component-level image fallback interacts with the global retrier in
  imageFallback.ts.** Before shipping one, re-read that file. The new guard
  makes component fallbacks win, but the interaction must be considered.
- cdn.50mmretina.com 403s from datacenter IPs — test image urls from a real
  browser/phone, or compare against a known-working url before concluding.
