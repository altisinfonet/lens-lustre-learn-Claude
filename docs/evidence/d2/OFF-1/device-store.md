# OFF-1 — device store: feed, profiles, own posts, notifications; open from it, then refresh

**Unit (MASTER R-90):** "device store for feed, profiles, own posts and notifications. The app opens from it instantly, then
refreshes (cache first)." Proof per R-82: a CI test with offline simulation, failing first.

## Before (read from the code, staging `cb188b0`)
Only the feed's first 10 posts were kept, in localStorage, **for 30 minutes** (`src/lib/feedCache.ts`). Profiles, the
member's own posts and notifications were memory-only: open the app offline, or after 30 minutes away, and the feed,
profile, wall and notifications screens had nothing to show.

## Change
- `src/lib/offline/deviceStore.ts` — IndexedDB `retina-offline/kv`; records keyed per member; ≤ 512 KB per record,
  ≤ 200 records per member (oldest evicted), 7-day expiry; every failure = "no cache", never an error. No dependency added.
- `src/lib/offline/queryPersistence.ts` — writes successful fetches of exactly four query families
  (`feed`, `profile-core`, own `user-wall-posts`, own `notifications`; infinite queries keep page 1), debounced 800 ms;
  `hydrateFromDevice` restores them into an EMPTY cache with their original `updatedAt`, so they render at once and are
  refetched as stale data (cache first, then refresh). Offline, React Query pauses the refetch and the stored data stays.
- `src/components/OfflineDeviceStoreBridge.tsx` (mounted in `App.tsx`) — starts the writer once; on member change, points it
  at that member and restores.
- `src/hooks/core/useAuth.tsx` — on `SIGNED_OUT`: stop the writer synchronously, then wipe the store (beside F-D3-6's
  image-cache purge), so a departed member's data cannot be re-written after the wipe.

## Proofs
| instrument | reading | UTC |
|---|---|---|
| real Chromium, real IndexedDB (esbuild bundle of `deviceStore.ts`): write two members → **new page** reads them back → `clearDeviceStore()` | u1 record intact after reload; u2 isolated; cleared → 0 records; DB `retina-offline` exists | 2026-10-04 15:17:01 |
| `deviceStore.test.ts` (8) | round trip; member isolation; > 512 KB refused; 200-record cap evicts oldest; 7-day expiry; clear; no storage / failing storage → no cache, no throw | ~15:16 |
| `queryPersistence.test.tsx` (17) | allow-list table (10 keys) + no member → nothing; page-1 trim; only allow-listed fetches written; a write scheduled before sign-out is dropped; restore fills only empty queries as stale data; **network OFF → the stored notifications render** | ~15:16 |
| mutants | A: hydration removed from the bridge → the offline test red · B: anyone's wall persisted → red · C: post-sign-out write not dropped → red · each 1 failed / 24 passed | 15:16:48 |
| control | the same offline screen WITHOUT the bridge stays on `loading` (asserted) — the blank-offline state R-90 forbids | ~15:16 |

## Not in this unit
The outbox (OFF-2), image byte cap (OFF-4), banner/timeouts (OFF-3) and the end-to-end offline harness (OFF-6).
