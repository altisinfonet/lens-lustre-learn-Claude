# Phase 0 · 0.5 — the Web-Vitals harness gate, proved on both halves

**Branch:** `d2/P0-web-vitals-20260903`, refreshed onto `staging` @ `580dede`. **Date:** 2026-09-04.
**Author:** D2. Everything below was run by D2 in this container; none of it is inherited.

## 0 · The gate, verbatim

> "The Web-Vitals harness runs on every PR and **blocks nothing**."

Two halves, and the second is the one that rots quietly: *blocks nothing* is trivially true right
up until the day it is not. C-34 applies to it exactly like anything else, so both halves are
demonstrated below rather than asserted.

## 1 · #134 vs #137 — the duplicate, resolved

**They are not two copies of the work.** Both point at the *same head branch*
`d2/P0-web-vitals-20260903` at the *same commit* `3435636`. They differ only in base:

| PR | base | state |
|---|---|---|
| **#134** | `d2/P0-web-baseline-20260903` | **STALE — should be closed** |
| **#137** | `staging` | **CURRENT — land this one** |

`#134`'s base is deliverable 0.4's branch, whose content was already squash-merged as **#133**
(`scripts/web-baseline.mjs` is present on `staging` today). Merging #134 would merge into that
already-landed branch, **not** into `staging` — it would read as progress and land nothing.

**Closing #134 costs nothing:** both PRs share a head, and closing a PR does not delete its branch.

**Correction owed on #137's own body.** It states that GitHub "closed [#134] when its base branch
`d2/P0-web-baseline-20260903` was squash-merged as #133". It did not — **#134 is open**, measured
just now. GitHub auto-closes a PR only when its base branch is *deleted*, and that branch still
exists on origin at `d44c4859`. **That is precisely why the duplicate exists**, and the belief that
it had auto-closed is what let it sit.

## 2 · Staleness — measured, and larger than reported

```
behind: 78 commits    ahead: 3 commits    merge-base: 7f9b2ee
```

Reported as "stale by five commits" (P30, F-72, F-73, F-73b, the promotion). It is **78**: those
five are only the most recent, and the merge-base `7f9b2ee` predates all of them. Its green checks
were measuring a tree nobody was going to merge.

**Merged, not rebased.** D2 did not create this branch, two open PRs point at the same head, and a
rebase would force-push another session's commits out from under both. A merge keeps every checkout
and PR reference valid, and the repository squash-merges to `staging`, so the merge commit never
reaches `staging`'s history. **No conflicts.**

`scripts/web-baseline.mjs` and `scripts/web-baseline.test.mjs` on this branch are **byte-identical**
to the copies #133 landed (sha256 `410d79fd3423ed3c…`, `563352c7d13a2c5e…`), which is why the
three-dot diff shows four files while only two are genuinely new. Against today's `staging` the
branch adds exactly:

```
.github/workflows/d2-web-vitals.yml | 243 ++++
scripts/web-vitals-report.mjs       | 520 ++++
2 files changed, 763 insertions(+)
```

## 3 · HALF ONE — it runs, and a harness that did not run is caught

The **real** `run:` block was extracted from the step *"The harness measured something"* in
`.github/workflows/d2-web-vitals.yml` and executed directly — not a retyped copy, so this tests the
guard rather than a transcription of it.

| # | fixture | guard |
|---|---|---|
| a | `run.status = "unmeasured"`, reason "chromium would not launch" | **exit 1** — `::error::the harness did not run: …` |
| b | run completed, one `sample` with `status:"unmeasured"` | **exit 1** — `::error::no route produced a measurement.` |
| d | no `web-vitals-*.ndjson` written at all | **exit 1** — `::error::no web-vitals-*.ndjson was written` |

## 4 · HALF TWO — a bad reading blocks nothing

| # | fixture | guard |
|---|---|---|
| c | `sample` **measured**, `lcpMs: 99999`, `cls: 0.9`, `inpMs: 5000` | **exit 0** — "1 measured sample(s) … the harness ran. Values are report-only until P13." |

A catastrophically bad but **real** measurement does not turn the job red. Read from the workflow
to confirm the mechanism rather than infer it: every failure surface in the file is an *envelope*
check — the script's exit code, the file's existence, `run.status`, the measured-sample count.
**No LCP, CLS, INP or byte count reaches the exit code of this workflow.**

## 5 · The exit-0 contract, reproduced end to end on real output

```
$ node scripts/web-vitals-report.mjs --chromium=/nonexistent/chrome --out=… --routes=/ --runs=1
SCRIPT EXIT = 0
  UNMEASURED (run): neither --url was given nor does …/dist exist, so there is nothing to load

$ EVIDENCE_DIR=… bash <the real guard step>
::error::the harness did not run: neither --url was given nor does …/dist exist…
GUARD EXIT = 1
```

The script exits **0** while genuinely unable to measure, writes an honest `status:"unmeasured"`
record, and the **content** guard catches what the old **envelope** guards would have waved through.
That is the F-2 defect and its fix, shown on real output.

*Stated precisely:* the unmeasured reason reached here was "no `dist/`" rather than "chromium would
not launch", because this run did not build first. Same class and same code path; the chromium
reason is covered as fixture (a).

## 6 · F-47 re-checked on the modified workflow

Every `run:` block parsed: **no step interpolates `${{ }}`**. Values arrive through `env:`.

## 7 · Suite

```
BEFORE (staging 580dede)   Test Files  5 failed | 174 passed | 1 skipped (180)
                                Tests  2 failed | 2456 passed | 1 skipped (2459)
AFTER  (this branch)       Test Files  5 failed | 174 passed | 1 skipped (180)
                                Tests  2 failed | 2456 passed | 1 skipped (2459)
```

**Identical.** This branch adds a workflow and a Node script, no vitest tests, so the count is
unchanged by design. `node --test scripts/web-baseline.test.mjs` — `# fail 0`.

## 8 · One observation, not a blocker

`scripts/web-baseline.mjs` ships with `scripts/web-baseline.test.mjs` (373 lines). Its sibling
`scripts/web-vitals-report.mjs` (520 lines) has **no** sibling node test — its only automated
coverage is the workflow guard step proved above, which exercises the *output contract* but not
`parseArgs`, the record shape, or the throttling profile. Not raised as a blocker for a report-only
Phase 0 harness; recorded so it is a decision rather than an oversight when P13 makes this binding.
