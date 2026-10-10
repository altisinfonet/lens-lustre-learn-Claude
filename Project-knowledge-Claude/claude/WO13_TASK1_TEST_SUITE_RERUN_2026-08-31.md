# WO-13 Task 1 — independent test-suite re-run at `a42b209e`

Session 2 (independent measurement). Read-only: no branch, commit, push, merge, tag, deploy or migration; `docs/PROMOTION_LEDGER.md` untouched; no credential value appears here. The green run and the planted-defect proof are reported together, as ordered.

**This run is bound to `a42b209e4f70a6efed4f3dcdb654e0f994416594`. It says nothing about any other head. If the replacement RC is adopted, this run must be repeated against it — the replacement branch is local to Developer 1's container and unpushed, and I could not reach it (checked 2026-08-31T05:52Z).**

Transcripts: `WO13_TASK1_TRANSCRIPTS.tar.gz`, sha256 `41ab806ec94a64b57e0a44d202b9d603df00ced7af3440adabc20ad1f897c906`, 522,892 B, with an inner `MANIFEST.sha256` over all seven logs.

---

## 1a · Checkout identity, proved before any test ran — 2026-08-31T05:52:47Z

```
$ git rev-parse HEAD
a42b209e4f70a6efed4f3dcdb654e0f994416594
$ git rev-parse --abbrev-ref HEAD
HEAD                                  # detached, no branch created
$ git status --porcelain
                                      # 0 lines
$ git rev-parse HEAD^{tree}
10d4dfacd4802bdcf42e71a83d5913e277f5316c
$ git log -1 --format='%H%n%ad%n%s' --date=iso
a42b209e4f70a6efed4f3dcdb654e0f994416594
2026-08-29 13:45:37 +0530
fix(security): allowlist the STAGING anon key too — AF-19
$ git branch -a --contains HEAD
* (no branch) · remotes/origin/staging · remotes/pr/104

$ sha256sum package-lock.json bun.lock bun.lockb
2c19224ae1dde95988d507d715b7858130dc303ac4a2d9ea0b06d1b352fb7a9f  package-lock.json
7a481c8bf2eb86387379020cf643af0c0af1fe3c438caf513a1f613dd0310135  bun.lock
a6e73713b00658951639b55b26ced8c6aaa987b993edd74594065a7d80990db3  bun.lockb

$ cat .node-version ; node --version ; npm --version
22.22.2
v22.22.2                              # matches .node-version exactly
10.9.7
```

The worktree was created with `git worktree add --detach` in my own directory. No branch, no ref written anywhere, nothing pushed. The prior defect this section exists to prevent — a run reported at `a42b209e` that happened at `9ac4524d` — is addressed by the `rev-parse` above and by the post-run re-check in §1d, not by assertion.

## 1b · Install and run

```
$ npm ci --no-audit --no-fund
… 8 deprecation warnings … added 1012 packages in 20s
exit code: 0
$ git status --porcelain          # still 0 lines — the install did not touch the lockfile
$ sha256sum package-lock.json     # 2c19224a… unchanged
$ npx vitest --version            # vitest/3.2.4 linux-x64 node-v22.22.2

$ npx vitest run --reporter=verbose --reporter=json --outputFile.json=logs/vitest-run1.json
EXIT CODE: 0
 Test Files  178 passed | 1 skipped (179)
      Tests  2475 passed | 1 skipped (2476)
   Duration  148.93s
```

Per-test output: 2,967 transcript lines in `vitest-run1.txt`, one line per test, plus the machine-readable `vitest-run1.json` (867,566 B). The totals line above is a pointer to the transcript, not the evidence.

File inventory, measured: 179 files match the include glob `src/**/*.{test,spec}.{ts,tsx}` — 165 `.test.*` and 14 `.spec.*` — and vitest collected all 179.

## 1c · Every skip, enumerated — as-of 2026-08-31T05:56:22Z

Machine-read from the JSON report, not from the summary line:

```
assertion status counts: {'passed': 2475, 'skipped': 1}
numTotalTests 2476 · numPassedTests 2475 · numPendingTests 1 · numFailedTests 0 · numTodoTests 0
numTotalTestSuites 722 · numPendingTestSuites 0
```

