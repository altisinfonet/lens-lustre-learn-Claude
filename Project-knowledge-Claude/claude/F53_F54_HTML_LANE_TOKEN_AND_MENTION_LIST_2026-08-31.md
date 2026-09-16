# F-53 AND F-54 — THE HTML LANE TOKEN, AND WHY CI COULD NOT SEE IT
### Plus the @mention list defect. 2026-08-31, post-promotion.

**Status of this document:** findings record. Nothing here closes a §25 row, and the compiler is not a second party (§25.4).

---

## 1. What was measured, and with what

Every row below is `Requirement → Instrument → Evidence → Result → Status`.

| # | Requirement | Instrument | Evidence | Result | Status |
|---|---|---|---|---|---|
| 1 | Does production substitute `%VITE_SITE_ORIGIN%`? | `curl https://www.50mmretina.com/` | `var origin = "%VITE_SITE_ORIGIN%"` | **NO** — token shipped verbatim | **VERIFIED** |
| 2 | Does staging? | `curl https://staging.50mmretina.com/` | `var origin = "https://staging.50mmretina.com"` | YES | **VERIFIED** |
| 3 | Does the apex redirect to `www`? | `curl -D - https://50mmretina.com/` | `HTTP/2 200`, `access-control-allow-origin: https://50mmretina.com` | **NO redirect.** The apex is its own origin | **VERIFIED** |
| 4 | Is `VITE_SITE_ORIGIN` in the production Pages variables? | Cloudflare dashboard, Pages → `lens-lustre-learn-claude` → Settings → Variables and secrets → Production, read by screenshot | 10 Text variables listed, enumerated in §2 | **ABSENT** | **VERIFIED** |
| 5 | Does the absence reproduce the symptom? | Local `npm run build` with production's exact variable set, `VITE_SITE_ORIGIN` unset | 3 surviving `%VITE_SITE_ORIGIN%` tokens in `dist/index.html`; `%VITE_SUPABASE_URL%` substituted correctly | **REPRODUCED** | **VERIFIED** |
| 6 | Does CI set the variable? | `.github/workflows/web-build.yml`, `build-production` job `env:` | `VITE_SITE_ORIGIN: https://www.50mmretina.com` | **YES — CI sets it; Cloudflare does not** | **VERIFIED** |

### The ten production Pages variables, as read

`ISOLATION_EXPECTED_HOST`, `ISOLATION_FORBIDDEN_HOSTS`, `ISOLATION_FORBIDDEN_REFS`, `NODE_VERSION`, `SITE_ORIGIN`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`.

There **is** a `SITE_ORIGIN = https://www.50mmretina.com`. `index.html` reads `VITE_SITE_ORIGIN`. Vite only exposes names carrying the `VITE_` prefix, so `SITE_ORIGIN` is invisible to it. **A variable that is nearly the right name is not the right name**, and nothing in the pipeline said so.

---

## 2. F-53 — root cause

`index.html` carried `%VITE_SITE_ORIGIN%` and relied on **Vite's built-in HTML env replacement**. That mechanism has **no default**: when the variable is unset, Vite leaves the token in the emitted file and prints one warning line among several hundred.

The defaulting rule — `unset → the production value`, `"" → fail the build` — exists, in `scripts/lane-config.mjs`, and governs everything in `src/` through the `__LANE_*__` defines. **It never reached the HTML.**

The comment sitting beside the token said:

> `%VITE_SITE_ORIGIN%` is substituted at build time, defaulting to the production origin when the build names no lane.

That sentence was false for the whole time it stood there. The mechanism it described did not exist.

### Consequence

`origin.replace(/^https?:\/\//, "")` applied to the literal token yields the token; `apex` computes to `""`; the guard `if (apex && …)` is never true; **the apex→www hop cannot fire.** `https://50mmretina.com/` therefore serves as a separate origin — which is the 2026-08-05 logged-out-origin incident, the one the surrounding comment block was written to prevent.

---

## 3. F-54 (NEW) — CI cannot see Cloudflare's environment

`web-build.yml`'s own header states its purpose:

> This workflow runs the SAME two commands Pages runs — a clean install and a production build — on every push. … What it does is make a web-build failure LOUD and readable here.

