# Phase 0 · THE COMMITTED CLIENT BASELINE

**Measured at `staging` SHA `a79494ce2f4993df4b0079ccc52cd46883edeb57`, 2026-09-04.**
Author: D2. Evidence only — this branch changes no source, no workflow, no harness.

Phase 5's entry conditions (plan §5.2) require *"Phase 0 baselines for bundle, chunk and Web-Vitals
figures exist under `docs/evidence/d2/baseline/`."* Until this file, the only thing here was
`client-inventory.md`, and the actual figures existed **only as CI artefacts on run #5** — which
expire, and are not in the repository. Phases 5 and 7 will claim improvements against these numbers,
so they are committed.

## THE RULE THIS FILE OBEYS

**A baseline figure without its command is not a baseline.** Every number below names the exact
command that produced it. That rule came out of `client-inventory.md`, where a stated `<img>` count
of 223 could not be reproduced from any of nine grep variants — a figure with no instrument behind it.

## PROVENANCE — re-measured locally, and why

The figures were **not** lifted from run #5's artefacts. `d2-baseline-33875235679` (id
`9937677104`) could not be downloaded from this container: the API returns 302 and the redirect
target answers `CONNECT tunnel failed, 403` under this session's network policy. Rather than quote
numbers it could not retrieve, D2 re-ran both instruments locally at the staging SHA above.

**These are therefore D2's local readings, not run #5's.** §4 records where they disagree, which
turns out to matter.

---

## 1 · BUNDLE AND CHUNKS

```bash
# lane values are the staging block of .github/workflows/web-build.yml (lines 168-178)
export VITE_SUPABASE_URL=https://ztzutckwdhetphwghuzj.supabase.co
export VITE_SUPABASE_PUBLISHABLE_KEY=<staging anon key, public, from web-build.yml:169>
export VITE_SUPABASE_PROJECT_ID=ztzutckwdhetphwghuzj
export VITE_CDN_HOST=cdn-staging.50mmretina.com
export VITE_SITE_ORIGIN=https://staging.50mmretina.com

rm -rf dist && npm run build
node scripts/web-baseline.mjs --dist=dist --out=docs/evidence/d2/baseline
```

Build `14:38:05Z` → `14:38:40Z`; measurement written `14:38:52.984Z`.
**File: `web-baseline-2026-09-04T14-38-52-984Z-7fc5124b.ndjson`** — 292 lines, **0 unstamped**.

| figure | raw | gzip | brotli |
|---|---:|---:|---:|
| **entry chunk** `assets/index-BfNhAIsT.js` | **1 563 118 B** | **486 192 B** | — |
| **initial payload** (6 files) | **2 094 451 B** | **622 998 B** | — |
| **all assets** (283 files) | **7 271 776 B** | **2 874 488 B** | **2 571 758 B** |
| JavaScript only | 5 948 790 B | — | — |
| language dictionaries | 498 682 B | — | — |

283 files · 248 JS chunks · 1 CSS file · languages detected `bn, gu, hi, mr, ta, te`, all in the
single chunk `assets/translations.rest-CApbV07m.js` — **which is P15/P16's target: one chunk per
language, not one chunk for six.**

**Ten largest chunks** (raw / gzip):

| chunk | raw | gzip |
|---|---:|---:|
| `assets/index-BfNhAIsT.js` | 1 563 118 | 486 192 |
| `assets/translations.rest-CApbV07m.js` | 498 682 | 111 552 |
| `assets/AdminAnalytics-D3jHM2aV.js` | 412 267 | 112 712 |
| `assets/jspdf.es.min-BCzmL4Bt.js` | 384 540 | 125 350 |
| `assets/html2canvas.esm-DXEQVQnt.js` | 201 041 | 47 182 |
| `assets/index.es-DLH6jenK.js` | 158 303 | 52 686 |
| `assets/CinemaJudgeView-LWuq--yX.js` | 156 010 | 38 190 |
| `assets/vendor-framer-motion-BTWshcLX.js` | 136 516 | 45 340 |
| `assets/vendor-react-markdown-0EDViLax.js` | 117 593 | 36 116 |
| `assets/JudgePanel-B7rME4Hb.js` | 82 647 | 25 577 |