**There is exactly one skip.**

| file | test | mechanism | reason |
|---|---|---|---|
| `src/test/judging-invariants.test.ts` | `Phase R3 — judging data invariants > judging_invariants_check returns all 'ok'` | `describe.skipIf(!canRun)` at line 22 | `canRun = Boolean(URL && SERVICE_KEY)` where `URL = VITE_SUPABASE_URL \|\| SUPABASE_URL` and `SERVICE_KEY = SUPABASE_SERVICE_ROLE_KEY \|\| SUPABASE_SERVICE_KEY`. Neither is present in this environment, so the whole `describe` is skipped. |

**Does "1 skipped" hide more than one test?** I checked rather than assumed: the file contains exactly one `it(`, so one skipped entry is one real test. In this case the count is honest. It would not be if that file ever gained a second case — a file-level `skipIf` reports as one skipped *suite*, and the summary line would not grow.

**What that skip costs.** The file's own header says a green result here *"guarantees a green production check"* because the nightly `judging-invariants-nightly` edge function calls the same `judging_invariants_check()` SQL function. **That guarantee was not obtained by this run.** As of 2026-08-31T06:05:48Z the judging data invariants are unverified by me, and a 2,475-pass result must not be read as covering them.

Source scan for every skip construct across all 179 files, as-of 05:56:22Z — the only two hits are the one above and `manifestMigrator.test.ts:279`, which is an assertion on a variable named `skip`, not a skip directive. **No `.only`, no `.todo`, no other `.skipIf`, no `.skip` — as-of 2026-08-31T05:56:22Z.** Three further test files read `process.env` (`laneIsolation`, `uiHarnessCannotShip`, `loggingStandard`); I read each — they set env inside tests deliberately and gate no skips.

## 1d · Proving the suite can fail — three planted defects

Planted into a **copy** (`wo13/lab`), verified byte-identical to the worktree before and after. The `a42b209e` worktree was never modified; `git status --porcelain` was 0 lines at 05:52:47Z and again at 06:05:48Z. Each defect got a **full-suite** run, not a targeted one.

### D1 — the lane defaulting rule · `scripts/lane-config.mjs` · 05:57:43Z

Made `laneValue` return the production default for an empty string instead of throwing — the exact behaviour the file's own header forbids (*"set to `""` → FAIL THE BUILD"*), and a plausible "simplification".

```diff
   if (value === "") {
-    throw new Error(`${name} is set but empty. …`);
+    return productionDefault;
   }
```

**Caught. EXIT CODE 1 · Tests 2 failed | 2473 passed | 1 skipped**

```
FAIL src/__tests__/laneIsolation.test.ts > the defaulting rule > REFUSES an empty string rather than emitting a hostless URL
AssertionError: expected [Function] to throw an error
 ❯ src/__tests__/laneIsolation.test.ts:114:34
    114|       expect(() => laneDefine()).toThrow(/empty/i);
FAIL src/__tests__/laneIsolation.test.ts > the defaulting rule > refuses an empty site origin too
AssertionError: expected [Function] to throw an error
```

### D2 — the icon-bundle regression pin · `src/components/Navbar.tsx` · 06:00:24Z

Reintroduced the namespace import the 2026-08-07 pin exists to prevent.

```diff
+import * as LucideIcons from "lucide-react";
```

**Caught. EXIT CODE 1 · Tests 1 failed | 2474 passed | 1 skipped**

```
FAIL src/components/__tests__/NavbarIconBundle.test.ts > never imports the lucide-react namespace
AssertionError: expected 'import { useState, useEffect, useRef …' not to match
  /import\s+\*\s+as\s+\w+\s+from\s+["']lucide-react["']/
```

### D3 — pure logic · `src/lib/translate.ts` · 06:03:02Z

Changed the minimum-text threshold in `detectScript` from 6 to 60 — a tuning typo, not a structural change.

```diff
-  if (total < 6) return null;
+  if (total < 60) return null;
```

**Caught. EXIT CODE 1 · Tests 2 failed | 2473 passed | 1 skipped**