It runs the same *commands*. It does **not** run them in the same *environment*: the job declares its own `env:` block, which sets `VITE_SITE_ORIGIN` — with a comment expressly warning that omitting it reopens the 2026-08-05 incident.

So the workflow built the production lane correctly and reported green, while Cloudflare Pages — the thing that builds the site members load — built it wrong. **The check that exists to catch a silent Pages failure is structurally blind to the class of Pages failure that is a missing variable.**

That was created on 2026-08-15 to catch exactly this shape of problem (a broken Pages build that no check could see) and it did not catch this one. **F-54 is not closed by the code fix.** The two lanes' dashboards remain configured differently and nothing compares them.

---

## 4. The fix, and the four cases that were executed

- `laneHtmlTokens()` added to `scripts/lane-config.mjs` — same `laneValue()` rule as `laneDefine()`.
- `laneHtmlPlugin()` in `vite.config.ts` substitutes the lane tokens **before** Vite's own replacement runs.
- `scripts/verify-html-tokens.mjs` — new, wired last into `npm run build`. Fails the build if any `%VITE_…%` token survives into `dist/**/*.html`. **It reads the artefact, not the environment** (standing rule 16).

| Case | Command | Result | Status |
|---|---|---|---|
| A — variable unset (= Cloudflare production today) | `npm run build` with production's env minus `VITE_SITE_ORIGIN` | `var origin = "https://www.50mmretina.com"`, exit 0 | **VERIFIED** |
| B — staging lane | staging env | `var origin = "https://staging.50mmretina.com"`; **0** production hosts in the HTML | **VERIFIED** |
| C — `VITE_SITE_ORIGIN=""` | empty string | build **FAILS**, exit 1, "is set but empty" | **VERIFIED** |
| D — control: planted `%VITE_NOT_SET_ANYWHERE%` in `dist/index.html` | `node scripts/verify-html-tokens.mjs` | **FAILS**, exit 1 | **VERIFIED** |

Case D is the point. A guard that never fails guards nothing.

### My own error, recorded

The first version of that guard matched **any** `%WORD%` — and its first run failed a build that was correct, because it matched the word `%TOKEN%` inside the documentation I had just written. Narrowed to `%VITE_…%`, with the mistake written into the file. A guard that cannot be trusted gets switched off, and then it guards nothing either.

---

## 5. The @mention list — and why the root cause is not the obvious one

Owner's report, 2026-08-31, with a screenshot: *"during tagging in a coments, options are hiding not coming in fornt"*.

### Measured at 360px in a new harness scene

```
list left 92px + width 277.3px = 369.3px    against a 360px screen
document.documentElement.scrollWidth 369    the PAGE scrolled sideways
suggestions overlay z-index 1   vs   send button z-index 10
```

"Ranjana Bhattacharya Chowdhury" cut in half at the screen edge. The send button painted over the list's bottom-right corner. **Desktop was clean** — which is why it passed review and why only the owner, on a phone, saw it.

### Root cause

react-mentions **already guards its right edge**. From `updateSuggestionsPosition`:

```js
if (left + suggestions.offsetWidth > container.offsetWidth) position.right = 0
else                                                        position.left  = left
```

It measures `suggestions` — **the overlay**. Every sizing rule (`minWidth: 260px`, `width: max-content`, `maxWidth: 320px`) plus `position: absolute` had been written on `list`, the `<ul>` *inside* that overlay. An absolutely positioned child is out of flow, so the overlay never grew past the library's default `minWidth: 100`. It reported `offsetWidth` **100** while **277px** was painted. The guard compared the wrong number, concluded the list fitted, and anchored it to the caret.

**The guard was not missing. It was being fed a false measurement by our own styling.** Adding a `zIndex` — the obvious fix, and the one I would have shipped without rendering it — would have cured the overlap and left the clipping exactly as it was.

### Fix

Sizing moved onto the overlay; the `<ul>` keeps only its appearance; `zIndex: 50` on the overlay (a `zIndex` on `list` is inert); `forceSuggestionsAboveCursor` replaces the hand-written `bottom: 100%` so placement is computed from the measured height; `min-w-0` + `truncate` so a long name ellipsises.

| Case (360px unless noted) | before | after |
|---|---|---|
| caret at start | right 369.3 — **9.3px off screen** | right 348 — 12px margin |
| caret far along the line | right 369.3 — **9.3px off** | right 348 |
| box grown to 5 lines | right 369.3 — **9.3px off** | right 348 |
| desktop 1280px | on screen | on screen |

