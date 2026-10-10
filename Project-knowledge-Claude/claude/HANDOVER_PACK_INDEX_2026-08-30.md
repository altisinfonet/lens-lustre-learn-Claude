# HAND-OVER PACK — independent human auditor · 2026-08-30

## ⚠ Read this first

**§25.4 IS UNCHANGED BY EVERYTHING IN THIS PACK. NOT ONE §25 ROW IS CLOSED BY ANY OF IT.**

Every figure here is **compiler-generated**. Under §25.4 a compiler measurement cannot close a §25
row no matter how clean it is, and neither can the owner re-reading it — that is OWNER-ATTESTED, the
class those rows already carry. This pack exists so an **independent auditor** can re-run the
instruments and reach their own verdict. It is evidence offered for checking, not a claim of
completion.

**No provider mutation of any kind occurred. No commit, push, branch, PR, merge, tag, workflow
dispatch, deploy or migration.** Repository access was read-only: the clone's push URL was set to
`DISABLED_NO_PUSH_AUTHORITY` before any other command, all work was in detached checkouts and
worktrees, and `docs/PROMOTION_LEDGER.md` is unchanged — sha256
`f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943`, 182,502 bytes.

---

## Identity this pack is measured against

| Anchor | Value | Verified |
|---|---|---|
| `origin/main` | `b671e1fb0c5bcf145d442076c229eca888afd674` | 2026-08-30, live |
| `origin/staging` | `9ac4524d703035e6d2debd9e97ab9a0e73de3bc9` (REV-16) | 2026-08-30, live |
| Application/code RC | `a42b209e4f70a6efed4f3dcdb654e0f994416594` | last non-docs commit, confirmed |
| Prior baseline commit | `702e5ceb6d40b6f487cedf2378aae835bd18621f` | ancestor of `a42b209e` |
| Production project | `jtdtehuqtinjxropkkcn` | N = **71** functions, discovered not assumed |
| Staging project | `ztzutckwdhetphwghuzj` | N = **74** functions, discovered not assumed |
| Changed after the RC | `docs/PROMOTION_LEDGER.md` **only** — 10 commits (REV-7…REV-16), 0 merges | 2026-08-30 |

---

