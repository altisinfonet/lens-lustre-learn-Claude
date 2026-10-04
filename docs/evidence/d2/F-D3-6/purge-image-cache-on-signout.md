# F-D3-6 — purge the image service-worker cache on sign-out

**Finding (D3 handoff, 2026-10-04):** "Image SW caches post-images (incl. Friends-only) and is never purged on sign-out
(INFERRED, D-002-adjacent)." Confirmed from the code: `public/sw-image-cache.js` stores up to 200 images from
`post-images`, `portfolio-images`, `competition-photos`, `site-assets` in Cache Storage `gallery-images-v3`; no code path
deleted it at sign-out (`grep -rn "gallery-images" src` → none before this change). On a shared device the next user of the
browser could read the previous member's cached private images.

**Unit gate (D2, stated here since F-D3-6 has no register row):** every way a session ends deletes every `gallery-images-*`
cache, without ever blocking or failing the sign-out.

## Change
- `src/lib/imageCachePurge.ts` — `purgeImageCache()`: deletes every cache whose name starts `gallery-images-` (all versions);
  never throws; returns the names deleted, or `null` when Cache Storage is unavailable.
- `src/hooks/core/useAuth.tsx` — one call, fire-and-forget, in the `SIGNED_OUT` branch of `onAuthStateChange`: the Log out
  button, global sign-out from another device, account deletion, an expired refresh, and another tab signing out (Supabase
  broadcasts the event) all pass through it.
- `public/sw-image-cache.js` — untouched.

## Proofs
| instrument | reading | UTC |
|---|---|---|
| real Chromium (Playwright), this module's code against real Cache Storage: caches `gallery-images-v3`, `gallery-images-v2`, `app-other` | deleted `[gallery-images-v2, gallery-images-v3]`, left `[app-other]` | 2026-10-04 10:57:58 |
| `imageCachePurge.test.ts` (4) | all versions deleted, others kept; one failing delete does not stop the rest; no Cache Storage → null; `keys()` throws → null; the worker's `CACHE_NAME` starts with the prefix | ~10:57 |
| `imageCachePurgeOnSignOut.test.tsx` (1) | AuthProvider with a mocked Supabase client: SIGNED_IN → no purge; SIGNED_OUT → exactly one purge | ~10:57 |
| mutants | A: call removed from useAuth → wiring test red · B: worker `CACHE_NAME` renamed `images-v4` → prefix test red (the purge would silently delete nothing) · C: exact-name match instead of prefix → unit red · each 1 failed / 4 passed | 10:57:46 |

## Known limit (stated)
An image request already in flight at the moment of the purge can still be written by the worker a moment later. It is an
image the departing member's own page requested in their last instant; the next session's LRU replaces it. Closing that fully
needs the worker itself to drop writes after a sign-out message — a separate change if the Auditor wants it.
