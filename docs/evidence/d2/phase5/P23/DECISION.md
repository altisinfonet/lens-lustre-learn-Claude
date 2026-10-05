# P23 · Accessibility: WCAG level, automated CI check, ten-surface walkthrough

**Unit:** P23 · **Lane:** D2 (written by the D3 session; docs only; the CI check below is a *proposal* for D2 to build) · **Date:** 2026-10-04 · **Status:** waiting for the Owner's signature · **Path:** `docs/evidence/d2/phase5/P23/` (R-82 rule 2)

**Gate (GATE_REGISTER.md, verbatim):** "WCAG level chosen; automated checks in CI; keyboard and screen-reader walkthrough of the ten primary surfaces." Note in the register: "The ten surfaces are named in the evidence artefact, not left implicit."

> **OWNER SIGN-OFF:** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

To sign, tick the box or comment `P23 approved` on the PR. Merging the PR also counts (R-88 OWNER-ATTESTED).

**What signing closes and what it doesn't:** signing closes clause 1 (the level). It also fixes the method and the surface list for clauses 2 and 3. Clause 2 closes when D2's CI check is green on staging and has been shown failing first. Clause 3 closes when the ten walkthrough records exist (§4).

---

## 1 · Decision: the level

| # | Decision |
|---|---|
| L1 | **Target: WCAG 2.2, level AA.** It applies to the web app and to the Android/iOS app, which run the same React code. |
| L2 | Why 2.2 rather than 2.1: 2.2 adds **2.5.8 Target Size (Minimum)**, and that is our largest measured gap (§2: 39 of 61 production issues). The UI gate already measures tap targets (`tools/uishot/tap-targets.mjs`, F-103). Picking 2.1 would drop the one rule we already enforce. |
| L3 | AAA criteria are not targeted. A criterion that falls short of AA is a defect against this decision, not a nice-to-have. |
| L4 | **Known exceptions, written down, not waived:** photo content itself has no alt text beyond what the author types. Member images get `alt` = the caption, or "Photo by <name>" when there is no caption. Adding author-supplied alt text is a later product item, not P23. |

## 2 · Baseline, measured 2026-10-04 (axe-core 4.13.0, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, viewport 390×844 mobile)

The probe is read-only: Playwright opens each page, injects `axe.min.js` and calls `axe.run(document, {runOnly: tags, resultTypes: ['violations']})`. No repo dependency was added; axe was installed in a scratch directory. The probe source is in §6.

**A · UI harness, all 50 scenes** (staging `cb188b0`, `npm run ui:harness` with the ui-gate.yml fake env, 15:13:36 → 15:16:52 UTC) → file `axe-harness-2026-10-04T15-13-36Z.ndjson`.
**39 / 50 scenes clean.** 37 failing nodes in 11 scenes:

| rule (WCAG) | impact | nodes | where |
|---|---|---:|---|
| button-name (4.1.2) | critical | 15 | screen-feed 7, journey-create-from-feed 7, screen-post-detail 1 |
| link-name (2.4.4/4.1.2) | serious | 11 | screen-discover 4, screen-feed 3, journey-create-from-feed 3, screen-post-detail 1 |
| label (1.3.1/4.1.2) | critical | 4 | the 4 hashtag-list scenes (the hashtag input) |
| aria-required-children (1.3.1) | critical | 2 | screen-feed, journey-create-from-feed |
| link-in-text-block (1.4.1) | serious | 2 | screen-login |
| nested-interactive (4.1.2) | serious | 2 | screen-notifications |
| color-contrast (1.4.3) | serious | 1 | screen-profile |

**B · Production, 12 public signed-out routes** (`https://www.50mmretina.com`, 15:16:53 → 15:18:47 UTC) → file `axe-prod-2026-10-04T15-16-53Z.ndjson`. **61 failing nodes, 0 clean routes:**
target-size 39 (4 on nearly every route, so most likely the shared navigation or footer; not traced) · color-contrast 14 (`/` 8, the course pages 6) · link-in-text-block 7 (`/login`, `/signup`, `/discover`) · label 1 (critical, `/verify`).

**What this baseline does not cover:** axe catches roughly a third of WCAG failures. Focus order, focus traps, screen-reader announcements and gestures are covered only by the walkthrough in §4.

## 3 · Proposal for the CI check (D2 builds it; one PR; T2)

