# P10 — timer discipline: the fail-first test

**D2 · 2026-09-03T12:31Z · Phase 1 prep · branch `d2/P10-timer-discipline-test-20260903` off `origin/staging` @ `d8aacd0` · commit `94ce6f9`**

| | |
|---|---|
| Patch | `d2-P10-timer-discipline-test-20260903.patch` — 13,569 B · sha256 `fb1a579c6a4e658d67fe83013c5a2a576715832e626c7bac8a7d9636fe185756` |
| File | `src/__tests__/timerDiscipline.test.ts` — new, 10,264 B · **blob `036110d43aeb4069bd1945c5bb9a954cdb2fecbe`** |
| Applies | `git am` clean on `origin/staging` (`d8aacd0`) → reproduces blob `036110d4` |
| Diff | 1 file, +245, −0. **No production source touched** — the deliverable is the test alone, as ordered. |

## The result it is delivered for
```
20 of 21 setInterval sites fail P10
Test Files  1 failed (1)
     Tests  1 failed | 7 passed (8)          2026-09-03T12:28Z
```
The 20 named sites match the landed inventory (§3 of `docs/evidence/d2/baseline/client-inventory.md`) **site for site, file and line**; the single pass is `useEngagementHeartbeat.ts:149`. Full list in `violations.txt`.

## The rule as implemented — and one wording question for the Auditor
The order says "**either** ≥1000 ms **or** cleared on visibilitychange". P10's gate, the register row and the inventory all read the two clauses as **both required**, and only the AND reading produces the 20-of-21 the same order asks to see. So the test implements **AND**, and I am flagging rather than silently choosing: under the OR reading exactly **one** site fails (`Index.tsx:191`, 30 ms with no visibilitychange in the file) — `AdZone.tsx:258` fires every 200 ms but does mention the event, so OR would pass it. If the Auditor intends OR, the assertion is a two-line change and the expected count becomes 1.

## Method, and where it is deliberately weak
A **source scan**, not a runtime test: the 21 sites sit in pages, hooks and ad shells, several behind an admin role or an active judging session; the ones nobody mounted would be exactly the ones that regress.

* `visibilitychange` is satisfied when a file **mentions** the event and calls `clearInterval` — not proof they are wired together. Generous to existing code, never harsher than the gate: nothing that satisfies the gate can fail this check, so every violation reported is real. **Tighten when P10 lands; do not loosen.**
* An interval that cannot be resolved statically is a **violation** — unknown is not a pass (C-34).
* Delays resolve through literals (`30_000`), arithmetic (`5 * 60 * 1000`), and in-file `const` identifiers, recursively.

## The checker is proved able to fail — independently of `src/`
Five control tests run the same scanner over synthetic sources: it rejects a 200 ms timer **that does** handle `visibilitychange`; rejects a 30 s timer that does not; rejects an unresolvable delay; accepts a 15 s timer with the event; and resolves `1800/60` to 30 ms. These stay meaningful after the src list is empty (C-34).

Two further tests guard the inventory: `useEngagementHeartbeat` must keep passing, and the site count must stay 21 — if it moves, re-measure the inventory before editing the number.

## Two refinements to the inventory — recorded, not tidied
* `useJudgeSession.ts:173` — §3 shows `?`; the resolver reads `HEARTBEAT_INTERVAL = 30_000` in the same file. Still a violation (no `visibilitychange`).
* `Index.tsx:191` — §3's Interval cell says `1`; the resolver reads `duration/steps = 1800/60 = **30 ms**`, which is what §3's own note says. Still a violation.

## Checks
`npx tsc -b tsconfig.json` exit 0 (both projects) · `eslint` clean · full suite **2,486 passed, 1 skipped, 2 failed** — this file's gate assertion (by design) and the pre-existing stale `typecheckIsNotVacuous` assertion already routed as F-60.

## State
`src/__tests__/**` is courier-limited like F-58/F-60/F-67, so this rides with that batch when a push-authorised session exists.
