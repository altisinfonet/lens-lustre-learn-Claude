# ROUND-5 RESULTS TEMPLATE — return this filled in

**Added at the round-5 review of this pack.** The first version was instructions with nowhere to put
the answers, which invites free-form prose and lets an unanswered check disappear. **A blank cell
here is `BLOCKED`. Silence is never a pass.**

Copy this file, fill it, hash it, return it with the exports.

## R.0 · Run header

| Field | Value |
|---|---|
| Auditor identity (name / org) | |
| **Generator** of each export (role, §0.5) | |
| **Custodian**, if different | |
| **Verifier** of hashes, if different | |
| Access granted under D-13 on (UTC) | |
| Accounts/roles used (no credentials) | |
| RC under audit | `a42b209e4f70a6efed4f3dcdb654e0f994416594` |
| Ledger revision this pack targets | REV-16 |
| Pack `MANIFEST.sha256` the auditor received | |

## R.1 · Workstream 1 — the eight §25.3 rows

| Row | Requirement met? | Identity ctrl (project ref / account id) | Completeness ctrl | Negative ctrl — **stated discriminating result?** | Result | Class | Export SHA-256 |
|---|---|---|---|---|---|---|---|
| 1.1 production DB policies | | | | | | | |
| 1.2 staging DB policies | | | | | | | |
| 1.3 deployed edge functions (`N`=____) | | | | | | | |
| 1.4 R2 token policy / scope | | | | | | | |
| 1.5 GitHub `staging` Environment | | | | | | | |
| 1.6a R2 bucket state | | | | | | | |
| 1.6b `isolation-probe/` prefix | | | | | | | |
| 1.6c Zero Trust posture | | | | | | | |

> **A row whose negative control did not produce its stated discriminating result is `BLOCKED`**,
> whatever the positive result said. A control that errored or timed out did **not** run (§0.7).

## R.2 · Workstream 2 — 138-file review

| Group | Files | Reviewed | Findings | Unresolved questions | Reviewer | UTC |
|---|---|---|---|---|---|---|
| edge-functions | 44 | | | | | |
| application | 37 | | | | | |
| tests | 21 | | | | | |
| configuration | 19 | | | | | |
| workflows | 8 | | | | | |
| migrations | 7 | | | | | |
| documentation | 2 | | | | | |
| **TOTAL** | **138** | | | | | |

**Reviewed must equal 138 for the workstream to be complete.** Findings: file, line, description,
severity.

## R.3 · Workstream 3 — independent test run

| Field | Value |
|---|---|
| `git rev-parse HEAD` | |
| Node / npm versions | |
| `package-lock.json` SHA-256 | |
| `bun.lockb` SHA-256 (recorded, unused) | |
| Install / test commands | `npm ci` / |
| Passed / failed / skipped / files | |
| Typecheck result | |
| Artifact `ws3-vitest.json` SHA-256 · bytes | |
| **Negative control — discriminating result:** did `SummaryTriggerTapTarget.test.ts` report **FAILED** after deleting the `h-12` token? | **YES / NO** |
| Failure message recorded | |
| Non-zero exit was caused by a **named failing test**, not a command/install error | **YES / NO** |
| Disposable clone deleted? | |
| Remote unchanged? (`origin/main`, `origin/staging`, tags, branch count) | |
| Class | |

> **If the negative control did not fail, workstream 3 is `BLOCKED`.**

## R.4 · Workstream 4 — function inventory

### R.4.0 · Harness integrity — run before any provider call

**A blank cell is `BLOCKED`.** `11_mutation_control.sh` reporting `UNDETECTED` above 0 means the
test suite does not discriminate and **no WS4 result derived from it may be relied on**.
`NO-OP-HERE` above 0 means a mutation is not a defect on your platform and remains **BLOCKED**
until it is re-run on the other one — it is not coverage.