Per-asset rows for all 283 files are in the ndjson as `type:"asset"`.

## 2 · WEB VITALS

```bash
node scripts/web-vitals-report.mjs \
  --dist=dist --routes="/,/feed,/wall" --runs=3 \
  --chromium=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  --out=docs/evidence/d2/baseline
```

Ran `14:39:09Z` → `14:42:20Z`; written `14:42:20.561Z`. Script exit **0**.
**File: `web-vitals-2026-09-04T14-42-20-561Z-9a5e605c.ndjson`** — 13 lines, **0 unstamped**.

`--chromium=` is required locally and **not** in CI: this container carries chromium **1194** while
the pinned Playwright wants **1234**, the exact drift `web-vitals-report.mjs` warns about in its
launch comment. Naming the binary is the flag's documented purpose; the harness is unmodified.

### ⚠ SUPERSEDED — `web-vitals-2026-09-04T14-42-20-561Z-9a5e605c.ndjson`

**This run is retained for the record and must NOT be used as a before-figure. Reason: F-83.**
Two of its three routes were not measuring what the route list implied:

| route | status | LCP | CLS | INP | |
|---|---|---:|---:|---:|---|
| `/` | measured | 4016 ms | 0 | ~64 ms | valid |
| `/feed` | **unmeasured** | — | — | — | **redirects to `/login`** — `src/pages/Feed.tsx:88-90`, ~300 ms after mount. Unmeasurable by an anonymous harness by construction; a longer settle does not help, because waiting longer does not make a redirect stop happening. |
| `/wall` | measured | 4020 ms | 0 | ~64 ms | **NOT A ROUTE.** Only grep hit is `/wallet` (`App.tsx:414`); `/wall` fell to the catch-all at `App.tsx:440`. **These figures measure the 404 handler.** |

Cause, navigation chains and the verified replacements:
[`feed-unmeasured-20260904.md`](./feed-unmeasured-20260904.md).

### THE VITALS BASELINE OF RECORD — `web-vitals-2026-09-04T16-04-46-914Z-8e6ae2ec.ndjson`

Route list corrected to `/,/competitions,/journal` (`d2-web-vitals.yml:119`). All three were loaded
anonymously against the built `dist` and render fully with no redirect.

```bash
node scripts/web-vitals-report.mjs \
  --dist=dist --routes="/,/competitions,/journal" --runs=3 \
  --chromium=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  --out=docs/evidence/d2/baseline
```

Measured `16:02:11Z` → `16:04:46Z`; written `16:04:46.914Z`. **3/3 routes `status=measured`, zero
unmeasured samples.**

| route | status | LCP | CLS | INP |
|---|---|---:|---:|---:|
| `/` | **measured** | **4064 ms** | **0** | **~96 ms** |
| `/competitions` | **measured** | **4048 ms** | **0** | **~80 ms** |
| `/journal` | **measured** | **4052 ms** | **0** | **~72 ms** |

#### The same three routes on CI — `d2-web-vitals.yml` run #16, `33895388972`, 2026-09-04T16:32:57.527Z

Recorded beside the local run rather than replacing it: the two disagree in a way
that matters, and averaging them away would destroy the finding.

| route | status | LCP | CLS | INP |
|---|---|---:|---:|---:|
| `/` | **measured** | **3560 ms** | **0** | ~56 ms |
| `/competitions` | **measured** | **3556 ms** | **0.2539** | ~72 ms |
| `/journal` | **measured** | **3992 ms** | **0.1119** | ~40 ms |

`9 measured sample(s)` · `622 records, every one stamped UTC` · artefact
`d2-baseline-33895388972` (id `9945643706`, 52 197 B). **3/3 measured in CI, matching
the local run's 3/3 — F-83 is closed by measurement on both sides.**

