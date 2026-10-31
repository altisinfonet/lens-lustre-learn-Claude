# F-D3-13 · the feed cache survives a cold start offline (OFF-5 G2)

**Unit:** F-D3-13 · **Lane:** D2 · **Date:** 2026-10-05 (UTC) · **Rule:** `docs/evidence/d2/phase5/OFF-5/DECISION.md` G2 — "Saved first, then fresh … Age is a label, never a reason to hide what is saved. The current 30-minute expiry in `src/lib/feedCache.ts` is removed."

## The defect
`src/lib/feedCache.ts` deleted its saved first page 30 minutes after writing it. It is the feed's first paint (`useFeedQuery` → `placeholderData`, read synchronously before OFF-1's device store hydrates) and the only saved feed when IndexedDB is unavailable (`deviceStore` degrades to nothing). A cold start with no network more than 30 minutes later therefore showed the error card instead of the 10 posts already on the device.

## Failing first — `src/hooks/feed/__tests__/feedColdStartOffline.test.tsx`
Runs the REAL `useFeedQuery` with React Query offline (no request is made) plus the cache directly. On staging `fbe1dca` (pre-fix): **5 failed / 3 passed** (`vitest-before-RED.txt`) — 31 min, 3 h, 3 days all return nothing; no `savedAt`; the real hook renders no posts from a 3-hour-old cache. The **control** (10-minute-old cache) passes before and after, proving the harness sees a saved feed at all.

After the fix: **8 / 8 pass** (`vitest-after-GREEN.txt`). Full suite: tsc 0, vitest all green, UI gate green (see PR checks).

## The fix
- The 30-minute expiry is removed. Age is returned as `savedAt` (for the G2 "Saved 2 h ago" label, which no screen renders yet — not in this unit).
- Unchanged on purpose: a different member's cache is still discarded on read (test: G6 not relaxed); sign-out still wipes it (`signOutWipe.ts → clearFeedCache`, test unchanged); one page (10 = `PAGE_SIZE`, the same first page OFF-1 keeps). The feed still refetches on mount whenever there is a network (`staleTime: 0`), so an old saved copy is replaced the moment it can be.

## Not covered
The age label on screen (G2's "Saved 2 h ago") and the OFF-3 banner are not built here.