> **An empty archive was inside this pack, and is now removed.** Revision 4 manifested a file named
> `HANDOVER_PACK_2026-08-30_FINAL.tar.gz` **at 20 bytes** — a gzip stream containing nothing
> (`tar tzf` lists **zero** entries; an empty tar gzips to ~45 B). It carried a valid checksum,
> because **the checksum of nothing is valid**. Cause: a build command ran
> `tar -czf HANDOVER_…FINAL.tar.gz -C handover .` while the working directory was already the pack
> root; `tar` created the output file, then aborted on `-C handover` (no such directory), leaving the
> empty stream behind **inside** the pack, where the next manifest dutifully checksummed it.
> **Removed from the pack and from the manifest at revision 5.** The real archive is built **after**
> the manifest, **outside** the pack, and is **not** a member of it — a pack cannot contain a
> complete copy of itself, and a manifest entry proves integrity, never non-emptiness.
>
> **Provenance of `05_INSTRUMENTS/MANIFEST.sha256`.** It is now the **owner's published manifest**,
> 1,524 bytes, including its `# sizes (bytes), measured 2026-08-29T16:04:42Z` comment block — not a
> regenerated one. An earlier revision of this pack carried a 1,050-byte version I had written
> containing only the 12 hash lines; its 12 lines were byte-identical to the published file's, but
> the size-comment block was absent. **"12 of 12 verify" is therefore against the owner's manifest,
> verified in place.** `facts_rev16.json` appears **twice by design**: at
> `05_INSTRUMENTS/facts_rev16.json` so the published manifest verifies without modification, and at
> `04_REV17/facts_rev16.json.ORIGINAL` under its supersession notice. Both are byte-identical,
> sha256 `b343a7d1…`.
>
> **Scope of that manifest — do not apply its coverage clause to this folder.** It was written for a
> directory of exactly **12** files; `05_INSTRUMENTS/` holds **16**. Its **checksums verify in place,
> 12 of 12**, and that claim is correctly scoped — but its "every file and no others" **coverage**
> clause does **not** hold here, and is not meant to: `INSTALLATION_GATE_LG-05-DEF-1.md`,
> `LG-05-DEF-1_AND_CORRECTED_CLASSIFICATION.md` and `verify_recompute.py` are legitimate later
> additions, and the manifest self-excludes. **That is not a coverage failure.** Pack-wide coverage is
> the job of the pack-root `MANIFEST.sha256`, which covers all 83 including these. *A check applied in
> a context it was not written for is the third face of the rule above — after a suite that never
> planted the defect it is cited against, and a checker sharing its exclusion rule with the generator
> it checks.*
>
> **Pack manifest — a defect in my own packaging, found and fixed before shipping.** Revisions 1–3 of
> this pack's `MANIFEST.sha256` were generated with `find … ! -name MANIFEST.sha256`, which excluded
> **every** file of that name — including `01_WO1/MANIFEST.sha256` and
> `05_INSTRUMENTS/MANIFEST.sha256`. The coverage checker applied the **same** exclusion, so it
> reported PASS by agreeing with itself while two files sat outside the manifest entirely. This is
> the same defect class as the WS4 revision-7 `find -maxdepth 3` fault recorded in
> `14_REVISION7_HARNESS_REPAIR.md` §7.4. **Fixed at revision 4:** only the pack-root manifest is
> excluded, coverage is measured at **83 of 83** (rev5; the figure was also 83 at rev4 by coincidence — an empty tarball came out and `facts_rev16.json` went in) and was re-checked with an independent walker that excludes
> only `./MANIFEST.sha256`. A coverage check must not share its exclusion rule with the generator it
> checks.

## Pack layout

| Folder | Contents |
|---|---|
| `01_WO1/` | WO-1 evidence: first production/staging captures, blocked items, results template |
| `02_WO2/` | WO-2: harness verification, WS-HASH-v1 spec, per-lane hash manifests, lane delta, CORS census, F-16…F-26 responses, Row 2 / Row 6a evidence |
| `03_WO3/` | WO-3: full report, drift results at both RCs, drift harness, credential-scrub proof, 138-file `docs/` reference dump |
| `04_REV17/` | **The REV-17 correction set — PREPARED, NOT COMMITTED**, plus the superseded `facts_rev16.json` and its preserved original |
| `05_INSTRUMENTS/` | ledger-guard v3 (guard, both self-test suites, workflow, README, blocked items, fix evidence, MANIFEST) and the independent hash-recompute script. **⛔ The guard carries a known defect, LG-05-DEF-1 — read `INSTALLATION_GATE_LG-05-DEF-1.md` and `LG-05-DEF-1_AND_CORRECTED_CLASSIFICATION.md` before using or installing it.** The copy here is the unfixed v3, shipped defect-included and byte-identical to its MANIFEST |
| `06_RAW/` | Raw provider captures (71 production, 74 staging) and the WS4 harness pack, as tarballs |

---

## §25.3 INFRASTRUCTURE ROWS — what was measured, by which instrument, when

