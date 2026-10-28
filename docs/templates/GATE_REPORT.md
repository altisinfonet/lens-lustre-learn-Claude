# Gate report — template (v2 §6)

Copy this file into the PR body (or the stage report). Fill all eight parts.
A part with nothing to say says so in words; it is never deleted.
Never paste secrets or member data — counts, booleans and names only.

1. **Claim (numeric).** One sentence with a number in it.
2. **Instrument + before.** The exact command / CI job / PROBE used, and what it read before the change.
3. **After.** The same instrument, same command, after the change.
4. **PASS / FAIL.** Against the number in part 1. No "mostly".
5. **Regressions.** tsc · vitest · build · security · advisors — each: result, or "not run + why".
6. **Not verified, and why.** Everything the evidence does not cover.
7. **Lock test.** The test/CI check that fails if this regresses (name it, link it).
8. **Abort condition met?** The stop rule from the plan, and yes/no.

---

## Filled example — S1-a, flaky `useScrollRestoreOnReturn.test.tsx`

1. **Claim:** the test file fails 0 times in 20 consecutive runs (it failed 3 times in CI).
2. **Instrument + before:** `npx vitest run src/hooks/core/__tests__/useScrollRestoreOnReturn.test.tsx`, repeated. Before: 11 failures in 120 runs under 3-way CPU load (stress, excluding the 3 s deadline test); failures landed in different tests each time. Cause measured with temporary logging: `waitFor(where() === path)` resolves when the DOM changes, which can be before React has run that commit's passive effects (the hook's restore). The assertion then read the scroll position before the restore had run.
3. **After:** same command, test helper `arriveAt()` waits for the route and then `await act(async () => {})` to drain effects. 20 of 20 runs pass; 0 failures in 120 stressed runs.
4. **PASS** (0 ≤ 0 failures in 20).
5. **Regressions:** tsc — clean. vitest — this file 20/20; full suite is CI's. build — CI. security — test-only change, no runtime code touched. advisors — n/a (no database change).
6. **Not verified:** a slower CI runner than this container; the full suite 20× (only the one file was looped).
7. **Lock test:** the file itself, in the normal CI `vitest` job; the helper is the lock — a new route assertion that skips `arriveAt` will flake again.
8. **Abort met?** Plan abort: "still flaky after one fix round" — no.