| Field | Value |
|---|---|
| `supabase --version` · `jq --version` | |
| Flags confirmed from `--help`, or substitutions made | |
| Smoke test (§4.8) passed on which function | |
| `bash 10_verify_pack.sh` (expect **`PASS=30 FAIL=0`**) — run this FIRST | |
| `bash 08_selftest.sh` (expect **`PASS=56 FAIL=0`**) | |
| `bash 09_rc_regression.sh` — fixture mode (expect **`PASS=8 FAIL=0`**, transcript reads `mode : fixture`) | |
| `bash 11_mutation_control.sh` — **DETECTED** | |
| … **UNDETECTED** (any value above 0 is a REAL FINDING about the tests) | |
| … **SKIPPED** · **EQUIVALENT** · **FALSE-EQUIV-CLAIMS** · **NO-OP-HERE** | |
| … platform class the run reported (`posix` / `windows`) | |
| `bash 12_rc_root_mode_test.sh` (expect **`PASS=12 FAIL=0`**) | |
| `bash 15_fixture_gate_test.sh` (expect **`PASS=30 FAIL=0`**) | |
| `bash 13_make_rc_fixtures.sh --rc-root <a42b209e checkout> --out fixtures/rc-exact` — exit code | |
| … provenance `git HEAD` recorded | |
| … provenance line `identity      : MATCH` present? | |
| `bash 09_rc_regression.sh --rc-root fixtures/rc-exact` (expect **`PASS=8 FAIL=0`**, transcript reads **`mode : real-checkout`**) | |
| Full-run `$RUN` directory name | |
| Smoke-run `$RUN` directory name (must differ) | |
| Closure exit 3 (unresolved imports) for which functions → `UNKNOWN` | |
| **`N` discovered** | |
| How `N` was counted (`jq 'length'` on the parsed array) | |
| `N = 71`? If not, functions added / removed vs the ledger list | |
| MATCH | |
| HEADER-ONLY | |
| DRIFT | |
| UNKNOWN (with reasons) | |
| **Sum — must equal `N`** | |
| **Inventory digest** (SHA-256 of `inventory.txt`) | |
| Excluded paths beyond `supabase/.temp/**`, `.DS_Store` — and why | |
| `inventory.txt` bytes · generated UTC · generated by | |
| **`PRODUCTION-NEWER` functions — NAMED** | |
| B13 risk 1 — `secureHeaders` md5 still `58b9f45d…`? wildcard present? | |
| B13 risk 2 — `submit-judge-decision` version · ACAO value **today** | |
| B13 risk 3 — all ten storage-lane functions confirmed? | |
| B13 risk 4 — the eight lane-config drift functions, named | |

**Per-drift table** — one row per DRIFT function: function · deployed version · **deployed-source
snapshot digest** · RC digest · what differs · **direction** (`RC-NEWER` / `PRODUCTION-NEWER` /
`DIVERGED` / **`UNKNOWN`**) · **the binding that established direction — ONE of: (1) digest match to
an attributable commit, or (2) deployment metadata naming the revision** · disposition · reviewer · UTC.

> ⚠ **`updated_at` versus a commit date is NOT acceptable evidence of direction** (§4.6). A timestamp
> does not bind deployed content to a revision. It may be recorded as context, labelled
> non-probative. **Absent binding (1) or (2), direction is `UNKNOWN`.**

> **`UNKNOWN` is the correct entry whenever chronology could not be established** (§4.6). Do not
> infer direction from a two-way diff. Count of `UNKNOWN` directions: ______

## R.5 · Overall

| Workstream | Complete? | If not, what is missing |
|---|---|---|
| 1 — infrastructure | | |
| 2 — 138-file review | | |
| 3 — independent tests + negative control | | |
| 4 — function inventory + per-drift review | | |

**§25 closes only when all four are complete (§0.9).** Otherwise §25 stays **PARTIAL** and ledger
blocker 9 stays open.

**Nothing in this workstream authorises a merge, tag, deploy, migration or production write.**

## R.6 · Probe residue (only when the runbook §5.3 probe is eventually run)

| Field | Value |
|---|---|
| Owner authorisation for permanent deployment-history change | |
| Pre-run deployment counts (staging / production) | |
| Post-run deployment counts | |
| **Deployment ids created** | |
| **Prior deployments whose status changed** (e.g. active → inactive) | |
| Workflow run id / job ids retained | |
| Secret-name diffs — staging / production / repo / **organization** — all empty? | |
| `total_count` reconciled for all four secret lists? | |
| Branch deleted and absent from `ls-remote`? | |
| Honest residue statement recorded in ledger §21 | |
