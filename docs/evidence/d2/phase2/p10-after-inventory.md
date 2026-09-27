# P10 AFTER-INVENTORY — 2-D2-04

**Measured 2026-09-27T03:38:16Z on `d2/2-D2-04-P10-timer-discipline-20260927`, base `origin/staging` `7ebdbf4`.**
Same commands as the 0-D2-03 baseline inventory, so the before and after are comparable.

```
$ grep -rn "setInterval(" src/ --include=*.ts --include=*.tsx | grep -v __tests__
src/components/judge/JudgeSessionTimer.tsx:31:   * This used to be `setInterval(() => setLocalTime(t => t + 1), 1000)`. An
src/components/ads/FullscreenAdShell.tsx:48:   * This was `setInterval(() => setRemaining(r => r - 1), 1000)` in an effect
src/components/ads/AdZone.tsx:253:     * This used to be `setInterval(tick, 200)` — five wake-ups a second, for
src/hooks/core/useEngagementHeartbeat.ts:149:      timer = window.setInterval(tick, TICK_MS);
src/lib/timers/visibilityInterval.ts:108:    timer = window.setInterval(tick, delayMs);
src/pages/Index.tsx:174:   * This was `setInterval(…, 1800 / 60)` — a 30 ms timer, the fastest in the

$ grep -rn "refetchInterval" src/ --include=*.ts --include=*.tsx | grep -v __tests__
src/hooks/competition/useCompetitionDetail.ts:284:    refetchInterval: isVoting ? 90 * 1000 : false,
src/hooks/judging/useMultiJudgeProgress.ts:119:    refetchInterval: 30_000,
src/hooks/notifications/useNotificationsQuery.ts:400:    refetchInterval: 60_000,
src/hooks/dashboard/useDashboardData.ts:355:    refetchInterval: 30_000,

$ grep -rn "requestAnimationFrame" src/pages/Index.tsx
172:  /* ── P10: requestAnimationFrame, not a 30 ms interval. ──
195:      if (progress < 1) frame = requestAnimationFrame(step);
198:    frame = requestAnimationFrame(step);
315:      requestAnimationFrame(() => {
344:      requestAnimationFrame(() => {
```

## How to read that first block — it is not six timers

Six lines match `setInterval(`, and **two of them are timers**:

| Line | What it is |
|---|---|
| `src/lib/timers/visibilityInterval.ts:108` | **The** timer. Every repeating timer in the client is now this one, and it stops on `visibilitychange` → hidden and on Capacitor `appStateChange` → inactive. |
| `src/hooks/core/useEngagementHeartbeat.ts:149` | The reference implementation P10 is told to copy. It already did all of the above, plus refusing to tick while the member is idle. Left alone on purpose; rewriting it to call the helper would be rewriting the pattern the helper was derived from. |
| `JudgeSessionTimer.tsx:31` · `FullscreenAdShell.tsx:48` · `AdZone.tsx:253` · `Index.tsx:174` | **Comments.** Each is the file's own record of the timer that used to be there and why it is not. "Leave the reason in the file." |

`grep -c` is the wrong instrument for this question now, which is why the guard
is `src/__tests__/p10TimerDiscipline.test.ts` and not a count. It strips
comments before it looks.

## Before → after

| | 0-D2-03 baseline (2026-09-04) | now |
|---|---|---|
| `setInterval` call sites in `src/**` | **21** | **2** — the helper, and the heartbeat it was derived from |
| of those, failing P10's gate | **20 of 21** | **0** |
| fastest repeating timer | **~30 ms** (`Index.tsx`, counter animation) | **1000 ms**, the floor |
| sub-second timers | 2 (~30 ms, 200 ms) | **0** |
| `refetchInterval` sites | 4 | 4 — unchanged in value, each now carrying a written `P10:` justification beside it |
| repeating timers with no visibility teardown | 20 | **0** |

## Two things this instrument still cannot see, named rather than left

1. **`setTimeout` chains that re-arm themselves.** A `setTimeout` that schedules
   the next `setTimeout` is a repeating timer wearing a different hat, and
   neither the grep nor the guard looks for it. Not swept in this unit; raised
   for the Auditor to route.
2. **A delay held in a variable the scan cannot resolve.** The guard now *fails*
   on those rather than passing them — `has no delay this scan cannot resolve`
   — so the hole is closed by refusal rather than by cleverness, but it means a
   future caller must use a literal or a locally-defined constant.