| Row | What was measured | Instrument | Date | Result | Class |
|---|---|---|---|---|---|
| **1.1** Production DB policy state | `ad_creative_comments` policies on `jtdtehuqtinjxropkkcn` | `mcp__Supabase__execute_sql`, read-only `pg_policies` | 2026-08-30 | **7** — the pre-D-10 expected value; §21 condition NOT triggered | compiler-measured |
| **1.2** Staging DB policy state (**Row 2**) | Same query on `ztzutckwdhetphwghuzj` | same | 2026-08-30 | **9** — expected. Negative control **re-run against the staging ref**: `zzz_does_not_exist` → 0 rows, **discriminating** | compiler-measured |
| — | Name-level cross-check | same | 2026-08-30 | The two staging-only policies **named**: `Ad comments follow the ad's visibility` (RESTRICTIVE/SELECT), `Banned users cannot comment on ads` (RESTRICTIVE/INSERT). Production-only: **none** | compiler-measured |
| — | Whole-schema extension | same | 2026-08-30 | Both lanes hold the same **139** tables; `ad_creative_comments` is the **only** table whose policy count differs. **Limit:** counts only — a same-count rename elsewhere is UNTESTED | compiler-measured |
| **1.3** Deployed edge-function state | `list_edge_functions` + `get_edge_function`, both lanes | Supabase MCP, read-only | 2026-08-30 | N=**71** production / **74** staging, both discovered. 71/71 and 74/74 captured, hashed, independently recomputed | compiler-measured |
| **1.4** R2 token policy / bucket scope | — | — | — | **BLOCKED** — Cloudflare token tooling not available to this session | **BLOCKED** |
| **1.5** GitHub `staging` Environment | — | — | — | **BLOCKED** — not measurable from a read-only clone; Environments are API state | **BLOCKED** |
| **1.6a** R2 bucket state (**Row 6a**) | Account bucket listing + per-bucket settings | Cloudflare MCP, read-only | 2026-08-30 | **PARTIAL.** Existence: exactly three — `50mm` (2026-03-07, APAC, Standard), `50mm-staging` (2026-08-21), `agentcrm` (enumerated only, never opened). Negative control: non-existent bucket → 404/10006, **discriminating**. **Sizes BLOCKED** on two independent grounds; Public-Access flag and account id **BLOCKED** | compiler-measured / BLOCKED split |
| **1.6b** `isolation-probe/` prefix | — | — | — | **BLOCKED** — object-listing tooling not available | **BLOCKED** |
| **1.6c** (per §25.3 set) | — | — | — | **BLOCKED** — same reason | **BLOCKED** |

---

## §25.7.2 ITEMS — the four workstreams

| Item | What was measured | Instrument | Date | Result |
|---|---|---|---|---|
| **WS1 — infrastructure rows** | see §25.3 table above | Supabase / Cloudflare MCP, read-only | 2026-08-30 | Rows 1.1, 1.2, 1.3 measured; 1.6a PARTIAL; **1.4, 1.5, 1.6b, 1.6c BLOCKED** |
| **WS2 — the 138-file review** | All **138** files read **in full** at `a42b209e` | `git worktree` checkout + `grep -n 'docs/'` over complete files, never diff hunks | 2026-08-30 | 31 A · 107 M · 0 D · 2 docs / 136 non-docs — **matches the ledger exactly**. **10** files reference `docs/` — the auditor's C-10 figure, **corroborated**; the compiler's earlier "four, all comments" is **false**. Executable consumer confirmed at `src/__tests__/candidatePatternWidening.test.ts:251-252` (`readFileSync` + `existsSync` assertion) |
| **WS3 — independent test run** | Full suite from the RC checkout | `npm ci` from committed lockfile, `vitest run` under `env -i` with printed credential-scrub proof | 2026-08-30 | **2,475 passed · 0 failed · 1 BLOCKED** across 179 files. BLOCKED test named: `src/test/judging-invariants.test.ts` — builds a **service-role client against the live database**; not run with real credentials |
| **WS4 — N-function re-measurement (B13 15a/15b)** | 71 production bundles vs repo at both RCs | `07_ws4_reference_impl.py classify`, hash-verified, after `10_verify_pack.sh` PASS=30 FAIL=0 and mutation control UNDETECTED=0 | 2026-08-30 | **15a SATISFIED.** **15b MEASURED** — see the drift table below |

### B13 15b — the drift measurement, both readings reported

