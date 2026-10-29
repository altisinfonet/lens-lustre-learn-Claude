# P23 · S10-a decision note — level, the ten surfaces, what CI checks, what the walkthrough checks

**Unit:** P23 · **Stage:** S10-a (Addendum A remainder, part a) · **Part:** S10a-1 (docs only) · **Date (UTC):** 2026-10-29 · **Path:** `docs/evidence/d2/phase5/P23/` (same folder as `DECISION.md`)

**Gate (`docs/gates/GATE_REGISTER.md`, P23 row, verbatim):** "WCAG level chosen; automated checks in CI; keyboard and screen-reader walkthrough of the ten primary surfaces." Register note, verbatim: "The ten surfaces are named in the evidence artefact, not left implicit."

This note **extends** `DECISION.md` (2026-10-04, merged to `staging`, OWNER-ATTESTED by merge under R-88). It changes one thing — the list of ten surfaces in `DECISION.md` §4 — and fixes the method for the three remaining S10-a parts. Everything else in `DECISION.md` stands.

---

## 1 · The level: WCAG 2.2 AA (unchanged)

The stage plan says "2.1 AA unless the gate says otherwise". The gate sentence names no level, but the already-signed `DECISION.md` L1 chose **WCAG 2.2 AA**, and the binding axe ratchet in `ui-gate.yml` already runs the tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`. 2.2 AA contains every 2.1 AA criterion (except 4.1.1 Parsing, which 2.2 made obsolete) and adds 2.5.8 Target Size, the rule already enforced by the UI gate's tap-target check.

**Decision S1:** the level stays **WCAG 2.2 AA**. Choosing 2.1 would drop a rule CI already enforces. Recorded as the conservative choice: it is the stricter of the two and it is the one already in force.

## 2 · The ten primary surfaces (replaces `DECISION.md` §4's list)

The S10-a stage plan names the ten. They replace the 2026-10-04 list; the surfaces that leave the list (signed-out landing, competitions/winners, account sheet and settings) **stay under the all-scene axe ratchet** in `ui-gate.yml` — they leave the walkthrough list, not CI.

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

**Decision S2 — the three new scenes are a11y-only.** Measured locally on 2026-10-29 (`npm run ui:gate -- screen-signup screen-edit-profile screen-admin-health` with the three scenes wired in): all three fail the visual sweep's tap-target rule on the phone widths (sign-up 1, edit profile 20, admin health 16 controls under 44 px), and admin health calls five admin RPCs the fake backend has no fixture for. Making them pass the visual sweep is tap-target / fixture work (F-103's ratchet), not P23, and would change pixels. So the three scenes are reachable by `?scene=` but **not listed on the harness index**, which keeps them out of the visual sweep and out of `tools/uishot/baseline.json`; the P23 checks below address them by name. They join the visual sweep when their tap-target debt is cleared — a separate unit.

## 3 · What CI checks (S10a-2 builds it; S10a-3 lowers it)

A new script `tools/uishot/a11y-surfaces.mjs`, run in its own workflow against the same harness server the UI gate uses (fake data, no network, deterministic), over the 11 scenes of §2 at **two widths: `iphone-390` (mobile) and `desktop-1280`**.

| # | Check | Fails when |
|---|---|---|
| A | **axe**, WCAG 2.2 AA tags (same tags and pinned `axe-core` as the existing ratchet), no rule disabled | the ratchet rules of `tools/uishot/axe-ratchet.mjs` (`compareAxe`): any count up, a new rule, a clean scene/width dirty, a count down without the baseline lowered, a scene/width that did not run, axe threw |
| B | **Tab reach** — every visible, enabled interactive control (links, buttons, inputs, selects, textareas, `[tabindex>=0]`, ARIA widget roles; a radio group counts once) is focused by pressing Tab from the top of the page | a control never receives focus in a full Tab cycle |
| C | **Visible focus** — when Tab lands on a control, at least one of outline, box-shadow, border, background, colour or text-decoration differs from its unfocused style | Tab lands on a control and nothing visibly changes |
| D | **No keyboard trap** (2.1.2) — repeated Tab keeps moving and comes back to the start of the page | focus stops moving, or cycles in a subset that excludes reachable controls with no open modal dialog |
| E | **Esc closes** — where a sheet/dialog (`[role=dialog]`, `[role=alertdialog]`) is open, Escape closes it | it is still open after Escape |

B–E are counted per scene/width and judged by the **same ratchet** (`compareAxe`) against a committed baseline `tools/uishot/a11y-surfaces.baseline.json`, so the same rules hold: counts only go down, and every improvement is locked in by the PR that makes it.

**Shown failing first (Standing Rule 9):** the first push of S10a-2 runs with no recorded measurement for any scene/width, so the check goes red naming every finding; that run is linked in the PR. The second push records the measured counts as the first baseline (a first measurement, not a raise — `--record` refuses to touch an entry that already exists), and the check goes green. From then on it is binding.

**S10a-3** lowers those counts, surface by surface, with fixes limited to labels, roles, ARIA, focus rings and contrast tokens. No visual redesign. `tools/uishot/baseline.json` (visual) and the existing `axe.baseline.json` keep passing; no count is ever raised.

## 4 · What the walkthrough checks (S10a-4)

The gate's clause 3 is a "keyboard and screen-reader walkthrough". S10a-4 commits a **scripted** walkthrough as a CI job, in **chromium and webkit** (webkit is the iOS app's and Safari's engine), with its report uploaded as an artefact. Per surface and width it records:

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
