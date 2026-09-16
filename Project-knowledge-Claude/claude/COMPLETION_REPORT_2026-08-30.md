# COMPLETION REPORT — 50mm staging → main promotion
### 2026-08-30 · auditor session · **nothing here closes a §25 row (§25.4)**

**Evidence class is stated on every row.**

- **VERIFIED** — I opened the artefact myself and read the figure in it.
- **RELAYED** — reported to me by the executing session or the independent auditor. Not seen by me.

I do **not** hold the hand-over pack. Where a pack file is named, it is named as *the source the
executing session cites*, not as a file I have opened — except where the same document also exists
in the project and I read it there.

| | |
|---|---|
| **Release complete** | **~20%** |
| **Evidence work complete** | **~90%** |
| Ledger | `docs/PROMOTION_LEDGER.md` REV-16, frozen, sha256 `f00f612a…5943`, unchanged — **VERIFIED** |
| `main` | `b671e1fb0c5bcf145d442076c229eca888afd674`, unchanged — **VERIFIED** |
| Code RC | `a42b209e4f70a6efed4f3dcdb654e0f994416594` — **VERIFIED** |
| Pack | rev6 · 83 files · archive `1378f5da…f716` · 1,188,069 B — **RELAYED** |

### The percentage arithmetic

**Release = 9 gates**: §25.7.2 items 1–4 · §25 closure · §5.3 probe · §11 signature · tag · merge.
Items 2, 3, 4 executed but unvalidated = ½ each (1.5). Item 1 quarter-executed (0.25). Gates 5–9
untouched. **1.75 / 9 ≈ 20%.**

**Evidence = what is producible without the auditor or owner.** Four workstreams executed, four
infrastructure rows blocked on tooling, pack assembled. **≈ 90%.**

**If the RC is replaced: release ≈ 5%, evidence ≈ 40%.**

---

## ✅ DONE

| Work | Result | Class | Source |
|---|---|---|---|
| Identity — three commit anchors | `main`, staging head, last non-docs commit — all **MATCH** | **VERIFIED** | WO-3 report, step 1, read in project |
| Files changed | **138** — 31 added · 107 modified · 0 deleted · 2 docs / 136 non-docs | **VERIFIED** | WO-3 step 4 |
| Lines changed | **+9,060 / −1,293** for `main…a42b209e` | **VERIFIED** | WO-3 step 1 |
| Commits | **39 with merges · 37 without**, for `main…a42b209e` only | **VERIFIED** | WO-3 step 1 |
| *(34 first-parent)* | Stated by the independent auditor. **Not in the WO-3 report** | **RELAYED** | auditor message |
| Only `docs/` changed after the RC | 10 commits, all `docs/PROMOTION_LEDGER.md`, zero merges | **VERIFIED** | WO-3 step 1 |
| 138 files read in full | **10** reference `docs/`; executable consumer confirmed at `candidatePatternWidening.test.ts:251-252`. **C-10 corroborated — the auditor's figure was right, mine was wrong** | **VERIFIED** | WO-3 step 4 |
| Test suite | 179 files · 2,476 tests · **2,475 passed · 0 failed · 1 BLOCKED** · 0 otherwise skipped. Credential scrub proven first | **VERIFIED** | WO-3 step 5 |
| Guard, live repo | `FATAL=0 FAIL=8 WARN=1 INFO=4`, all `[MEASURED]`. Self-tests 66/66 and 14/14 first | **VERIFIED** | WO-3 step 2 |
| Drift vs 2026-08-26 baseline | strict **19/21/31**; import-map-excluded **21/21/29** — reproduces the baseline | **VERIFIED** | WO-3 step 3(a) |
| Drift vs the frozen RC (B13 15b) | strict **19/22/30**; adjusted **21/22/28**; UNKNOWN=0; Σ=71 | **VERIFIED** | WO-3 step 3(b) |
| Repo holds one copy of each shared module | 5 modules, 1 copy each. **C-1's cause DETERMINED: drift, not forks** | **VERIFIED** | WO-3 step 6 |
| CORS census, both sides | live 27/39/2/3 · RC 28/38/2/3 · 70 of 71 agree | **VERIFIED** | WO-3 step 7 |
| 71 + 74 functions captured and hashed | 71/71 and 74/74, provenance 71/71 | **RELAYED** | WO-2 items 1–4 |
| Infrastructure rows 1, 2, 3, 6a | Measured with identity, completeness and negative controls | **VERIFIED** | WO-1 results template, read in project |
| Pack assembled | 83 files · 83/83 checksums · independent walker · nested archives 57/123/75/35, none empty | **RELAYED** | manifest text + attestation |
| Guard instrument hashes | `ledger_guard.py` `a9629fcf…`, both suites, both transcripts — **byte-identical to what I built** | **VERIFIED** | my own manifest |