| Comparison | MATCH | HEADER-ONLY | DRIFT | UNKNOWN | Σ |
|---|---|---|---|---|---|
| 2026-08-26 baseline (for reference) | 21 | 21 | 29 | 0 | 71 |
| vs `702e5ce` — **strict protocol as written** | 19 | 21 | 31 | 0 | 71 |
| vs `702e5ce` — **import-map excluded** | **21** | **21** | **29** | **0** | **71** |
| vs `a42b209e` — **strict protocol** | 19 | 22 | 30 | 0 | 71 |
| vs `a42b209e` — **import-map excluded** | 21 | 22 | 28 | 0 | 71 |

`classified + unknown = 71` on every reading. **UNKNOWN is 0 and nothing was folded into MATCH.**
The entire strict-vs-adjusted gap is two functions whose deployed bundle carries `deno.json` while
the RC-side closure does not emit it (`handle-email-suppression`, `handle-email-unsubscribe`) —
**tested by exclusion, not assumed**. §4.5 rule 2 says path-sets-differ → DRIFT; the 2026-08-26
baseline evidently excluded the import map. **Both numbers are reported; the auditor should rule on
which reading governs before either is cited.**

**DIRECTION = UNKNOWN** for every function. §4.6 permits it only on a digest match to an
attributable revision or deployment metadata naming a SHA; neither was established. `updated_at` is
non-probative and was not used. The 2026-08-26 "three functions in the opposite direction" finding
is **not carried forward**.

---

## FINDINGS — C-1 … C-4 and W3-1 … W3-4

| ID | Severity | Finding | Where |
|---|---|---|---|
| **C-1** | HIGH | **No single deployed source of truth for shared modules in production.** `s3.ts` 4 variants, `imageDims.ts` 4, `registry.ts` 2; in the first two **no two functions agree**. **Cause now DETERMINED (WO-3 step 6): the repo holds ONE copy of each — accumulated deployment drift, not per-function forks.** None of production's four `s3.ts` variants exists in the tree | `02_WO2/FINDINGS_F16-F20_RESPONSE.md`, sharpened in `04_REV17/…` C-14 |
| **C-2** | MEDIUM | The divergence is one-sided: staging shows **0 of 34** shared modules divergent against production's **3 of 34**, removing "the platform forces this" as an explanation. Cause of staging's uniformity UNDETERMINED (a bulk deploy is a plausible non-disciplinary cause) | `02_WO2/FINDINGS_F16-F20_RESPONSE.md` |
| **C-3** | HIGH | **B13's CORS residual risk describes a uniform population; the deployed population splits four ways** — 27 allowlist / **39 local wildcard `*`** / 2 external-specifier / 3 none | `02_WO2/FINDINGS_F21-F26_RESPONSE.md` |
| **C-4** | HIGH | **The split is in the source of truth too.** The frozen RC itself carries **38 wildcard functions**. Deploying `a42b209e` changes CORS for **exactly one** function (`submit-judge-decision`). **"Promotion fixes CORS" is false as a general claim** — it reaches 1 of 39 | `03_WO3/WO3_REPORT_2026-08-30.md`, ledger text in `04_REV17/…` C-15 |
| **W3-1** | — | Commit-count expectation 45/43 is `main…fe63e944` (REV-12), not `main…a42b209e` (39/37). **Self-corrected**: my original characterisation of §3.2(b) as a label defect was wrong — §3.2(b) carries a frozen endpoint label and is correct. The label defect is real only in §5.0 | `04_REV17/…` C-12 |
| **W3-2** | — | **CLOSED.** The ledger-guard pack published in the project was at one point incomplete against its own MANIFEST. It is now **complete: 12 of 12 verified**, both Linux transcripts included, re-verified by measurement 2026-08-30. My later claim that the two transcripts were unpublished was itself stale — see the correction notice below | this index |
| **LG-05-DEF-1** | HIGH (instrument) | **ledger-guard v3 misattributes a row's scope endpoint**, taking it from anywhere in the row **including the instrument cell**, and never consulting section headings. Against REV-16 this makes **3 of its 8 FAILs false positives**. The "zero false positives" claim is withdrawn by its author. **Fix SPECIFIED, NOT IMPLEMENTED — installation is gated on it** | `05_INSTRUMENTS/LG-05-DEF-1_AND_CORRECTED_CLASSIFICATION.md`, `05_INSTRUMENTS/INSTALLATION_GATE_LG-05-DEF-1.md` |
| **C-17** | — | `facts_rev16.json` records `commits: 45/43` for the **`main…a42b209e`** range where measured is **39/37**. Circular attestation: the fact source was transcribed from the document it audited. **Neither guard mode could detect it** — `--facts` because circular, `--repo` because no ledger row claims that figure. **Distinct from LG-05-DEF-1**, though both share one root cause: a figure moved between contexts without its endpoint travelling with it | `04_REV17/…` C-17, `04_REV17/FACTS_REV16_SUPERSEDED.md` |
| **W3-3** | — | The 2026-08-26 baseline is reproducible, but only under one reading of the classification protocol; the difference is whether a function's import map is part of its comparison set | `03_WO3/WO3_REPORT_2026-08-30.md` |
| **W3-4** | MEDIUM | A credential-gated live-database test **self-skips into a green summary**. `Tests 2475 passed \| 1 skipped` does not distinguish "not applicable" from "the one test touching production data did not run" | `03_WO3/`, ledger text in `04_REV17/…` C-16 |

