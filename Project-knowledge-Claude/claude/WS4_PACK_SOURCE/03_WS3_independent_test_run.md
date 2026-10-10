# WORKSTREAM 3 — INDEPENDENT TEST-SUITE EXECUTION

> **Execution provenance: `SPECIFIED, NOT EXECUTED` (§0.11).** Confirm commands before relying on them.

**Status: NOT DONE by any party.** The compiler cannot run it — no repository clone and no execution
environment for this project. Ledger figures ("2,464 tests", "2,475 tests") are **prior-report
INFERRED**, not independently re-derived.

## 3.1 · Fixed inputs — verified read-only by the compiler, 2026-08-29T12:05Z

| Field | Value | Source |
|---|---|---|
| **Checkout SHA** | `a42b209e4f70a6efed4f3dcdb654e0f994416594` — the frozen application/code RC | ledger §3.1 |
| Node engine required | **`>=22.12.0`** | `package.json` → `engines.node`, read at `staging` |
| Package manager pin | **none declared** (`packageManager` absent) | same |
| **Lockfiles present** | **BOTH `package-lock.json` and `bun.lockb`** exist in the tree | round-5 review |
| **Lockfile to use** | **`package-lock.json`** — chosen explicitly, because the procedure uses **`npm ci`**, which reads only that file. `bun.lockb` is **recorded but not used**; if the two ever disagree the run is still reproducible from the one named here | round-5 review |
| Test command | **`npm test`** → `vitest run` | `package.json` → `scripts.test` |
| Typecheck | `npm run typecheck` | `scripts` |
| Related gates | `npm run gate`, `npm run verify:isolation`, `npm run test:isolation-guard`, `npm run ui:gate` | `scripts` |

> **Check out `a42b209e`, not `staging`.** Later commits touch only `docs/PROMOTION_LEDGER.md`, so
> the tree is the same — but pinning the RC makes the run reproducible and is what §3.1 names.

## 3.2 · Procedure

```bash
git clone <repo> rc-audit && cd rc-audit
git checkout a42b209e4f70a6efed4f3dcdb654e0f994416594
git rev-parse HEAD                 # must echo a42b209e4f70a6efed4f3dcdb654e0f994416594

node --version && npm --version    # record both verbatim
ls -l package-lock.json bun.lockb  # BOTH exist — record both sizes
sha256sum package-lock.json        # <-- the frozen-RC lockfile hash used by npm ci; RECORD IT
sha256sum bun.lockb                # record for completeness; NOT used by this run

npm ci                             # clean install from package-lock.json — NOT `npm install`
npm test -- --reporter=json --outputFile=../ws3-vitest.json
npm run typecheck 2>&1 | tee ../ws3-typecheck.log
```

**`npm ci`, never `npm install`.** `npm install` may resolve different versions and silently
invalidates the lockfile hash you just recorded.

## 3.2a · PREFLIGHT — do this BEFORE the full suite (added at revision 4)

**Purpose: separate "the code is wrong" from "my command line is wrong" before a 2,000-test run.**

```bash
# P1 — does the reporter syntax this pack prescribes actually work at this vitest version?
npx vitest run --reporter=json --outputFile=../preflight.json     src/components/__tests__/SummaryTriggerTapTarget.test.ts
test -s ../preflight.json || echo "REPORTER/OUTPUTFILE SYNTAX WRONG — fix before proceeding"

# P2 — the named test must PASS on the unmodified RC
#      (if it fails here, the checkout or install is wrong, not the code)
```

| Step | Requirement | If not |
|---|---|---|
| **P1** reporter + `--outputFile` produce a non-empty JSON file | syntax confirmed at this vitest version | **BLOCKED** — fix the invocation; do not run the suite |
| **P2** `SummaryTriggerTapTarget.test.ts` **PASSES** unmodified at `a42b209e` | the baseline is sound | **BLOCKED** — wrong checkout, bad install, or a real regression. Investigate before anything else |
| **P3** apply the exact mutation of §3.5 (delete the `h-12` token) | — | — |
| **P4** re-run **that named test only**; it must report **FAILED**, naming that test | the control bites | if it still passes, the test does not test the fix → workstream 3 is **BLOCKED** |
| **P5** restore, re-run that test; it must **PASS** again | the mutation was the cause | if not, the working copy is dirty — start from a clean clone |

