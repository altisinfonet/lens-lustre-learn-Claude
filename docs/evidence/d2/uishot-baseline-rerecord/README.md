# D2 — Re-record `tools/uishot/baseline.json` (8 of 148 keys)

The UI gate `Every control reachable, nothing regressed` has been **red on
`staging` itself** since the 2026-09-07 tap-target work, on 18 baseline
regressions. This makes it green again by correcting the baseline, and changes
no application code at all.

---

## The gate was right to fire, and the baseline was what was wrong

Both regression groups are the same thing: a control was deliberately made
BIGGER, which changed the CSS-class path the baseline records it under. The
diff sees a path that no longer exists and reports it as "gone".

| baseline entry | what it is now | why |
|---|---|---|
| `a.shrink-0.tap-44` (12) | `a.shrink-0.grid` 44×44 | `TodaysBirthdayStrip.tsx`, 2026-09-07: a `.tap-44` pseudo-region "satisfied a thumb and was invisible to the instrument", so it became a real `h-11 w-11` box |
| `button.inline-flex.items-center` (6) | `button.tap-44.inline-flex` | `FeedRightSidebar.tsx`: the People-You-May-Know "Add" button was 57×27 and gained `tap-44` |

Both are corroborated in source, not inferred from the failure text:
`FeedRightSidebar.tsx:255` carries `className="tap-44 inline-flex items-center …"`,
and `PreviewA11yFourItems.test.ts` already asserts that exact className.

## Nothing lost — every changed key keeps its control COUNT

This is the check that separates a stale baseline from a real regression. If a
control had genuinely disappeared, the count would drop. It does not: every
change is a 1:1 rename.

| key | controls | path changes |
|---|---|---|
| `journey-create-from-feed--android-360` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `journey-create-from-feed--app-360` | 53 → 53 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `journey-create-from-feed--desktop-1280` | 86 → 86 | `button.inline-flex.items-center` 3→0; `button.tap-44.inline-flex` 0→3 |
| `journey-create-from-feed--iphone-390` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `screen-feed--android-360` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `screen-feed--app-360` | 53 → 53 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |
| `screen-feed--desktop-1280` | 86 → 86 | `button.inline-flex.items-center` 3→0; `button.tap-44.inline-flex` 0→3 |
| `screen-feed--iphone-390` | 57 → 57 | `a.shrink-0.grid` 3→5; `a.shrink-0.tap-44` 2→0 |

Totals: **148 keys before, 148 after.** No key added, none removed, no count
changed.

## The confirmation run

`--baseline-write` merges (`{...existing, ...fingerprint}`), so only the 8
affected keys were re-recorded and the other 140 were left untouched — a
smaller act than rewriting the file.

Written from clean `staging` (`7a64cea`), then verified with a **full** sweep
over every scene:

```
192 screenshots, 0 problem(s) reported.
baseline diff: clean against 148 recorded scene/viewport keys.
[exited with code 0]
```

## ⚠ The environment has to match CI, and mine did not at first

Recorded here because it nearly produced a catastrophic baseline. The first
sweep on clean `staging` in this container reported **506 regressions**, not
18 — writing that would have erased ~500 controls from the gate's coverage and
left a check that passes because it no longer looks.

The cause was the `.env.local` values. `ui-gate.yml:122-125` gives the dev
server specific placeholders:

```
VITE_SUPABASE_URL=https://testprojectref0000x.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=test-publishable-key-not-real
VITE_SUPABASE_PROJECT_ID=testprojectref0000x
```

With `.env.example`'s `YOUR_PROJECT_REF` placeholders instead, much of the feed
does not render and its controls are simply absent. With CI's exact values the
run reproduces CI byte for byte: **18 regressions, 0 problems**.

**So a baseline must only ever be written from a run using those values.** A
sweep that renders less than CI does looks like a clean pass and is a silent
loss of coverage.

## Scope

`tools/uishot/baseline.json` only — 8 keys of 148. No application code, no
workflow, no SQL.
