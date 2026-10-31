# OFF-4 — image cache with a size cap; everything wiped on sign-out

**Unit (MASTER R-90):** "image cache with a size cap; everything wiped on sign-out (F-D3-6)." Proof per R-82: CI tests,
failing first.

## Before (staging `cb188b0` + OFF-1)
- `public/sw-image-cache.js` bounded the cache by **entries only (200)** — 200 full-size photographs can be 200+ MB on a phone.
- Sign-out: the image cache (F-D3-6) and the OFF-1 store were wiped on `SIGNED_OUT`, but the feed's localStorage first page
  (`feed_cache_v1`) was cleared only by the Log out **button** — an involuntary sign-out left it on the device.

## Change
- **Byte cap:** `MAX_CACHE_BYTES = 50 MB` alongside the 200-entry cap; least-recently-used evicted first until both hold.
  Each body is measured when stored; sizes live in a small JSON entry inside the same cache (survives the worker stopping,
  never served). An entry without a recorded size (stored before OFF-4) counts at 250 KB. `planTrim` is a pure function.
  Opaque responses are still NOT cached (unchanged): Chromium charges ~7 MB of quota padding per opaque entry, and quota
  pressure would evict the OFF-1 device store.
- **One wipe:** `src/lib/offline/signOutWipe.ts` `wipeMemberDataOnSignOut()` — stops the OFF-1 writer first (synchronously),
  then wipes image caches, the device store and the feed cache. Called once from useAuth's `SIGNED_OUT` branch (every
  session end). Device preferences (theme, language, consent, device id) are kept by design.

## Proofs
| instrument | reading | UTC |
|---|---|---|
| **real Chromium, real service worker** (this branch's `sw-image-cache.js` registered on a local origin; 80 × 1 MB images fetched through it) | page controlled; **50 entries, 52,428,800 B (= 50 MB)** kept; newest p79 present, oldest p0 evicted | 2026-10-04 15:21:44 |
| `swImageCacheCap.test.ts` (6) — the worker file run in a sandbox with real `Request`/`Response` and fake Cache Storage | 120 × 1 MB → ≤ 50 kept, newest kept, oldest gone; 230 × 1 KB → exactly 200 (entry cap); 4 `planTrim` cases | ~15:19 |
| fail-first: the same load test against the **pre-OFF-4 worker** (origin/staging) | `expected 120 to be less than or equal to 50` — red | 15:19:26 |
| mutant: cap set to 500 MB | 1 red | 15:19:26 |
| `signOutWipe.test.ts` (3) | all three stores wiped, theme/language kept; a pending OFF-1 write after the wipe stores nothing; never throws | ~15:20 |
| `signOutWipeWiring.test.tsx` (1) | AuthProvider: SIGNED_IN → no wipe; SIGNED_OUT → one wipe | ~15:20 |
| mutants | feed-cache step removed → 1 red · wipe call removed from useAuth → 2 red (this + F-D3-6's wiring test) | 15:21:25 |

## Known limit
Concurrent stores can lose a size update (read-modify-write of the size index); such an entry is then counted at the 250 KB
estimate — the cap errs towards evicting, never towards growing.