**Record for each of P1–P5: the command, the exit status, and the named test result.**

> **Three different non-zero exits mean three different things** — and the first version of this
> pack conflated them:
>
> | Non-zero exit because… | Verdict |
> |---|---|
> | a **named test failed** (P4) | ✅ the discriminating result |
> | the **reporter/config** was wrong, `npm ci` failed, the file was not found | ⚠ **BLOCKED** — nothing was tested |
> | the suite crashed / timed out | ⚠ **BLOCKED** |

## 3.3 · Report — every field required

| Field | Value |
|---|---|
| Checkout SHA (as echoed by `git rev-parse HEAD`) | |
| Node version | |
| npm version | |
| Lockfiles present | `package-lock.json`, `bun.lockb` (both) |
| **Lockfile USED** | `package-lock.json` (required by `npm ci`) |
| **`package-lock.json` SHA-256 at `a42b209e`** | |
| `bun.lockb` SHA-256 (recorded, unused) | |
| Clean-install command | `npm ci` |
| Test command | |
| **Tests passed** | |
| **Tests failed** | |
| **Tests skipped** | |
| **Test files** | |
| Wall-clock duration | |
| Typecheck result | |
| Preflight P1 (reporter syntax) | |
| Preflight P2 (named test PASSES unmodified) | |
| Preflight P4 (named test FAILS mutated) | |
| Preflight P5 (named test PASSES restored) | |
| Machine-readable artifact | `ws3-vitest.json` — record its **SHA-256 and byte size** |
| Generated by | auditor / owner / other |
| Timestamp UTC | |
| Class | |

## 3.4 · Completeness control (§0.6)

**A green run that executed nothing is the failure mode this project has already hit.** So:

- Record **test files** as well as test count. A collection-pattern error yields "0 failed" honestly.
- Compare the total against the ledger's prior figure (**~2,475**). **A materially lower count is a
  finding**, not a pass.
- Confirm the JSON artifact lists **every** suite; a truncated reporter output is not a result.

## 3.5 · Negative control (§0.7) — mandatory

**Prove the suite can fail.** In a **disposable clone** — a second, throwaway working copy, **not**
the one used for the reported run, and with **no push-capable remote**:

1. **The exact mutation:** in `src/components/ReactionSummaryTooltip.tsx`, in the trigger's
   `className`, **delete the `h-12` token** — leaving
   `"cursor-pointer inline-flex items-center justify-center px-2.5 touch-manipulation"`.
   Change nothing else. This is the single token the AF-15 fix added.
2. Re-run `npm test`.
3. **`SummaryTriggerTapTarget.test.ts` must FAIL.**
4. **Delete the whole disposable clone:**
   ```bash
   cd .. && rm -rf rc-audit-scratch
   ```
   > **Corrected after round-5 review.** The earlier instruction was `git checkout -- .`, which
   > restores tracked files but **leaves untracked artifacts** — `node_modules/`, coverage output,
   > the JSON reporter file, editor leftovers. Deleting the clone is the only reliable cleanup.
5. **Verify nothing reached the remote.** From a *different* checkout:
   ```bash
   git fetch --all --prune
   git rev-parse origin/main origin/staging   # must equal the values recorded at the start
   git ls-remote --tags origin                # must still be empty
   git ls-remote --heads origin | wc -l       # must equal the count recorded at the start
   ```
   Record all four outputs. **The scratch clone must never have a remote it can push to** — clone it
   from a local mirror, or `git remote remove origin` immediately after cloning.

**If step 3 passes, the suite is not testing what it claims and workstream 3 is `BLOCKED`, not a
pass.** Record the control's outcome alongside the main result — a run reported without its control
is INFERRED.

## 3.6 · Boundaries

- **Read-only.** No `.env`, no real credentials. Vitest runs against the repo, not a live lane.
- **Do not run `ui:gate` against a live site** without confirming it targets a local harness.
- If any step needs a secret, **stop and record `BLOCKED`** rather than supplying one (§0.3).
