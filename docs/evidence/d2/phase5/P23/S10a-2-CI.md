# P23 · S10a-2 — the ten surfaces, checked in CI

**Unit:** P23 · S10a-2 · **Date (UTC):** 2026-10-30 · **Method:** `S10a-DECISION.md` §2–§3 · **Branch:** `claude/p23-s10a2-a11y-surfaces`

**Gate clause (P23):** "automated checks in CI" over the ten primary surfaces named in `S10a-DECISION.md` §2.

## What was built

| Path | What |
|---|---|
| `src/uiharness/a11yScenes.tsx` | `screen-signup`, `screen-edit-profile`, `screen-admin-health` (the admin panel's health tab: `AdminAppHealth` + `AdminHealth`, as `AdminPanel.tsx` renders it). Reachable by `?scene=`; **not** on the index. |
| `src/uiharness/main.tsx` | lookup `SCENES[name] ?? A11Y_ONLY_SCENES[name]`; the index still lists `SCENES` only. |
| `src/uiharness/sceneConfig.ts` | `screen-signup` is signed out, like `screen-login`. |
| `src/uiharness/realScreens.tsx` | `screen()` exported (reused, not copied). |
| `src/uiharness/__tests__/harnessHonesty.test.ts` | new: the three scenes exist and are never on the index; the signed-out list check also knows `a11yScenes.tsx`. |
| `tools/uishot/a11y-surfaces.mjs` | checks A–E over 11 scenes × `iphone-390`, `desktop-1280`, Chromium; judged by `compareAxe`; `--record`, `--lower`, `--from`, `--self-test`. |
| `tools/uishot/a11y-surfaces.baseline.json` | committed EMPTY (`{"scenes":{}}`) — see "Shown failing first". |
| `.github/workflows/d2-a11y-surfaces.yml` | PR + push to staging/main + dispatch; self-test, then the run; report uploaded as artefact `a11y-surfaces`. |

**The visual sweep is unchanged:** `capture.mjs` reads the index links (`a[href^='?scene=']`); the index renders `Object.keys(SCENES)`; `SCENES` is untouched. Measured on the harness: 65 index links before and after, none of the three. `tools/uishot/baseline.json` and `axe.baseline.json` are not edited.

**gate.mjs is not refactored to share the server start:** it is the required UI gate and its shape is pinned by `uiGateCannotBeBypassed.test.ts`. `a11y-surfaces.mjs` starts the harness the same way (detached vite on 5199, timeout = failure, server log printed on failure).

## Three measurement traps found while building it (each now a self-test page)

1. **Autofocus mid-page.** `blur()` leaves Chromium's Tab starting point on the blurred field, so login/sign-up (which autofocus the email/name field, `Login.tsx:373`, `Signup.tsx:234`) were walked from that field, and Back / Google / email read as "unreached" (3 and 6). Fix: focus `<body>` first. Self-test `autofocus-mid-page`.
2. **Focus style behind a transition.** Edit profile's inputs do change colour on focus (`focus:border-primary`, `EditProfile.tsx:42`) behind `transition-colors duration-500`; reading the style right after Tab gave the start value, so 19 inputs read "no focus style". Fix: finish running transitions before reading. Self-test `focus-transition`.
3. **Focus dropped mid-page.** Once (not reproduced in 2 further full runs and 3 single runs), `screen-feed` at 390 read 51 unreached: the walk hit `body` mid-page. Cause not proven, so the walk now checks itself instead: landing on `body` while unreached controls still follow the last stop in page order is reported as "focus dropped … walk resumed there" (named in the report), and a control removed meanwhile is not counted. Self-test `focus-dropped`.

## Self-test (local, Chromium 1243)

```
PASS  self-test clean                  got {}
PASS  self-test unnamed-button         got {"button-name":1,"target-size":2}
PASS  self-test unreachable            got {"kbd-tab-unreached":1}
PASS  self-test no-focus-style         got {"kbd-focus-invisible":1}
PASS  self-test trap                   got {"kbd-tab-unreached":1,"kbd-trap":1}
PASS  self-test dialog-ignores-escape  got {"kbd-esc-dialog":1}
PASS  self-test dialog-closes          got {}
PASS  self-test autofocus-mid-page     got {}
PASS  self-test focus-transition       got {}
PASS  self-test focus-dropped          got {}
PASS  self-test modal-keeps-focus      got {}
SELF-TEST PASS: every check fires on its seeded defect, and the clean pages are clean
```

## Measured counts (local full run, 2026-10-30)

| Scene | iphone-390 | desktop-1280 |
|---|---|---|
| screen-feed | clean | link-name 6, target-size 2 |
| screen-post-detail | clean | link-name 6, target-size 2 |
| comments-panel | kbd-focus-invisible 1 | kbd-focus-invisible 1 |
| composer-full | clean | clean |
| screen-profile | clean | button-name 1, link-in-text-block 1, link-name 6, target-size 2 |
| screen-edit-profile | aria-progressbar-name 1, button-name 1, select-name 3 | same + link-name 6, target-size 2 |
| screen-notifications | nested-interactive 2 | link-name 6, nested-interactive 2, target-size 2 |
| screen-discover | link-name 4 | link-name 10, target-size 2 |
| screen-login | link-in-text-block 2 | link-in-text-block 2 |
| screen-signup | link-in-text-block 3 | link-in-text-block 3 |
| screen-admin-health | color-contrast 1 | color-contrast 1 |

The one keyboard finding is real: the comment box sets `border: none; outline: none` inline (`MentionInput.tsx:395-396`), so Tab shows no focus indicator (2.4.7). It is S10a-3's to fix. The desktop-only `link-name 6` / `target-size 2` repeat on every signed-in desktop page: the shared desktop chrome (S10a-3).

## Shown failing first — and the order of the two pushes

The workflow runs on pull requests and on pushes to staging/main; a dispatch on a branch is refused until the file is on the default branch (HTTP 404, measured). So the CI runs exist once the PR is open:

1. **Red run:** the PR's first CI run, with the EMPTY baseline: it must fail naming every finding above (local run: `A11Y SURFACES FAIL (36)`). Run ID: _to be filled from the PR_.
2. **Baseline from CI's own numbers:** download artefact `a11y-surfaces`, then
   `node tools/uishot/a11y-surfaces.mjs --record --from a11y-surfaces/a11y-surfaces-current.json` — records exactly what CI measured (a first measurement: `--record` never overwrites an entry), commit, push.
3. **Green run:** Run ID: _to be filled from the PR_.

Locally, steps 2–3 were rehearsed: `--record --from` wrote 22 entries, the same judge then passed, and a second `--record` wrote nothing.