| # | Proposal |
|---|---|
| C1 | **Where:** a new step in `ui-gate.yml`, or `d2-a11y.yml`, running `node tools/uishot/axe.mjs` against the **same harness server** `npm run ui:gate` already starts. It needs no network and uses fake data, so it is deterministic. **All scenes, every run.** New scenes are covered automatically. |
| C2 | **Rule set:** axe tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` (L1). No rule is disabled in config. A rule judged a false positive is listed in a committed allow-file, one line per scene + rule + selector, with a reason, so silencing it shows up in diffs. |
| C3 | **Binding from day one, as a ratchet:** commit `tools/uishot/axe.baseline.json` (per scene, per rule, the node count, starting at §2 A). **The build FAILS when** a scene's count for any rule goes up, a new rule appears in any scene, or a currently clean scene gets any violation. Counts may only go down. A count going down without the baseline file being lowered also FAILS, so the improvement gets locked in. This is the same pattern as F-103 tap targets and M11. |
| C4 | **Critical = 0 by the P-5 promotion:** the 21 critical nodes (button-name 15, label 4, aria-required-children 2) are fixed in D2 PRs before Phase 5 is promoted. The serious ones ratchet down. |
| C5 | **Shown failing first** (rule 9): on the PR, temporarily add an icon-only `<button>` with no name to one scene → the check goes red, naming that scene and `button-name` → revert → green. Both run URLs go in the evidence. |
| C6 | **Dependency:** `axe-core` (MPL-2.0, no runtime footprint; a devDependency only). It needs the **Auditor's dependency window**, since this session did not touch `package.json`. If the window is refused, `tools/uishot/axe.mjs` can vendor `axe.min.js` under `tools/` with its licence. |
| C7 | **Production monitor (does not block, R-82):** the same probe over the 12 public routes, run on every main push after the deploy has served the pushed commit (the F-AUD-1 lesson), with the result uploaded as an artefact. |
| C8 | Optional, later: `eslint-plugin-jsx-a11y` in `recommended`, ratcheted the same way. It would be a second dependency, so it is not part of P23's close. |

## 4 · The ten primary surfaces (named, per the register's note)

| # | surface | harness scene(s) | production route |
|---|---|---|---|
| 1 | Landing / home (signed out) | — | `/` |
| 2 | Sign in and sign up | `screen-login` | `/login`, `/signup` |
| 3 | Feed | `screen-feed` | `/feed` |
| 4 | Post composer (incl. crop, audience, hashtags) | `composer-*`, `crop-modal-*`, `post-audience-chooser`, `hashtag-list-*`, `journey-create-from-feed` | `/feed?compose=1` |
| 5 | Post detail + comments | `screen-post-detail`, `comments-panel*`, `mention-list-over-comment-box` | `/post/:id` |
| 6 | Profile / wall (own and visitor) | `screen-profile`, `screen-wall*`, `profile-grid*` | `/profile/:id` |
| 7 | Discover | `screen-discover` | `/discover` |
| 8 | Competitions: list, entry, voting lightbox, winners | `screen-voting-lightbox`, `screen-winners` | `/competitions`, `/winners` |
| 9 | Notifications | `screen-notifications` | `/notifications` |
| 10 | Account and settings | `screen-account-sheet`, `screen-notification-settings`, `screen-dashboard` | `/dashboard`, `/settings/notifications` |

**Walkthrough protocol (one record per surface, `docs/evidence/d2/phase5/P23/walkthrough/<n>-<surface>.md`):**
- **Keyboard only** (desktop Chrome, web): every control reachable by Tab, the order follows the visual order, a visible focus ring, Esc closes dialogs and returns focus to the opener, no traps.
- **Screen reader:** TalkBack on a real mid-range Android (the app build) and NVDA + Chrome (web). Check that every control announces its name, role and state, that images announce alt text, that toasts and errors are announced (live region), and that headings make sense in reading order.
- **Zoom/reflow:** 200 % text with no loss of content, and a 320 px width with no horizontal scroll.
- Each record holds: tester, device or AT version, UTC time, pass/fail per line, and the defect IDs raised. The Owner or D2 performs these. This is hands-on work, not a wait, so it is not deferred under rule 9.

## 5 · Findings

- **F-D3-10 · 21 critical axe violations in the harness:** unnamed buttons on the feed and post detail (15, most likely icon-only buttons), the unlabelled hashtag input (4) and ARIA list structure (2). Owner of the fix: D2.
- **F-D3-11 · Production: 39 target-size failures**, a 4-node pattern repeated on nearly every public route (shared chrome, most likely). One fix there clears about 40 nodes. 14 contrast failures on `/` and the course pages.
- **F-D3-12 · `/verify` has an unlabelled input** (critical). That is the certificate verification form, used by the public.

## 6 · Probe source (as run)

```js
// node _axe.mjs harness|prod   (Playwright from the repo, axe-core 4.13.0 from a scratch dir)
const TAGS=['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
// context: viewport 390x844, isMobile, hasTouch, dpr 2
// harness: list a[href^='?scene='] on /uiharness.html, visit each ?scene=<name>
// prod: https://www.50mmretina.com + / /discover /competitions /journal /journal/art-of-golden-hour-photography
//       /courses /courses/documentary-photography-masterclass /winners /login /signup /help-support /verify
// each: goto(networkidle) -> wait 2500 ms -> addScriptTag(axe.min.js)
//       -> axe.run(document,{runOnly:{type:'tag',values:TAGS},resultTypes:['violations']})
//       -> one ndjson line: name, url, violations, nodes, byRule[{id,impact,nodes,tags}], atUtc
```
