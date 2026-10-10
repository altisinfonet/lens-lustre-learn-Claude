# D2 review of PR #126 — "D2 · Phase 0 · 0.4 — web baseline instrument and its tests"

**Reviewer:** D2 (this session) · **Reviewed at:** head `85fc2ea` on `altisinfonet-patch-36`, merge-base `ef5d4a3` = `origin/staging` · **Read on:** 2026-09-02 11:50Z–12:05Z
**Standing:** this is a developer's technical review for the Auditor. It approves nothing and closes nothing. I did not author these files and I hold no independence claim beyond that.

First, the two facts that frame everything below, both verified from the running system, not remembered:

- `git remote get-url --push origin` in my clone prints `https://github.com/altisinfonet/lens-lustre-learn-Claude.git` — **not** `DISABLED_NO_PUSH_AUTHORITY` — and a push is nonetheless refused by the proxy (repository not in the session's authorised set, re-tested 2026-09-02 06:45Z). Transfer channel used, as instructed.
- The three script hashes and byte counts in the PR body **match the branch exactly** (`4287dd22…` 27,752 B · `69b66a2c…` 17,229 B · `0149fd02…` 23,442 B). The PR body is truthful about what it carries.

## What I did

| Step | Instrument | Result |
|---|---|---|
| Ran the suite | `node --test scripts/web-baseline.test.mjs` at `85fc2ea` | **14 / 14 pass**, 763 ms |
| Planted a defect in the suite's own stated control | `UTC_ISO` regex loosened to `/^.+$/` | **Caught** — test 5 "NEGATIVE CONTROL: serializeRecords refuses … non-UTC" fails. The suite has teeth where it says it does. |
| Ran the instrument end to end | `web-baseline.mjs --dist=dist` against a faithful staging-lane build at `ef5d4a3` | 291 records, exit 0, every record stamped |
| Ran the harness end to end | `web-vitals-report.mjs --routes=/ --runs=3`, emulated android profile | 5 records, `status: measured`, LCP median **4,044 ms**, CLS 0, INP≈ 72 ms |
| Planted a malfunction in the harness | `--chromium=/nonexistent/chrome` | **exit 0**, one stamped `status: unmeasured` record — see F-2 |
| F-47 | parsed every `run:` value in `d2-web-vitals.yml` | **clean**, 0 of 11 steps interpolate `${{ }}` |
| Standing Rule 21 | cross-references in headers and emitted records against the Gate Register | **five wrong unit numbers** — see F-1 |

## Findings

### F-1 · Wrong unit cross-references, in comments AND in the emitted evidence — Standing Rule 21

`scripts/web-baseline.mjs` says "what the edge actually returns is **P21**" (lines 33, 432) and "when **P16** emits one chunk per language" (lines 43, 184, 402). Against `docs/gates/GATE_REGISTER.md` at `ef5d4a3`: **P15** is transfer compression, **P21** is font policy; **P12** is one chunk per language, **P16** is AVIF.

This is not a comment nit. The strings at lines 402 and 432 are **written into every `language` record and the `run` record of the baseline artefact** (`blockedReason: "… P16 (one chunk per language) is what makes it measurable."`, `meaning: "… that is P21 …"`). The Gate Register will be read against this artefact for P12 and P15. An evidence file that names the wrong gate sends the next reader to the wrong row. Rule 21: an instructing comment is a control; when it disagrees with the truth, that is a finding.

**Fix:** P21 → P15 (×2), P16 → P12 (×3). Five string edits, no logic change. Because the strings are emitted, the artefact must be re-generated after the fix, not patched.

### F-2 · The harness job goes green with zero measurements — the C-34 shape, proven by plant

Design as shipped: `web-vitals-report.mjs` exits 0 on every path and reports a failure to measure as `status: "unmeasured"` with a reason. The workflow then asserts the exit code is 0 ("The vitals harness is still report-only") and that evidence files exist with every line stamped ("The evidence exists, and every line carries a UTC timestamp").

Plant: `--chromium=/nonexistent/chrome`. Result, verbatim:

```
exit=0
  UNMEASURED (run): chromium would not launch: … executable doesn't exist at /nonexistent/chrome
  written /tmp/ev/web-vitals-2026-09-02T11-54-53-662Z-3370553f.ndjson
files: 1   every line stamped: True   -> step PASSES, job GREEN, zero measurements
```

Both workflow guards check the **envelope** (a file exists, lines are stamped) and neither checks the **content** (did any route measure?). A missing browser in CI therefore produces a green job, an uploaded artefact, and no LCP/INP/CLS — which fails the Phase 0 gate ("LCP/INP/CLS on a mid-range Android profile") while looking like a pass. The register's Rule 2 names this exactly: a green result whose test could not have failed.

To be fair to the design: the *record* is honest. The *job* is not. "Must not fail a build" was written about budget values, not about the harness failing to start — the same sentence in the kickoff continues "making it blocking is P13", and P13 is about ceilings, not about whether Chromium launched.

**Fix (D2-owned file, `d2-web-vitals.yml`, one step — no change to the script, no change to its exit-0 contract):** after the vitals step, fail when the `run` record is `unmeasured` or no `sample` record is `measured`:

```yaml
      - name: The harness measured something (a malfunction is not a value)
        run: |
          set -euo pipefail
          node -e '
            const fs = require("node:fs"), path = require("node:path");
            const dir = process.env.EVIDENCE_DIR;
            const f = fs.readdirSync(dir).filter(n => /^web-vitals-.*\.ndjson$/.test(n)).sort().pop();
            const recs = fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map(JSON.parse);
            const run = recs.find(r => r.type === "run" && r.status !== "started");
            const measured = recs.filter(r => r.type === "sample" && r.status === "measured").length;
            if (run && run.status === "unmeasured") { console.error("::error::harness did not run: " + run.reason); process.exit(1); }
            if (measured === 0) { console.error("::error::no route produced a measurement — a value over budget is report-only; no value at all is a harness fault"); process.exit(1); }
            console.log(measured + " measured sample(s)");
          '
```

This keeps the separation the PR body argues for: **a red number is information; no number is a defect.** I built the same distinction into my own (now superseded) instrument and it caught a real sandbox fault on its first run — a Chromium build mismatch that would otherwise have read as a perfect page.

### F-3 · `gitProvenance()` silently returns `null, null` in any git worktree

`gitProvenance(root)` reads `.git/HEAD` as a file. In a worktree, `.git` is a **file** containing `gitdir: <path>`, so `path.join(root, ".git", "HEAD")` does not exist, the `catch` swallows it, and the `run` record carries `git: { commit: null, branch: null }`. Observed on the artefact I generated — from a real git worktree at `85fc2ea` — and reproduced by reading the function.

On `actions/checkout` the layout is a plain `.git` directory, so CI will populate it. But the instrument is documented as runnable locally, and locally it degrades **silently**: a null that looks like "not applicable" rather than "could not read". The PR body's own honesty — "a checkout whose provenance is not a named CI commit" — is partly this defect describing itself.

**Fix:** if `.git` is a file, follow the `gitdir:` pointer (it is one line; still built-ins only). And on failure emit `git: { status: "unknown", reason: … }` rather than bare nulls, so an artefact without provenance says so.

### F-4 · Two things the PR body says that I confirm, and one it leaves for the Auditor

- **Node built-ins only, dependency window untouched** — confirmed: `package.json` / `package-lock.json` unchanged on the branch; `playwright` is imported dynamically and is already a devDependency.
- **"1 dictionary chunk out of 246"** — my faithful staging-lane build shows the `summary` record reporting `jsChunks: 247` while `ls dist/assets/*.js` counts 246. Same build. Recorded, not resolved — likely one non-`assets/` script counted by the walker. Not a finding against the instrument; a definition to pin down before P13 uses the count.
- **The harness lives at `scripts/web-vitals-report.mjs`; the kickoff names `tools/uishot/**`.** The Owner reports the Auditor is moving it. Not a finding — a confirmation that the split is the Auditor's and I have not touched it.

## What is VERIFIED here and what is not

| Claim | Status | Basis |
|---|---|---|
| 14/14 tests pass at `85fc2ea` | VERIFIED | my own run, 2026-09-02 11:52Z |
| The suite catches a loosened UTC check | VERIFIED | planted, one failure, 11:58Z |
| F-1 wrong unit numbers, five sites | VERIFIED | grep against the register at `ef5d4a3` |
| F-2 green job with zero measurements | VERIFIED | planted `--chromium=/nonexistent/chrome`, exit 0, 11:54Z; workflow guards read and reasoned, **not executed in CI** — the CI run itself is INFERRED from the YAML |
| F-3 null provenance in a worktree | VERIFIED | observed in the generated `run` record; cause read in source |
| PR #126 hashes match the branch | VERIFIED | sha256 of three files at `85fc2ea` |
| CI checks on #126 are green | RELAYED | read from the PR page in a real browser; I did not open the run |

## Housekeeping I owe the Auditor

My own Phase 0 branch `d2/P0-web-baseline-20260902` (commit `4dd5f1f`, one commit off `f648533`, never reached origin) is a **second implementation of the same deliverable**. Two instruments for one gate is the "second way to do the same thing" the D2 standard forbids. PR #126's instrument is on the branch under review, is better tested, and is the one the Auditor is splitting. **Mine is retired.** Its one contribution worth carrying is F-2's malfunction guard, offered above as a workflow step rather than as a competing script. The patch file I placed in the Owner's clone should be discarded, not applied.