---

## The REV-17 correction set — PREPARED, NOT COMMITTED

`04_REV17/REV17_CORRECTION_SET_PREPARED_NOT_COMMITTED.md`. Every prior value preserved and struck
through, never replaced. **The owner rules on whether to commit; the compiler has not applied it.**

- **C-12 (corrected)** — §5.0's counts are labelled `main…staging` and are stale; **§3.2 is sound**.
  ⚠ **WO-4's drafted premise was false** and is not written as issued: the ledger never recorded
  45/43 as `main…a42b209e`. Full endpoint series measured, REV-7…REV-16.
- **C-13** — B13 finding 1 is **no longer true of `send-gift-credit`** against the frozen RC (its
  RPC fix is *in* `a42b209e`); it **remains true of `analyze-gallery-image` and `detect-ai-image`**,
  whose per-function API-key chains exist in production and not in the RC.
- **C-14** — `s3.ts`: none of the four deployed variants is in the tree. Destructive-path functions
  named: **`purge-s3-orphans`** and **`detect-orphan-files`**. Sharpens B13 finding 2.
- **C-15** — "promotion fixes CORS" recorded as false.
- **C-16** — the 2,475 figure carries one unverified invariant. **Test NOT fixed** — that is code,
  and Track R is not started.
- **C-17 (new)** — `facts_rev16.json` recorded **45/43 for the `main…a42b209e` range** where the
  measured value is **39/37**. This is where WO-4's drafted C-12 error actually lives.

---

## Instrument provenance — nothing was executed before it hash-verified (F-11)

| Instrument | sha256 | Self-test |
|---|---|---|
| `ledger_guard.py` **⛔ carries LG-05-DEF-1, unfixed** | `a9629fcf2d18d0ce7a3a2567e4471d261f2f963b503d3dcb6629c08274b79a42` | `test_ledger_guard.sh` **66/66**, `test_ci_propagation.sh` **14/14** — note both suites pass **with** the defect present: no fixture covers endpoint attribution, which is why 66/66 did not catch it |
| `test_ledger_guard.sh` | `39e5bd950f9dd6884e25ef6e3a0e3a6e57593a5f9226ae94ac5e48f7b7560e91` | — |
| `test_ci_propagation.sh` | `429eaa172305309b1723cabcf0a8f38d74d381134a5c2ae473f70bcd0e00c289` | — |
| WS4 harness pack | 25/25 files verify against its MANIFEST | `10_verify_pack.sh` **PASS=30 FAIL=0**; `11_mutation_control.sh` **DETECTED=12 UNDETECTED=0 SKIPPED=0 EQUIVALENT=3 FALSE-EQUIV-CLAIMS=0 NO-OP-HERE=1** |