Controls: the render check fails **3 of 4** on the pre-fix code; all **5** source assertions fail on the pre-fix source.

### My second error, recorded — and it is the same error as the bug

The first version of my render probe **passed on the broken code**. It measured `.mention-input__suggestions` — the overlay, 100px — instead of what was painted (277px). *That is precisely the mistake the library makes and that the probe existed to catch, reproduced inside the test written to catch it.*

The second version then measured against `window.innerWidth` — which Chromium **widens** on a mobile context when content overflows sideways. The broken build reported `innerWidth` 369 on a 360px phone, so a 9.3px overflow measured 0.3px against its own inflated ruler.

Both traps are written into `tools/uishot/mention-overflow.mjs`.

**Proposed standing rule 18:** *A measurement taken with the same instrument that produced the fault will confirm the fault as correct. State what the ruler is, and check the ruler against something outside the system.*

---

## 6. Delivery — COMPLETE AND VERIFIED LIVE

| | |
|---|---|
| PR #105 → `staging` | merged as `4da1b1de1b05612f5a6e87d44752e6e82e2acfc6`. 7 checks passed, 1 correctly skipped |
| PR #106 → `main` | **CLOSED UNMERGED** — could not merge, see §7 (F-55) |
| PR #107 → `main` | merged as **`86a17dd1913e279a4171934d0a85a043489328fb`**. 7 passed, 1 skipped, including **Web build / Production lane build** |
| Scope vs `main` | 10 files, **4 A / 6 M / 0 D**, +645 / −10 |

### The identity check that makes this safe

```
tested tree (staging 4da1b1de)      : 96c4152f332f7e8ba056a00979848232109bc1a2
promotion branch tree (67d797f3)    : 96c4152f332f7e8ba056a00979848232109bc1a2
main tree after merge (86a17dd1)    : 96c4152f332f7e8ba056a00979848232109bc1a2
git diff main staging               : empty
```

`main` does not carry a *rebuild* of the tested artefact. It carries **the same tree object**.

**Provenance (standing rule 15).** This session held **no git push credential** — the proxy refused it. Files went up through GitHub's *upload* interface, never retyped, and every one was sha256-compared against the file the gates ran on. The build and both typecheckers were re-run at the pushed head before any merge.

### Gates

| Gate | Result |
|---|---|
| `vitest run` | 2,480 passed, 1 skipped, **0 failed** (180 files) |
| `tsc --noEmit -p tsconfig.app.json` | clean |
| `tsc -b tsconfig.json` (strict — F-52: only `android-build.yml` runs it) | clean |
| `eslint` on changed files | **identical to the pre-change baseline**; none new |
| `tools/uishot/capture.mjs` full sweep | **152 screenshots, 0 problems**; baseline diff clean against 148 keys |
| `tools/uishot/mention-overflow.mjs` | 4/4 on screen (**3/4 fail on the pre-fix code**) |
| CI **Web build / Production lane build** on #107 | **Successful** — the new HTML-token guard runs inside the production lane and passes |

---

## 6a. VERIFIED ON THE LIVE PRODUCTION SITE

Read from the deployed artefact after the Cloudflare build, not from the merge.

| # | Requirement | Instrument | Evidence | Status |
|---|---|---|---|---|
| L1 | No unsubstituted token in production HTML | `curl https://www.50mmretina.com/` | **0** occurrences of `%VITE_…%` (was 2) | **VERIFIED** |
| L2 | The origin literal is real | same | `var origin = "https://www.50mmretina.com"` | **VERIFIED** |
| L3 | The apex hop actually fires | **real Chromium**, navigate to `https://50mmretina.com/` | landed on **`https://www.50mmretina.com/feed`** | **VERIFIED** |
| L4 | The @mention fix is in the shipped bundle | `curl` the production entry chunk | `suggestions:{zIndex:50,…,width:"max-content",minWidth:0,maxWidth:"min(320px, 100%)"…}` and `forceSuggestionsAboveCursor:!0` | **VERIFIED** |
| L5 | The pre-fix styling is gone | same | `minWidth:"260px"` → **0**; `maxWidth:"320px"` → **0** | **VERIFIED** |

