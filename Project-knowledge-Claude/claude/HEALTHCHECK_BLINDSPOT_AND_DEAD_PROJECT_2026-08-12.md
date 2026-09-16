# Broken photos on member Walls — diagnosed + fix ready — 2026-08-12

Owner reported broken images while the health check said HEALTHY. He was right.
Confirmed from his screenshots: the broken posts are captioned "Nathula Pass...",
"Zuluk..", "Udaypur", "Pose...", "updated their cover photo." — every one of them is
in the affected set below. "Red Crab..." rendered fine, and it is NOT in the set.

## ROOT CAUSE (confirmed)

28 photos across **16 posts, 5 members**, dated **2026-03-13 → 2026-04-02**, store their
full-size address on `isywidnfnjhtydmdfgtk.supabase.co` — an OLD Supabase project ref,
not the live one (`jtdtehuqtinjxropkkcn`). That hostname **does not resolve at all**.
The original files are permanently gone.

Verified it is NOT the sandbox egress block:

| host | result |
|---|---|
| `cdn.50mmretina.com` | resolves, HTTP **403 "Host not in allowlist"** ← sandbox block |
| `example.com` | resolves, HTTP **403 "Host not in allowlist"** ← sandbox block |
| `jtdtehuqtinjxropkkcn.supabase.co` | resolves, answers ← reachable |
| `isywidnfnjhtydmdfgtk.supabase.co` | **DNS ENOTFOUND** ← does not exist |
| `zzzznotarealproject12345.supabase.co` | DNS ENOTFOUND ← identical shape |

A blocked host still resolves and answers 403. This one does not exist.

Affected members: `622dada0` (5 posts), `85250f9f` (8), `83f6d083` (1), `cc691988` (1),
`5745a9c9` (1).

**All 28 dead photos still have a working 600px thumbnail** on the live project —
28 of 28 returned image bytes, index-matched to `image_urls` (verified aligned on all
16 posts). So every photo is recoverable at 600px.

## WHY IT LOOKS BROKEN RATHER THAN SOFT — `PostMedia.tsx`

`ProgressiveImage` paints the stored thumbnail as a blurred backdrop but the sharp layer
is **always the ORIGINAL**. When the original errors:

```
onError → setFailed(true) → src={failed ? src : sharpSrc}   // retries the SAME dead URL
const thumb = !transformable && !failed ? usableThumb(...) : null;   // thumbnail DISCARDED
```

so `failed` both retries the dead address and throws away the good thumbnail, which the
backdrop then falls back off too. **One dead original blanks both layers.** A fallback to
the stored thumbnail would have rendered these 16 posts slightly soft instead of broken,
for five months.

## THE FIX — data, no build required

Delivered as `FIX_broken_images_2026-08-12.sql`. Backs up to
`posts_dead_host_backup_20260812`, repoints the 28 dead entries to their surviving
thumbnails, verifies, and has an undo. Photos return at 600px; the originals cannot be
recovered.

Applies to the **website and the already-installed Android app at the same time** — it is
stored data, so no new build.

**Tested end to end on local Postgres 16 loaded with a copy of the real 200 posts:**
16 broken rows → 0, photo counts unchanged, no healthy URL altered, no other row touched.
Step 1 sweep re-tested against a decoy table (reports only real hits, with real counts).

### Not applied from this session
- Supabase writes: anon key correctly denied (idempotent PATCH on a real row → 0 rows).
  RLS is doing its job; owner must run the SQL.
- Git push: blocked — repo not in this session's authorised set.

## STILL OPEN

1. **The code fix** (`PostMedia.tsx` thumbnail fallback). Needs a website deploy AND a new
   Android build. Prevents the next dead-URL family from blanking posts.
2. **The health check's blind spot.** `checkImagesLoad()` only tests `supabase.co`
   thumbnails, and the 77 of those are all OLD posts — every post in the last 7 days is
   100% CDN-hosted. It sampled 25 old images and printed an unqualified HEALTHY. Worse:
   it only ever samples **`thumbnail_urls[0]`**, and the dead URLs are all in
   **`image_urls`** — so this outage was structurally invisible to it. It should test
   `image_urls` too, and say which hosts it could not reach.
3. **Add a DNS-resolution check** for every image host on record. Cheap, and it would have
   caught this in March.
4. `profiles` returns 0 rows to the anon key (RLS), so avatars/covers were not checked —
   one dead-host `/avatars/` URL did appear in post data. Step 1 of the SQL sweeps every
   table for the dead host and will show if profiles are affected.
5. Post scan is capped at the 200 newest posts (PostgREST max-rows); older posts may hold
   more dead-host URLs. Step 1 covers the whole table.