> **CORRECTED 2026-08-30.** An earlier revision of this index and of `RESUME_HERE.md` recorded the
> two Linux transcripts as unpublished, "searched exhaustively", and the pack as 10 of 12. **That
> was false when shipped** — both had been published to `claude/LEDGER_GUARD_V3_PACK/` at
> 2026-08-30T08:05:5xZ, before WO-5, and I carried forward a stale WO-4 finding instead of
> re-checking. **The pack is 12 of 12, re-verified by measurement:** `TRANSCRIPT_ci_linux.txt`
> `440b4bcd…`/1,131 B and `TRANSCRIPT_selftest_linux.txt` `df35fd74…`/5,040 B, both matching the v3
> MANIFEST. Both are now in `05_INSTRUMENTS/`. This is a C-9-class staleness defect in my own
> record, disclosed rather than quietly fixed.

**Ledger-guard live run, 2026-08-30, complete pack:** `FATAL=0 FAIL=8 WARN=1 INFO=4`, exit 1 —
unchanged from the earlier run with the partial pack. Every finding tagged **`[MEASURED]`**; none
rests on `facts_rev16.json`.

### ⛔ THE 8 FAILs ARE **5 REAL + 3 FALSE POSITIVES**. THE GUARD IS DEFECTIVE (LG-05-DEF-1).

**Do not read the raw guard output as eight defects.** It is not. The "zero false positives" claim
in `05_INSTRUMENTS/REV16_FINDING_CLASSIFICATION_V3.md` is **WITHDRAWN by its author**. Full
analysis: `05_INSTRUMENTS/LG-05-DEF-1_AND_CORRECTED_CLASSIFICATION.md`; installation gate:
`05_INSTRUMENTS/INSTALLATION_GATE_LG-05-DEF-1.md`.

| # | Line | Finding | **Class** | Why |
|---|---|---|---|---|
| 1 | 120 | claims 43 commits for `main…staging` | **FALSE POSITIVE** | row is `main…fe63e944`, where 43 is correct |
| 2 | 120 | claims 45 commits for `main…staging` | **FALSE POSITIVE** | same row, 45 correct for `fe63e944` |
| 3 | 122 | claims +9,494/−1,293 for `main…staging` | **FALSE POSITIVE** | same row, correct for `fe63e944` |
| 4 | 426 | claims +9,680/−1,293 for `main…staging` | **REAL** | §5.0's row carries the `main…staging` label itself |
| 5 | 428 | claims 44 commits for `main…staging` | **REAL** | same |
| 6 | 428 | claims 46 commits for `main…staging` | **REAL** | same |
| 7 | 46 | `§16.4` does not resolve | **REAL** | unchanged |
| 8 | 790 | `§8.6` does not resolve | **REAL** | unchanged |

> **The two rules this engagement produced, recorded together because the second completes the first.**
>
> 1. **The D+ rule.** A suite that has not been shown to detect a planted defect is not evidence
>    about that defect class. ledger-guard's 66 assertions pass **with LG-05-DEF-1 present**, because
>    no fixture ever covered endpoint attribution.
> 2. **A check that shares its exclusion rule with the thing it checks is not a check.** This pack's
>    own manifest coverage passed across three revisions by agreeing with itself; the WS4 verifier hit
>    the identical fault at revision 7 with `find -maxdepth 3`. The fix in both cases is the same:
>    the checker must be built independently of the generator, sharing no rule with it.
> 3. **A check applied in a context it was not written for is not a check either.** The ledger-guard
>    manifest verifies 12 of 12 in `05_INSTRUMENTS/`, but its coverage clause was written for a
>    12-file directory and that folder now holds 16. Reading a passing checksum set as a coverage
>    verdict would manufacture a failure that does not exist — the mirror of LG-05-DEF-1, where a rule
>    applied outside its declared scope manufactured three findings that did not exist.
>
> All three faults were found in instruments written to enforce evidence discipline, which is the
> point. Scope is not a footnote on a check; it is part of what the check asserts.