**⚠ L3 REQUIRED A BROWSER, AND THAT MATTERS.** `curl https://50mmretina.com/` still answers **HTTP 200 with no `Location` header**, and reading only that would have produced a false negative. The hop is *client-side JavaScript* (`location.replace`), so it cannot appear in response headers. It fires in a browser and was confirmed in one. A real HTTP 301 would need the `cloudflare/seo-edge-injector` Worker redeployed — the index.html comment says exactly this, and that Worker is **not** part of this change.

**Standing rule 18 (proposed), which this is a second instance of:** *a measurement taken with the wrong instrument confirms the wrong answer. Name the instrument, and check it can see the thing being asked about.*

---

## 7. F-55 (NEW) — THE PROMOTION MODEL AND THE MERGE METHOD CONTRADICT EACH OTHER

**PR #106 (`staging` → `main`) passed 8 checks and still could not merge.** GitHub: *"This branch has conflicts that must be resolved"* — `index.html`, `package.json` and others.

Cause, measured: `git merge-base main staging` = **`b671e1fb`**, `main`'s **pre-promotion** state. The 2026-08-31 promotion was a **squash**, so `main`'s commit is not in `staging`'s history and git sees both sides as having rewritten the same files. PR #106 showed "54 commits" for the same reason, while the true content delta was 10 files.

This is the other half of **F-50**. `protect-main` requires linear history, which forbids the merge commit §24.2 step 8 assumes and forces a squash; the squash then guarantees this conflict at the *next* promotion. **The two rules cannot both be satisfied by the documented process.**

**How it was worked around, and why not by resolving the conflicts:** a branch was cut **from `main`** carrying the same ten files at their exact staging bytes. Resolving ten files of conflicts in a web editor would have produced a `main` that no gate had ever run against — and hand-retyping is the exact route that caused C-32. The tree-identity check in §6 is what proves the workaround did not change the artefact.

**NOT FIXED.** `main` and `staging` now hold identical content but still have divergent histories. **The next promotion hits this same wall.** The fix is to reset `staging` onto `main` once; that rewrites `staging`'s history and is the owner's decision, not the compiler's.

---

## 8. My errors this session, recorded rather than buried

1. **The HTML-token guard's first version matched its own documentation** and failed a build that was correct. Narrowed to `%VITE_…%`; the mistake is written into the file.
2. **The dropdown probe's first version passed on the broken code** — it measured the overlay (100px) instead of what was painted (277px). *That is precisely the mistake the library makes and that the probe existed to catch.* Its second version measured against `innerWidth`, which Chromium widens on overflow, making a 9.3px overflow read as 0.3px.
3. **I created a branch that would have deleted the entire repository.** Setting up the main-based branch I injected the branch name into GitHub's `quick_pull` field, which is the PR *base*, not the new branch's name. GitHub took a non-existent base and produced `altisinfonet-patch-36` — a **root commit with no parent containing 3 files**. Caught by diffing the branch against `main` instead of trusting the upload. No PR pointed at it, nothing was merged, `main` and `staging` were untouched. The branch was deleted.

All three were caught by verification, not by review or by luck. That is the argument for the verification, not a reason to relax it.

---

## 9. Open, and deliberately not closed here

1. **F-54** — `web-build.yml` supplies its own `env:`, so CI cannot detect Cloudflare Pages environment drift. It built F-53 correctly and passed while Pages built it wrong. Nothing compares the two lanes' dashboards to each other or to CI.
2. **F-55** — `main`/`staging` histories still diverge; the next promotion conflicts identically.
3. **Cloudflare Pages production still has no `VITE_SITE_ORIGIN`.** Production is now correct without it, but the two lanes remain configured differently.
4. **F-47** — `web-build.yml` `lane-guard`, `${{ }}` inside `run:`. Latent, untouched.
5. **F-50** — `protect-main` linear-history rule vs the §24.2 step 8 merge commit.
6. **F-52** — the strict typecheck still runs only on push to `main`, never on a PR.
7. The two `COMMENT ON POLICY` statements from D-10 were never applied to production.
8. The Android app has not been rebuilt since these fixes.
9. The story-image failure is undiagnosed — it still needs the failing image URL.
10. PR #105 carries a branch-derived title; its description is correct. Cosmetic, unfixed. The commit on `staging` carries the right message.