⚠ **WHICH RUN THIS IS, stated exactly.** The staging run fired by the F-83 merge
itself — run #15, `33895356888`, head `ca2359b` — was **CANCELLED**, not completed:
D1's F-84 merge (#168) pushed 20 seconds later and the workflow carries
`concurrency: cancel-in-progress: true`. So the figures above are from **run #16 at
`95082b8`**, D1's commit, which has the F-83 merge `ca2359b` as an ancestor
(`git merge-base --is-ancestor` — verified) and whose own log shows
`VITALS_ROUTES: /,/competitions,/journal`. It carried the corrected list; it was
simply not triggered by the commit that introduced it.

**That is itself worth knowing: a staging run tied to a specific commit may never
exist, because the next merge cancels it.** Anyone citing "the run on commit X"
should check the run was not cancelled before quoting it.

⚠ **AND IT SHARPENS F-82.** The CLS figures are **identical** between the PR run
(`33894335422`, `/competitions` 0.2539, `/journal` 0.1119) and this staging run —
byte-for-byte the same values, on different runners, at different commits — while
the local runs return **0** for both. CLS is therefore **deterministic within CI and
systematically different from local**: not sampling noise, and not the `/wall`
artefact this session first proposed as a candidate. **That candidate is disproven.**
LCP, by contrast, agrees closely across environments (3556–3992 ms CI against
4048–4064 ms local) and looks like something P13 could set a ceiling on. CLS does
not.

### The caveat, in the harness's own words

> `realDevice: false` — *"Emulated Chromium on CI. The standard of practice requires a real
> mid-range Android for before/after performance claims; that leg is BLOCKED in CI and must be
> measured by hand."*

Profile `android-mid-2026`: 360×800 at DPR 3, CPU throttle **4×**, network *Slow 4G*
(150 ms latency, 209 715 B/s down). `mode: report-only`, `blocking: false`,
`blockingBecomes: "P13 (Phase 5) — until then a red number is information, not a stop"`.

**And what was measured is the bundle over localhost**, not the deployed origin — the harness serves
`dist/` from `127.0.0.1`. No CDN, no TLS, no real network path.

---

## 3 · FINDING — the vitals instrument records NO git provenance

```
web-baseline-…ndjson   git = {commit: a79494ce…, branch: d2/P0-baseline-figures-20260904}
web-vitals-…ndjson     git = None
```

`grep -c git scripts/web-vitals-report.mjs` → **0**. `web-baseline.mjs` captures commit and branch
(`gitProvenance()`, line 302) — that was **F-3's fix**. Its sibling never got it, so a committed
vitals file **cannot say which commit it measured**. For a baseline Phases 5 and 7 will claim
improvements against, that is the F-3 defect uncorrected in the other instrument.

**Not fixed here.** The harness is proven and hash-locked at `0149fd02…`; changing it would
invalidate the negative controls just accepted. Raised for the Auditor to route. The staging SHA is
recorded in this README instead, which is a document making up for what the instrument should emit.

## 4 · FINDING — the vitals figures are NOT reproducible between environments

Same commit, same routes, same run count, same profile:

| | CI run #5 (`33875235679`) | this local run |
|---|---|---|
| `/wall` LCP | 3992 ms | 4020 ms |
| `/wall` **CLS** | **0.7462** | **0** |
| `/` LCP | *(not retrievable)* | 4016 ms |
| `/feed` | partially measured | **wholly unmeasured** |

LCP agrees within 1 %. **CLS does not agree at all** — 0.7462 against 0. A layout-shift score three
times the "poor" threshold on one runner and a perfect zero on another is not sampling noise; it is
the metric measuring something environmental.

**Consequence for P13, stated now rather than discovered then:** a byte ceiling can be set against
§1, which is deterministic. **A CLS ceiling cannot be set against these numbers.** P13 needs either
a stable instrument or a stated tolerance, and the decision should be made knowing the spread rather
than after the first build fails on a metric that reads 0 locally.

## 5 · Every line stamped

```
web-baseline-2026-09-04T14-38-52-984Z-7fc5124b.ndjson   292 lines, 0 unstamped
web-vitals-2026-09-04T14-42-20-561Z-9a5e605c.ndjson    13 lines, 0 unstamped
```

Verified by matching `measuredAtUtc` on every line against
`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`.
