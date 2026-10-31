# D2 — Re-record 8 of 148 UI-gate baseline keys ON `main`

Companion to `docs/evidence/d2/uishot-baseline-rerecord/` (PR #239, the same
correction on `staging`). Same 8 keys, same renames, same reasoning — applied
to `main`'s own copy of the file.

## ⚠ This PR targets `main`, deliberately

D2's standing rule is that every PR targets `staging`. **This is a stated
one-off exception, requested by the owner**, on the same grounds D1's #237
(`d1/P01-withdraw-0023`, also targeting `main`) rests on: a narrow correction
of **stale bookkeeping already resident on `main`**, not a promotion of new
work into it.

It is not a promotion, and it must not be treated as one:

- it carries **no application code** — one JSON file of recorded measurements
  plus this note;
- it makes `main` agree with the components `main` already has;
- merging `#239` into `staging` cannot fix `main`, because `main` holds its own
  copy of `baseline.json` and nothing promotes it;
- and it is still merged by the Auditor, never by D2.

## Why `main` is stale on its own account

`main`'s components already carry the 2026-09-07 tap-target work:

```
main:src/components/feed/TodaysBirthdayStrip.tsx:139
    <ProfileLink … className="shrink-0 grid h-11 w-11 place-items-center">
main:src/components/FeedRightSidebar.tsx:255
    className="tap-44 inline-flex items-center gap-1 …"
```

but `main:tools/uishot/baseline.json` still records the paths those controls had
**before** that change. So the gate reports 18 regressions against `main`'s own
code. Verified directly, not inferred:

| ref | stale `a.shrink-0.tap-44` | corrected `button.tap-44.inline-flex` |
|---|---|---|
| `origin/main` | 12 | 0 |
| `origin/staging` | 12 | 0 |
| this branch | 0 | 6 |

`main` and `staging` held **byte-identical** `baseline.json` files, and their
`src/` differs only by two deleted referral test files — nothing near the feed
scenes. So the same correction applies verbatim.

## What changed — every key keeps its control COUNT

| key | controls | path changes |
|---|---|---|
| `screen-feed--android-360` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `screen-feed--iphone-390` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `screen-feed--app-360` | 53 → 53 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `screen-feed--desktop-1280` | 86 → 86 | `button.inline-flex.items-center` 3→0; `button.tap-44.inline-flex` 0→3 |
| `journey-create-from-feed--android-360` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `journey-create-from-feed--iphone-390` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `journey-create-from-feed--app-360` | 53 → 53 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `journey-create-from-feed--desktop-1280` | 86 → 86 | `button.inline-flex.items-center` 3→0; `button.tap-44.inline-flex` 0→3 |

**148 keys before, 148 after. Control-count changes: 0.** Every change is a 1:1
rename; nothing disappeared.

## Rigor, matching #239

1. **CI's exact env values**, not `.env.example`'s. `ui-gate.yml:122-125`
   supplies `testprojectref0000x`; with `.env.example`'s `YOUR_PROJECT_REF`
   placeholders much of the feed never renders and a sweep reports ~506
   regressions instead of 18. Writing that would erase ~500 controls from the
   gate's coverage. The dry run on this branch reproduced CI exactly —
   **18 regressions, 0 problems** — before anything was written.
2. **Only the 8 affected keys re-recorded.** `--baseline-write` merges
   (`{...existing, ...fingerprint}`), so the other 140 were never rewritten.
3. **Full sweep afterwards**, every scene:

```
192 screenshots, 0 problem(s) reported.
baseline diff: clean against 148 recorded scene/viewport keys.
[exited with code 0]
```

   The other ~140 keys are proven clean by that exit code, not by assertion:
   `capture.mjs` does `problems += regressions.length` then
   `process.exit(problems > 0 ? 1 : 0)`, so exit 0 is only reachable with zero
   regressions across all 148.

## Cross-validation — two sweeps, two branches, one result

The file produced here is **byte-identical** to the one in #239, written from a
separate sweep on a separate branch:

```
9c06294fda6d1b53fc2d9a5d5f9be6ea  (PR #239, from staging)
9c06294fda6d1b53fc2d9a5d5f9be6ea  (this branch, from main)
```

Two independent runs agreeing exactly is the strongest evidence available here
that neither picked up an environment artifact — which is the failure mode the
506-regression run showed is real.

## Scope

`tools/uishot/baseline.json` (8 keys of 148) + this file. No `src/**`, no
workflow, no SQL.