**The defect (LG-05-DEF-1).** LG-05 takes a row's scope endpoint from **anywhere in the row,
including the instrument cell**. §3.2(b)'s commit row cites `compare/main...staging.patch` as *how it
was measured*; the guard normalises `...` to `…`, matches `main…staging`, and judges a correctly
labelled **`main…fe63e944`** row against an endpoint it never claimed. Section headings — where §3.2
actually declares its endpoints, and where a human reader looks — are never consulted. And
`main…fe63e944` was absent from the fact source, so the correct label could not have won even if they
were. **A row is attributed by how it was measured, not by what it measures.**

**Corroborating instrument, independent of the guard.** Measured directly from the live repository,
2026-08-30, `git rev-list --count b671e1fb..fe63e944` and `git diff --numstat b671e1fb...fe63e944`:

> **`main..fe63e944` = 45 / 43 commits, +9,494 / −1,293 lines.**

Those are exactly the figures §3.2(b) records, under exactly the endpoint §3.2(b) names. Findings
1–3 are false on this measurement, not on argument. The full REV-7…REV-16 endpoint series is in
`04_REV17/…` C-12.

**Consequence for this pack:** the guard's raw output is included as evidence, not as a verdict.
**An auditor re-running `ledger_guard.py --repo` today will see 8 FAILs and should expect to** —
five are real, three are the instrument's fault, and the fix is specified but **not implemented**.

---

## STILL BLOCKED — nothing here is closed, and these are not closable by more compiler work

| Item | Blocked on | Who can close it |
|---|---|---|
| **The Track R sixteen defects** | The list itself was never supplied and is in neither the project nor this session | **Owner** — paste the sixteen items. Repo access to test them is now in place |
| **§25.3 rows 1.4, 1.6b, 1.6c** | Cloudflare token/object-listing tooling not available to this session | Owner or auditor with Cloudflare console access |
| **§25.3 row 1.5** | GitHub Environments are API state, not repository content | Owner or auditor with repo settings access |
| **M8c on Windows** | `11_mutation_control.sh` returns **`NO-OP-HERE=1`** on Linux — **M8c has still never executed anywhere it is a defect. BLOCKED, NOT COVERAGE** | Anyone with a Windows host: run both suites in Git Bash |
| **B4 — symlink resolution** | `realpath` vs `abspath` in `norm()`/`closure()` — untestable on every platform by construction | Unresolved by design; needs a different instrument |
| **Windows figures in `BLOCKED_ITEMS_revision6.md` (B3)** | Remain **AUDITOR-ATTESTED** from an earlier round; **not witnessed by this session** | Independent auditor re-running on Windows |
| **PR #104 description currency** | PR body is GitHub API state, not repository content; unreadable from a read-only clone | Owner — check the PR UI |
| **LG-05-DEF-1 fix** | Specified in `05_INSTRUMENTS/INSTALLATION_GATE_LG-05-DEF-1.md`; **not implemented**. ledger-guard **must not be installed** until it is fixed and the §3.2(b)-shape fixture passes | Whoever installs the guard (post-tag PR B1) |
| **Every §25 row** | **§25.4.** Compiler measurement cannot close a row, and neither can the owner re-reading it | **Independent auditor only** |

**Track R is NOT STARTED.** Nothing in this pack repairs anything.

---

## To re-run any of this

```
# ledger-guard, live
python3 05_INSTRUMENTS/ledger_guard.py --repo <checkout> --ledger docs/PROMOTION_LEDGER.md --base origin/main

# drift, either RC
python3 03_WO3/WO3_drift_harness.py <rc-worktree> <label>

# independent recompute of every function hash
python3 05_INSTRUMENTS/verify_recompute.py
```

**Nothing in this pack closes a §25 row.**
