# P23 · S10-a decision note — level, the ten surfaces, what CI checks, what the walkthrough checks

**Unit:** P23 · **Stage:** S10-a (Addendum A remainder, part a) · **Part:** S10a-1 (docs only) · **Date (UTC):** 2026-10-29 · **Path:** `docs/evidence/d2/phase5/P23/` (same folder as `DECISION.md`)

**Gate (`docs/gates/GATE_REGISTER.md`, P23 row, verbatim):** "WCAG level chosen; automated checks in CI; keyboard and screen-reader walkthrough of the ten primary surfaces." Register note, verbatim: "The ten surfaces are named in the evidence artefact, not left implicit."

This note **extends** `DECISION.md` (2026-10-04, merged to `staging`, OWNER-ATTESTED by merge under R-88). It changes one thing — the list of ten surfaces in `DECISION.md` §4 — and fixes the method for the three remaining S10-a parts. Everything else in `DECISION.md` stands.

---

## 1 · The level: WCAG 2.2 AA (unchanged)

The stage plan says "2.1 AA unless the gate says otherwise". The gate sentence names no level, but the already-signed `DECISION.md` L1 chose **WCAG 2.2 AA**, and the binding axe ratchet in `ui-gate.yml` already runs the tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`. 2.2 AA contains every 2.1 AA criterion (except 4.1.1 Parsing, which 2.2 made obsolete) and adds 2.4.11 Focus Not Obscured, 2.5.7 Dragging Movements, 2.5.8 Target Size (24 × 24 CSS px), 3.2.6 Consistent Help, 3.3.7 Redundant Entry and 3.3.8 Accessible Authentication. The UI gate's 44 px tap-target check is stricter than 2.5.8 (it is the AAA 2.5.5 size) and stays as it is.

**Decision S1:** the level stays **WCAG 2.2 AA**. It is the level the axe tags in CI already test, and the stricter of the two. Recorded as the conservative choice.

## 2 · The ten primary surfaces (replaces `DECISION.md` §4's list)

The S10-a stage plan names the ten. They replace the 2026-10-04 list. Three surfaces leave the list: signed-out landing, competitions/winners, and account sheet and settings. Two of them, **competitions/winners** (`screen-voting-lightbox`, `screen-winners`) and **account sheet and settings** (`screen-account-sheet`, `screen-notification-settings`, `screen-dashboard`), **stay under the all-scene axe ratchet** in `ui-gate.yml`, because each has a harness scene and an entry in `tools/uishot/axe.baseline.json`. They leave the walkthrough list, not CI. The **signed-out landing** (`/`) is different. It has no harness scene and no axe-baseline entry, so it is not under any CI axe check today. The only automated look it gets is the report-only live-route probe, `d2-a11y-routes.yml` (DECISION.md C7), which is a monitor, not a gate. Leaving the list does not take it out of a ratchet, because it was never in one.

| # | Surface | Harness scene(s) | Production route | Scene exists today? |
|---|---|---|---|---|
| 1 | Feed | `screen-feed` | `/feed` | yes |
| 2 | Post page | `screen-post-detail` | `/post/:id` | yes |
| 3 | Comments sheet | `comments-panel` | (sheet over `/feed`, `/post/:id`) | yes |
| 4 | Composer | `composer-full` | `/feed?compose=1` | yes |
| 5 | Profile | `screen-profile` | `/profile` | yes |
| 6 | Edit profile | `screen-edit-profile` | `/edit-profile` | **no — added in S10a-2** |
| 7 | Notifications | `screen-notifications` | `/notifications` | yes |
| 8 | Search / discover | `screen-discover` | `/discover` | yes |
| 9 | Login / sign-up | `screen-login`, `screen-signup` | `/login`, `/signup` | login yes, **sign-up added in S10a-2** |
| 10 | Admin health | `screen-admin-health` | `/admin` (health tab) | **no — added in S10a-2** |

**Decision S2 — the three new scenes are a11y-only.** Measured locally on 2026-10-29 (`npm run ui:gate -- screen-signup screen-edit-profile screen-admin-health` with the three scenes wired in): all three fail the visual sweep's tap-target rule on the phone widths (sign-up 1, edit profile 20, admin health 16 controls under 44 px), and admin health calls five admin RPCs the fake backend has no fixture for. Making them pass the visual sweep is tap-target / fixture work (F-103's ratchet), not P23, and would change pixels. So the three scenes are reachable by `?scene=` but **not listed on the harness index**, which keeps them out of the visual sweep and out of `tools/uishot/baseline.json`; the P23 checks below address them by name. They join the visual sweep when their tap-target debt is cleared. That is **a separate unit, tracked as a follow-up of F-103's tap-target ratchet**, not part of S10a-2/3/4. S10a-2 resolves the three scenes from a separate registry (`A11Y_ONLY_SCREENS` in `src/uiharness/realScreens.tsx`, re-exported as `A11Y_ONLY_SCENES`), which the harness index does not list.

## 3 · What CI checks (S10a-2 builds it; S10a-3 lowers it)

A new script `tools/uishot/a11y-surfaces.mjs`, run in its own workflow against the same harness server the UI gate uses (fake data, no network, deterministic), over the 11 scenes of §2 at **two widths: `iphone-390` (mobile) and `desktop-1280`**, in Chromium (the engine of the Android app's WebView).

| # | Check | Fails when |
|---|---|---|
| A | **axe**, WCAG 2.2 AA tags (same tags and pinned `axe-core` as the existing ratchet), no rule disabled | the ratchet rules of `tools/uishot/axe-ratchet.mjs` (`compareAxe`): any count up, a new rule, a clean scene/width dirty, a count down without the baseline lowered, a scene/width that did not run, axe threw |
| B | **Tab reach** — every visible, enabled interactive control (links, buttons, inputs, selects, textareas, `[tabindex>=0]`, ARIA widget roles; a radio group counts once) is focused by pressing Tab from the top of the page | a control never receives focus in a full Tab cycle |
| C | **Visible focus** — when Tab lands on a control, at least one of outline, box-shadow, border, background, colour or text-decoration differs from its unfocused style | Tab lands on a control and nothing visibly changes |
| D | **No keyboard trap** (2.1.2) — repeated Tab keeps moving and comes back to the start of the page | focus stops moving, or cycles in a subset that excludes reachable controls with no open modal dialog |
| E | **Esc closes** — where a sheet/dialog (`[role=dialog]`, `[role=alertdialog]`) is open, Escape closes it (ARIA Authoring Practices, not a WCAG success criterion; kept because every sheet in the app is a dialog) | it is still open after Escape |

B–E are counted per scene/width and judged by the **same ratchet** (`compareAxe`) against a committed baseline `tools/uishot/a11y-surfaces.baseline.json`, so the same rules hold: counts only go down, and every improvement is locked in by the PR that makes it.

**How S10a-2 reads B–E where the table is silent** (stated in the header of `tools/uishot/a11y-surfaces.mjs`):
- **B** treats a roving-tabindex group the same way as a radio group, so tabs, menu items, listbox options and tree items each count once.
- **B** leaves out controls that are `aria-hidden` or `inert`. When a modal dialog is open, it also leaves out controls behind the modal, the same scope D uses.
- **B** and **C** recognise a control that React re-mounts after Tab has visited it by its position in the DOM. Without this, the replacement node would be read as "never reached". This was measured on `screen-feed`'s category chips.
- **C** switches off CSS transitions for the walk, so a ring that fades in over 150 ms is not read as no change.

**The baseline is keyed by scene *and* width** (`surfaces.<scene>.<width>.<rule>`). The existing `axe.baseline.json` is keyed by scene only, because it runs once at `iphone-390`. S10a-2 does not change it or the way `ui-gate.yml` judges it. It flattens the composite key to `"<scene> @ <width>"` and calls `compareAxe` unchanged (`tools/uishot/a11y-surfaces-ratchet.mjs`). Rules carry their check letter: `A:<axe rule id>`, `B:tab-unreached`, `C:focus-not-visible`, `D:keyboard-trap`, `E:escape-does-not-close`. One rule is stricter than `compareAxe`: a scene/width with **no** baseline entry fails even when it is clean, and the failure names every finding.

**The checks themselves are proven to fire:** a test page with one seeded defect per check (an unnamed button, a control Tab never reaches, a control with no focus style, a focus trap, a dialog that ignores Escape) must report each defect, and a clean page must report none. A check that cannot fire cannot go green honestly.

**Shown failing first (Standing Rule 9):** the first push of S10a-2 runs with no recorded measurement for any scene/width, so the check goes red naming every finding; that run is linked in the PR. The second push records the measured counts as the first baseline (a first measurement, not a raise), and the check goes green. From then on it is binding. S10a-2 adds the `--record` flag to `a11y-surfaces.mjs`. It writes only scene/width entries that do not exist yet. If asked to touch an entry that already exists, it refuses, writes nothing and exits non-zero. Its `--self-test` proves that refusal, along with the rest of the ratchet (count up, new rule, an unlowered drop, an entry that did not run, a check that threw, an unrecorded entry) and `--lower`, which only ever lowers.

**S10a-3** lowers those counts, surface by surface, with fixes limited to labels, roles, ARIA, focus rings and contrast tokens. No visual redesign. `tools/uishot/baseline.json` (visual) and the existing `axe.baseline.json` keep passing; no count is ever raised.

## 4 · What the walkthrough checks (S10a-4)

The gate's clause 3 is a "keyboard and screen-reader walkthrough". S10a-4 commits a **scripted** walkthrough as a CI job, in **chromium and webkit** (Chromium is the Android app's WebView engine; WebKit is Safari's), with its report uploaded as an artefact **and committed** as `docs/evidence/d2/phase5/P23/WALKTHROUGH.md` (artefacts expire; the committed file is the evidence). Per surface and width it records:

1. the **Tab order**: each stop's role and accessible name, in order — so an unnamed or out-of-order stop is readable by a person without a screen reader;
2. the **accessibility tree** (Playwright `ariaSnapshot`): headings, landmarks, and every control with its role and name — what a screen reader is given;
3. unnamed controls, missing `h1`, missing `main` landmark, as counted findings.

**What the scripted walk does not replace:** it reads the tree a screen reader is given; it does not listen to TalkBack/VoiceOver/NVDA announcements, live-region timing or gestures. `DECISION.md` §4's hands-on protocol (TalkBack on Android, NVDA + Chrome, 200 % zoom, 320 px reflow) remains the Owner/D2 item for the remaining part of clause 3. This stage closes the scripted half and says so; it does not claim the hands-on half.

## 5 · Decisions recorded

| # | Decision | Why |
|---|---|---|
| S1 | WCAG 2.2 AA stays | already signed and already in CI; stricter than 2.1 AA |
| S2 | sign-up, edit profile, admin health are a11y-only scenes | they fail tap targets / lack fixtures; fixing that is pixel work outside P23 |
| S3 | P23 checks run in their own workflow, not inside `ui-gate.yml` | `ui-gate.yml` is a required check with a 30-minute timeout over ~60 scenes × 4 widths; a separate job does not lengthen it and leaves branch protection untouched (out of scope to change) |
| S4 | keyboard checks ratchet, not "zero" | same reason as the axe ratchet: a check red on every PR gets switched off |
| S5 | admin health renders with missing admin-RPC data | its controls (refresh, tabs, actions) render regardless; fixtures for five admin RPCs are left for the unit that brings it into the visual sweep |
