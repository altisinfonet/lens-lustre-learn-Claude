# OFF-3 — poor-network behaviour

**Unit (MASTER R-90):** "poor-network behaviour. Timeouts, retries, an offline/slow banner, no blank screens, optimistic UI,
smaller images on slow links (with P11/P16)." Proof per R-82: CI tests with offline/slow simulation, failing first.

## What each clause is, after this PR
| clause | how | where |
|---|---|---|
| timeouts | already present: every Supabase read aborts at 25 s (uploads exempt) — **now also reported** to `networkQuality` | `src/integrations/supabase/client.ts` |
| retries | **new policy**: network failure / our timeout → up to 3 retries, backing off 1-2-4-8 s; a 5xx → 1; a refusal (4xx, RLS) → 0. Offline → React Query pauses and resumes. Was `retry: 1` for everything | `src/lib/offline/retryPolicy.ts`, `App.tsx` |
| offline / slow banner | **new** `NetworkBanner` (`role="status"`, polite) in the Layout; nothing renders on a good connection | `src/components/NetworkBanner.tsx`, `Layout.tsx` |
| one network state | **new** `networkQuality`: offline (browser) › declared slow (`2g`/`slow-2g`/Data Saver) › observed slow (median read > 3 s over the last 6, or 2 of our timeouts). Instant failures are not "slow" | `src/lib/offline/networkQuality.ts`, `useNetworkQuality` |
| smaller images on slow links | PostMedia tells the browser the slot is 160 px on a slow link → it picks the smallest rung of the same srcset (480w / stored thumbnail) | `src/components/post/PostMedia.tsx` |
| no blank screens | OFF-1 (stored data renders offline) + the banner explaining it | OFF-1 PR |
| optimistic UI | already present for likes/reactions, comments, profile edits, blocks, votes, notification settings (`onMutate` + rollback in 6 hooks); queued delivery is OFF-2 (D1+D2) | — |

## Proofs — `src/lib/offline/__tests__/poorNetwork.test.tsx` (19)
networkQuality: good / offline / declared 2g / declared Data Saver / observed slow then recovered / two timeouts.
NetworkBanner: nothing when good; offline line with `role=status`; turns to the slow line live when reads time out.
PostMedia: good link → `(max-width: 768px) 100vw, 600px`; slow link → `160px`.
Retry policy: 8 cases (network 1st/3rd/after 3, our timeout, 5xx once/twice, RLS, 404) + the backoff series.

| mutant (2026-10-04 15:25:20 UTC) | result |
|---|---|
| A: PostMedia ignores the slow state | 1 red |
| B: the banner never shows for "slow" | 1 red |
| C: refusals retried once | 2 red |
| D: our timeouts no longer mark the link slow | 3 red |

## Why instant failures do not mark the link slow
The UI-gate harness (and a captive portal) fails Supabase reads instantly. Counting those would show a "slow connection"
banner on every harness scene and on any momentary DNS blip. Only our own 25 s timeout and slow successes count; a dead
network is reported by the browser as `offline`.