```
FAIL src/lib/__tests__/translate.test.ts > latin post for Bengali reader -> needs translation
AssertionError: expected false to be true
FAIL src/lib/__tests__/translate.test.ts > bengali post for English reader -> needs translation
```

### Restore and clean re-run — 06:05:48Z

All three files back to baseline sha256 (`df1ea9c6…`, `97cd92fb…`, `0654984b…`); `diff -rq` reports the lab byte-identical to the `a42b209e` worktree; final full run **EXIT CODE 0 · 178 passed | 1 skipped (179) · 2475 passed | 1 skipped (2476)**.

---

## What this suite would NOT catch

Grounded in what I measured, not in general caution.

1. **The one thing it self-skips.** `judging_invariants_check()` is unverified — see §1c. The suite is green *and* that invariant is untested, simultaneously.
2. **Deployed reality.** The suite reads `supabase/functions/**` from the working tree; it has no view of what is deployed. My own earlier measurement (frozen 2026-08-30T16:22:20Z) found 50 of 71 production bundles differing from `a42b209e`, and 14 files whose deployed bytes exist in no commit. A green suite at `a42b209e` is compatible with all of that.
3. **Equivalent rewrites of a pinned pattern.** 135 of the 179 test files assert against **source text** via `readFileSync`; only 23 render a component. D2 proves the pin catches the literal spelling `import * as X from "lucide-react"`. It would not catch `const X = await import("lucide-react")`, which has the same bundle cost. These pins name one spelling of one past mistake.
4. **Anything needing a browser, a network or a database.** Environment is `jsdom`; `vitest.config.ts` pins synthetic lane values through `laneDefine()`. RLS policies, served CORS headers, real R2/S3 behaviour are all out of reach — which is precisely why WO-13 Task 2 must be measured against the live lanes and cannot be inferred from here.
5. **Anything outside the glob.** Workflow YAML, `.gitleaks.toml`, `cloudflare/`, migrations are covered only where a `src/` test happens to read them as text.
6. **Defect classes nobody has pinned.** This suite is a large, careful collection of regression pins. All three of my defects were caught by a pin written for that exact regression. That is strong evidence against recurrence of known defects and weak evidence about anything new.

---

## Row

| Requirement | Instrument | Evidence | Result | Status |
|---|---|---|---|---|
| §25.7.2 item 3 — test suite re-run **independently** | own clone, own worktree, own toolchain; `npm ci` + `vitest run` | §1a identity block; `vitest-run1.txt` (2,967 lines), `vitest-run1.json`; bundle `41ab806e…` | **2,475 passed · 1 skipped · 0 failed · exit 0** at `a42b209e` | **VERIFIED** — bound to `a42b209e`, re-run required if the replacement RC is adopted |
| Enumerate every skip | vitest JSON report + source scan | §1c | **exactly 1 skip**, named, with mechanism and reason; 1 skipped entry = 1 real test, checked | **VERIFIED** as-of 2026-08-31T05:56:22Z |
| `judging_invariants_check()` verified | — | the test self-skipped for want of a service-role client | **not verified** | **BLOCKED** as-of 2026-08-31T06:05:48Z — lacks `SUPABASE_SERVICE_ROLE_KEY`; I will not request one |
| Rule 1 applied to the suite | three planted defects, full-suite runs | §1d, logs `d1.txt` `d2.txt` `d3.txt` | **3 of 3 caught**, each by a named test, exit 1 each | **VERIFIED** |
| Restore | sha256 + `diff -rq` + clean re-run | §1d | baseline restored; **exit 0** | **VERIFIED** as-of 2026-08-31T06:05:48Z |
| Worktree unmodified throughout | `git status --porcelain` before and after | §1a, §1d | **0 lines** both times | **VERIFIED** |

**Stamped negatives.** No failing test — as-of 2026-08-31T05:56Z (first run) and 06:05:48Z (clean re-run). No `.only`, `.todo` or second skip construct anywhere in the 179 files — as-of 05:56:22Z. No modification to the `a42b209e` worktree — as-of 06:05:48Z. No branch, commit, push, tag, deploy or migration performed — as-of 06:09Z.