**Safety, whole engagement:** no commit, push, branch, tag, merge, deployment, migration or provider
write. Push URL disabled before any other command — **VERIFIED**, WO-3 access discipline.

---

## ❌ NOT DONE — and the exact reason

| Not done | Reason | Who closes it |
|---|---|---|
| **§25 rows — none closed** | **§25.4.** Compiler or owner measurement is OWNER-ATTESTED and cannot close a row | Independent human auditor |
| **Rows 1.4, 1.5, 1.6b, 1.6c** | **No instrument in the session** — Cloudflare MCP has no token-scope, object-listing or Zero Trust tool; GitHub Environment settings need access not granted | Owner or auditor, from the consoles |
| **§5.3 probe** | Owner-only; must run immediately before promotion or it is stale | Owner |
| **§11 · tag · merge** | Gated on all of the above | Owner, after the auditor |
| **Track R — the 16 defects** | **The list reached no session.** Not in the project, not in context | Owner, by forwarding it |
| **REV-17 corrections** | Prepared, not applied. §28 permits committing a material fact; the owner rules | Owner |
| **B13 15c — "three functions in the opposite direction"** | **DIRECTION could not be established per function.** §4.6 permits it only on a digest match or deployment metadata naming a SHA; neither existed. `updated_at` is non-probative. **The 2026-08-26 three-function finding is NOT carried forward** | Auditor, with a stronger instrument |
| **Import-map protocol ambiguity (W3-3)** | The protocol and the 2026-08-26 baseline disagree on whether a function's import map is in the comparison set. **Both figures reported; neither should be cited until ruled** | Owner or auditor, by ruling |
| **Windows M8c** | Never executed where it is a defect. **BLOCKED, not coverage** | Auditor, on Windows |
| **Symlink test (B4)** | Untestable by construction | Nobody, with this instrument |
| **LG-05-DEF-1 fix** | Deliberately unfixed; guard ships external. Must be fixed before install | Whoever installs the guard |
| **Durable copy of the pack** | Ephemeral container + chat cards only. Project cannot hold it — 766,858 B free vs 1,188,069 — **VERIFIED** | **Owner, by downloading it** |

---

## ⚠ THREE FINDINGS TRUE TODAY — independent of the merge

| # | Finding | Severity | Class |
|---|---|---|---|
| C-1 / C-14 | **`s3.ts`: four deployed variants; none matches the repo's single 15,400-byte copy.** `purge-s3-orphans` and `detect-orphan-files` — both destructive-path — run storage code in no commit anywhere | **HIGH** | **VERIFIED** (WO-3 step 6) |
| C-4 / C-15 | **The frozen RC itself carries 38 wildcard-CORS functions.** Promotion changes exactly one. "Promotion fixes CORS" reaches 1 of 39 | **HIGH** | **VERIFIED** (WO-3 step 7) |
| C-16 / W3-4 | **`judging-invariants.test.ts` self-skips into a green summary** while requiring a live service-role client | **MEDIUM** | **VERIFIED** (WO-3 step 5) |

**None blocks the merge** — B13 condition 2 excludes all function deployment from this release.

---

## 🔴 SIX OWNER ACTIONS — nothing moves without them

1. **Download and store the pack.** `1378f5da5917fe1cf252616b51f38e4579009d816670dd211bb5f718fdb8f716`, 1,188,069 bytes. Record the hash **in full**. Not R2 — that is a provider write.
2. **Forward the Track R sixteen**, with author and per-item evidence class.
3. **Send the pack to the independent auditor.** Nothing closes until they report.
4. **Decide whether `a42b209e` is replaced.** Upstream of everything else.
5. **Rule on the import-map ambiguity (W3-3)** — is a function's import map part of its comparison set? Until ruled, neither drift figure should be cited.
6. **Note that B13 15c's premise is unestablished** — the "three in the opposite direction" finding is not carried forward, so 15c cannot be satisfied as written.

---

## Four rules this engagement produced

1. A suite never shown to detect a planted defect is not evidence about that class.
2. A check sharing its exclusion rule with the thing it checks is not a check.
3. An abbreviated hash is not a hash.
4. **Parent of the other three:** a correct general rule, misapplied where its precondition fails.
   **Compression is where scope falls off** — every error in this engagement was in a shortened
   restatement, never in a measured full form.
