# STAGING → MAIN PROMOTION LEDGER — MASTER

> **THIS IS THE CANONICAL LEDGER.** One file, updated in place, never superseded by a dated copy.
> Every prior dated `*_LEDGER_*.md` / `*_EVIDENCE_*.md` in `claude/` is an **input**, not an authority.
> Where a prior document conflicts with this one, **this one governs** and §14 records the correction.

**Repository path:** `docs/PROMOTION_LEDGER.md` (canonical, on `staging`)
**Ledger ID:** `LEDGER-50MM-001`
**Status of this revision:** `REV-16 · 2026-08-29T11:56Z` · **📕 DOCUMENTATION FREEZE IN FORCE — §28**

---

# 1 · DOCUMENT CONTROL

| Field | Value | Class |
|---|---|---|
| **Release ID** | `RC-20260829-05` (AF-15 → -02; D-6 merge → -03; AF-19 → -04; ledger REV-7 → -05. Supersedes `RC-20260826-01`) | VERIFIED |
| **Ledger ID** | `LEDGER-50MM-001` | — |
| **Source lane** | `staging` → Supabase `ztzutckwdhetphwghuzj` → `staging.50mmretina.com` / `cdn-staging.50mmretina.com` / R2 `50mm-staging` | VERIFIED |
| **Target lane** | `main` → Supabase `jtdtehuqtinjxropkkcn` → `www.50mmretina.com` / `cdn.50mmretina.com` / R2 `50mm` | VERIFIED |
| **Application / code RC** | **`a42b209e4f70a6efed4f3dcdb654e0f994416594`** — frozen. **Zero non-`docs/` changes after it** (§3.1). Promotion merge base `9faf5a17` (parents `fe4505aa` + `b671e1fb`) | VERIFIED |
| **Ledger head** | *moves by design — see §3.1 Layer 2 and the §3.5 freeze rule.* **`fe63e944` / tree `5b00b690…` at 10:45Z, superseded by this very commit.** The merged identity is the TAG, not any SHA in this file | **HISTORICAL BY CONSTRUCTION** |
| ~~RC SHA (T)~~ | ~~`d06b0379…` · tree `f4616fb6…`~~ — **WRONG, corrected C-8: `d06b0379` is a docs-only commit (the REV-7 ledger save), not a code RC.** ~~`25c0456` / tree `51616b21…`~~ — superseded | **CORRECTED — §3.1** |
| **main pre-promotion SHA** | `b671e1fb0c5bcf145d442076c229eca888afd674` | VERIFIED |
| **main pre-promotion tree** | `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` | VERIFIED |
| **Merge base** | `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` | VERIFIED |
| **Promotion PR** | **#104** — title corrected at REV-13 from `…— 32 commits`, which was stale (GitHub's own tab reports **45**) | VERIFIED |
| **Final merge SHA** | *not created* | **N/A — NOT PROMOTED** |
| **Production deployment SHA/ID** | *not created* | **N/A — NOT PROMOTED** |
| **Evidence gathered** | 2026-08-29 · 04:00Z–06:10Z | VERIFIED |
| **Owner** | Neil Basu (`altisinfonet`) | — |
| **Auditor** | **ROUND 1 COMPLETE — PARTIAL (§25.1).** Repository/governance audited by an independent auditor 2026-08-29. **Infrastructure half NOT audited** (§25.3): production + staging DB policy state, deployed edge functions, R2 policy, GitHub Environments and all dashboard claims are **INSUFFICIENT EVIDENCE**, not verified | **PARTIALLY OPEN** |
| **Compiled by** | Claude (Cowork session). **Not an auditor.** Compiler ≠ approver ≠ auditor. | — |

**Evidence classes used throughout:** `VERIFIED` (measured by the compiler in this session, instrument named) · `OWNER-ATTESTED` (asserted by the owner, unverifiable by construction) · `INFERRED` (reasoned, not measured — always flagged) · `BLOCKED` (measurable in principle, not measurable here) · `N/A` (with reason) · `DEFERRED` (with owner + date). **No class is silently upgraded.**

---

# 2 · RELEASE PURPOSE & SCOPE

**Purpose.** Promote **45 commits** (43 excluding merge commits — §3.2) of accumulated `staging` work to `main` *(REV-1…REV-12 said "32 commits"; stale, corrected C-8)*, covering: member-facing UI corrections; the certificates admin feature set; admin member-list pagination; and the G5b–G10 lane-isolation programme (removing hardcoded production addresses, adding a bundle-isolation guard, separating email/storage/SEO configuration per lane, and installing a migration lane gate).

**In scope:** application source, tests, CI workflows, Pages Functions, SEO assets, 2 new DB migrations, 5 new rollback files, one decision-record update.

**Explicitly NOT in scope:**
- Edge-function deployment (functions do **not** auto-deploy from GitHub — §16.4)
- Applying migrations to production (separate dispatch — §6.3)
- Android artifacts (§7 of the runbook; N/A — §11 G-A)
- PR #103 (production-lane isolation arming) — **not in T**, `704ad57` is not an ancestor of `staging`; its own body says *"Do not merge — opened for review only."*
- D-002 storage remediation (open — §13 AF-02)

---

# 3 · EXACT RC IDENTITY

## 3.1 · RC IDENTITY — LAYERED (corrected at REV-13, C-8)

> **⚠ Read this before quoting any SHA from this ledger.** Earlier revisions named a single
> "immutable candidate" SHA. That was wrong in a way that kept re-breaking the record: **the ledger
> itself lives in the repository**, so every revision of this file moves the branch head, the tree
> and the commit count. A single-SHA identity is self-invalidating by construction.
>
> **Identity is therefore recorded in two layers.** One is frozen. The other is expected to move.

### Layer 1 — APPLICATION / CODE RC (frozen)

```
CODE RC        a42b209e4f70a6efed4f3dcdb654e0f994416594
subject        fix(security): allowlist the STAGING anon key (AF-19)
branch         staging
PR             #104  (base main ← head staging)
```

**This is what CI tested, what the UI gate measured, and what the independent audit covers.**

**Proof that it is frozen — the decisive instrument:** `git diff a42b209e...fe63e944` returns
**exactly one changed file — `docs/PROMOTION_LEDGER.md`** (+493 / −59). **Zero** changes outside
`docs/`. No application source, test, workflow, migration, function or asset has changed since
`a42b209e`. **Class: VERIFIED** — measured by the compiler 2026-08-29T10:45Z against
`compare/a42b209e...fe63e944.diff`.

### Layer 2 — LEDGER HEAD (moves by design; never quote as current)

```
head at measurement   fe63e94483ac9c25c335ad9721258228ebe04571   (REV-12)
tree at measurement   5b00b690…                                  (auditor-supplied, §25)
```

> **⚠ This value was already superseded when it was written.** Recording it required a commit, and
> that commit is this one. **Any head or tree printed in this ledger is historical by construction.**
> The only head that matters is the one existing at the moment the tag is created — §3.5.

### Superseded identities — preserved, not deleted (§14 rule)

| Revision | Claimed identity | Why it is wrong |
|---|---|---|
| REV-1…REV-3 | `T = 25c0456011451f644def7ef5361904e4de25dd08`, tree `51616b21…`, described as **"Immutable candidate"** | Superseded by 8 later commits. Never immutable. |
| REV-3…REV-12 §1 | **RC SHA `d06b0379…`**, tree `f4616fb6…` | **`d06b0379` is a docs-only commit — the REV-7 ledger save.** The RC pointed at a documentation edit, not at code. Corrected to `a42b209e` above. |

---

## 3.2 · COUNTS — corrected at REV-13 (C-8)

**Two different questions, two different answers. Earlier revisions gave one number without saying
which question it answered — the same failure as C-2 (205 vs 32).**

### (a) Application scope — `main…a42b209e` (what actually changes behaviour)

| Metric | Value | Instrument |
|---|---|---|
| Files changed | **138** — 31 added, 107 modified, **0 deleted** | `compare/main...a42b209e.diff`, compiler, 10:45Z |
| Of those, in `docs/` | **2** — `docs/DECISIONS.md`, `docs/PROMOTION_LEDGER.md` | re-measured 11:05Z |
| Of those, **non-`docs/`** | **136** *(REV-13 said **137** — wrong; it assumed one docs file. Corrected C-9, found by the auditor)* | re-measured 11:05Z |
| Lines | **+9,060 / −1,293** | same |

### (b) Total promotion scope — `main…fe63e944` (code + this ledger)

| Metric | Value | Instrument |
|---|---|---|
| Commits ahead of `main` | **45 counting merge commits · 43 excluding them** | GitHub PR #104 "Commits" tab = 45; `compare/main...staging.patch` (format-patch omits merges) = 43. **Both are correct; they answer different questions.** Compiler, 10:40Z |
| Files changed | **138** — 31 added, 107 modified, **0 deleted** | `compare/main...staging.diff`, compiler |
| Lines | **+9,494 / −1,293** | same |
| Difference vs (a) | **+434 lines, 1 file** — entirely `docs/PROMOTION_LEDGER.md` | derived |

> **⚠ Do not quote (b) as the size of the code change.** 434 of those added lines are this document.

### Superseded counts — preserved (§14 rule)

| Revision | Claimed | Status |
|---|---|---|
| REV-1 | 205 commits | **WRONG** — shallow-clone artifact (C-2) |
| REV-1…REV-12 | 32 commits · 135 files (29 added / 106 modified) · +7,711 / −1,280 | **STALE** — correct when measured at `25c0456`; 13 commits have landed since |
| REV-1…REV-12 | three-dot: 151 files, +10,795 / −1,578 | **STALE, and its stated cause is now void** — see §4.2 |

---

## 3.3 CI STATE — RE-BASED AT REV-14 (C-9)

> **⚠ This section was headed "CI state at T — NOT GREEN" through REV-13, where `T` = `25c0456` — a
> SHA this ledger itself records as **void** (§3.1, C-6, C-8). A CI table anchored to a void SHA is the
> same defect the auditor found in §27; it was not in the auditor's list and is corrected here.**

### Current — measured at the exact branch head, 2026-08-29T11:05Z

| | |
|---|---|
| Head measured | `393bc5589636a0386d2c059c1fede2f31c01a736` |
| Checks | **17 total — 15 success · 2 skipped (expected) · 0 failing** |
| GitHub rollup | ✅ green · PR banner reads **"Ready to merge"** |
| Class | **VERIFIED** (compiler, GitHub checks UI) · independently reported by the auditor, §25.5 |

> **These 17 runs test the application code RC `a42b209e`.** Every commit between `a42b209e` and the
> measured head changes **only `docs/PROMOTION_LEDGER.md`** (§3.1 Layer 1, re-verified at REV-14).
> **This figure will go stale on the next ledger revision** — that is expected and governed by §3.5;
> re-read it at the freeze point (§24.1 step 6a), never carry it forward.

### Historical — the run-by-run record that closed the two red gates

**Class: VERIFIED as of the SHA named in each row. Retained as history, not as current state.**

| Check | Result | At | Class |
|---|---|---|---|
| Typecheck | ✅ Successful (1m) | `25c0456` | VERIFIED (historical) |
| Web build / Staging lane | ✅ Successful (52s) | `25c0456` | VERIFIED (historical) |
| Web build / lane resolves to exactly one | ✅ Successful (4s) | `25c0456` | VERIFIED (historical) |
| Web build / **Production lane** | ⏭ **SKIPPED** | `25c0456` | VERIFIED (historical) |
| Security / Dependency vulnerabilities | ✅ Successful (30s) | `25c0456` | VERIFIED (historical) |
| Security / Secret scan (full history) | ✅ Successful (9s) | `25c0456` | VERIFIED (historical) |
| Security / project's own security rules | ✅ Successful (9s) | `25c0456` | VERIFIED (historical) |
| Cloudflare Pages (staging) | ✅ Deployed successfully | `25c0456` | VERIFIED (historical) |
| **UI gate — "Every control reachable, nothing regressed"** | 🔴 RED at `25c0456` → ✅ **PASSING** at merge `9faf5a17` | — | **VERIFIED** · §13.1 AF-15 |
| **Security / Secret scan (full history)** | 🔴 RED at `9faf5a17` → ✅ **PASSING** at `a42b209e` | — | **VERIFIED** · §13.2 AF-19 |

> Superseded snapshot, preserved (§14): *"PR #104 on `a42b209e`: 13 successful · 2 skipped · 2 in
> progress · ZERO FAILING."* Correct when measured; superseded by the 17-check reading above.

**Both red gates are green, and neither was waved through** — each was reproduced, root-caused, fixed
and control-verified. **That conclusion is unchanged by this re-basing.**

## 3.4 Tree immutability — RESTATED AT REV-13 (C-8)

> **⚠ The word "immutable" is withdrawn as applied to any branch head.** Under §3.5 it survives only
> for the **application code RC** (§3.1 Layer 1) and for the **tag** (§3.5 rule 4). It never applied to
> `staging`, whose head this very document moves each time it is revised.

**Changing the application tree creates a new candidate.** Any commit to `staging` touching anything
**outside `docs/`**, and any conflict resolution performed on PR #104's head branch, produces a new
application RC, voids the CI evidence in §3.3, and requires re-identification here and re-running §18.
**A `docs/`-only governance commit does not** — §3.5 rule 1.

**This has already happened once:** `RC-20260826-01` named tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` (commit `b8535fe7`). **7 commits have landed since.** That RC is **VOID** by its own validity clause. Owner elected on 2026-08-29 to promote current `staging` rather than the audited older tree — §22 D-7.

---

## 3.5 · THE FREEZE RULE — how this stops being self-invalidating (new at REV-13)

**Problem this rule exists to solve.** Writing down "the head is X" requires a commit, which makes
the head not-X. Without a terminating rule the ledger corrects itself forever and is never right.

**Rule, in four parts. All four are binding.**

1. **Governance commits are declared — NARROWED AT REV-14 (C-9).** A commit touching **only
   `docs/PROMOTION_LEDGER.md`** is a *governance commit*. It changes no application behaviour, is
   **expected** to move the branch head, and **does not** create a new application RC, does not void
   CI evidence taken on the code RC, and does not require §18 to be re-run.

   > **Superseded wording, preserved (§14):** REV-13 read *"A commit touching only `docs/` is a
   > governance commit."* **That was unsafe** and the auditor was right to reject it: `docs/` is a
   > directory, and a build script, generator, policy file or test could consume a file inside it, so
   > a blanket exception could silently carry stale CI forward.
   >
   > ### ⚠ THE REV-14 EVIDENCE FOR THIS RULE WAS FALSE — CORRECTED AT REV-15 (C-10)
   >
   > **REV-14 stated, and it is preserved here verbatim because it must not be silently replaced:**
   > *"The compiler searched all **138** changed files for a runtime consumer of any `docs/` path.
   > **Four files reference `docs/` and all four references are comments** … **No file read, import
   > or glob of a `docs/` path was found.** … **So the narrowing is a precaution, not a response to a
   > demonstrated failure."***
   >
   > **That is wrong.** Independent audit round 3 measured **10** changed files referencing `docs/`,
   > and at least one reference is **executable**:
   > **`src/__tests__/candidatePatternWidening.test.ts` reads `docs/CANDIDATE_PATTERN_AUDIT.md`.**
   > The wider repository contains further tests and scripts that consume `docs/` files.
   >
   > **The broad `docs/`-only exception would therefore have been unsafe for a DEMONSTRATED reason,
   > not as a precaution.** The rule as narrowed was right; the reason given for it was not.
   >
   > **Why the compiler got it wrong — the instrument, not the arithmetic.** The REV-14 search read
   > the **diff hunks**, not the **file contents**. A diff shows only changed lines, so a `docs/`
   > reference sitting in an untouched part of a changed file is invisible to it. The file above is
   > exactly that case. **A search that is scoped wrong returns a confident, clean, false answer.**
   >
   > **Corrected instrument and what each party measured — kept separate, not blended:**
   >
   > | Measurement | By | Instrument | Result |
   > |---|---|---|---|
   > | 138 changed files, whole-file | **auditor, round 3** | independent, whole-repository | **10** files reference `docs/`; ≥1 executable |
   > | `candidatePatternWidening.test.ts` is in the changed set, 463 lines, contains a `docs/` path adjacent to a file reader | compiler | whole-file property probe | ✅ **CONFIRMED** |
   > | 40 of 138 files (all tests, scripts, workflows, configs), whole-file | compiler | whole-file scan | **5** reference `docs/`, **1 executable** — a **lower bound**, not a total |
   > | Executable consumer of **`PROMOTION_LEDGER.md`** among those 40 | compiler | whole-file scan | **none** — the only reference is a **comment in `.gitleaks.toml`** |
   >
   > ⚠ **Limit on the compiler's confirmation:** the contents of
   > `src/__tests__/candidatePatternWidening.test.ts` **could not be read** — the fetch is refused by
   > a content filter, consistent with a secret-pattern test file carrying sample credential strings.
   > The confirmation above is therefore **by property test, not by reading the code.** Recorded
   > rather than glossed.
   >
   > **What the narrowed rule now rests on:** every commit after `a42b209e` changes **only
   > `docs/PROMOTION_LEDGER.md`**, and **no executable consumer of that one file was found**. That is
   > the evidence, and it is narrower than what REV-14 claimed. Any
   > `docs/`-only commit that touches **anything other than this ledger** must be examined for build,
   > test, generator, policy or deployed-artifact effects **before** prior CI may carry forward.
2. **A commit touching anything outside `docs/` DOES create a new application RC.** It voids the
   frozen SHA in §3.1 Layer 1, voids the CI evidence in §3.3, and requires §18 to be re-run. There is
   no exception for "small" or "obvious" changes.
3. **LEDGER FREEZE POINT.** Once §11 (§23.2) is signed, **no further commit of any kind may be made
   to `staging` until after the merge.** Post-merge findings are recorded in a new revision written
   *after* promotion. This is what makes the signed head equal the merged head.
4. **The tag is created LAST and binds the actual head.** The tag is created after the freeze point
   and immediately before the merge, against `git rev-parse staging` **read at that moment** — not
   against any SHA quoted in this document. §20's tree-equality assertion is made against **the tag**.

6. **EVERY SEARCH DECLARES ITS SCOPE — new at REV-15 (C-10).** No claim of the form *"I searched X
   and found Y"* may be written without stating **what was searched** (diff hunks? changed files?
   whole repository?), **with which command or pattern**, and **what was NOT searched**. A search
   whose scope is unstated is not evidence, whatever it found.

   > **Why this rule exists.** C-10 is one missing word. "The compiler searched all 138 changed
   > files" was false only because the search read *diffs of* those files rather than the files. The
   > sentence looked complete, carried a number, and was wrong. **Rule 5 makes a figure state its
   > basis; rule 6 makes a search state its reach.** They fail in the same way and are the same fix.

5. **EVERY FIGURE CARRIES ITS BASIS — new at REV-14 (C-9).** No count, SHA, tree, line total or CI
   result may be written in this ledger as a bare value. Each must carry **what was measured, with
   which instrument, at which SHA, at which time** — or be explicitly labelled **historical**. A
   figure without a basis is to be treated by any reader as unverified, whatever class it claims.

   > **Why this rule exists.** C-2, C-6, C-8 and C-9 are the same failure four times: a number was
   > written without its basis, stayed true for a few hours, and was then carried forward as though
   > it were still current. Three consecutive audit rounds each found stale actives that the previous
   > round missed. **Fixing the sections named by an auditor, one round at a time, is what produced
   > C-9.** This rule and the REV-14 sweep exist to stop a C-10 of the same shape.

**Consequence, stated plainly so it cannot be misread:** *this ledger can never name the commit that
will be merged.* It can only name the rule that binds it. Anyone auditing the promotion must read
the tag, not this file, for the merged identity.

---

# 4 · STAGING → MAIN PROMOTION CHAIN

## 4.1 Chain state — corrected at REV-13 (C-8)

| # | Transition | Expected | Actual (10:45Z) | Status |
|---|---|---|---|---|
| 1 | staging HEAD | *moves — §3.1 Layer 2* | `fe63e944` at measurement | ✅ VERIFIED **(historical by construction)** |
| 1a | **Application code frozen since** | `a42b209e` | `a42b209e` — zero non-`docs/` changes after it | ✅ **VERIFIED** |
| 2 | PR #104 head = staging HEAD | equal | `fe63e944` = `fe63e944` | ✅ VERIFIED |
| 3 | main pre-merge | `b671e1fb` | `b671e1fb0c5bcf145d442076c229eca888afd674` | ✅ VERIFIED — **unchanged all session** |
| 4 | PR mergeable | clean | **clean** — conflict resolved by `9faf5a17` (D-6) | ✅ **RESOLVED** *(auditor-reported; compiler could not re-read the mergeability banner — §25)* |
| 5 | **Release tag** | created before merge | ***0 tags exist in the repository*** | 🔴 **NOT REACHED** — §3.5 rule 4 |
| 6 | merge SHA | — | *does not exist* | **NOT REACHED** |
| 7 | build from merge SHA | — | *does not exist* | **NOT REACHED** |
| 8 | production deployment | — | *does not exist* | **NOT REACHED** |
| 9 | production serving merged tree | — | *does not exist* | **NOT REACHED** |

> Row 1's superseded text (REV-1…REV-12) read `staging HEAD = T = 25c0456` / `T → PR #104 head =
> 25c0456` / `PR mergeable = 🔴 CONFLICT`. Preserved here rather than overwritten (§14).

## 4.2 ANCESTRY — CORRECTED AT REV-13 (C-8)

**`main` is now an ANCESTOR of `staging`.** The promotion is a fast-forward-eligible merge on the
ancestry graph; the divergence recorded in every revision up to REV-12 no longer exists.

**Cause:** the D-6 conflict-resolution merge `9faf5a17` (parents `fe4505aa` + `b671e1fb`) pulled
`main` into `staging` on 2026-08-29. From that commit onward `main` has had **no commit absent from
`staging`**.

**Instrument:** `compare/main...staging` — `main` behind, 0 ahead. Reported independently by the
auditor (§25) and consistent with the compiler's `compare/main...a42b209e` measurement. **Class:
VERIFIED.**

### Superseded statement — preserved, not deleted (§14 rule)

> REV-1 … REV-12 §4.2 read: *"⚠ The branches have DIVERGED — this is not a fast-forward. `main`
> carries **2 commits absent from `staging`**"*, naming `b671e1fb` (#101) and `6ebe6c3d` (#97),
> instrument `git log origin/staging..origin/main`, class VERIFIED.
>
> **That was true when measured and is now false.** Both commits reached `staging` through
> `9faf5a17`. **The statement is not deleted, because the three-dot/two-dot file-count discrepancy
> recorded in §3.2 was explained by it** — and that explanation is now void with it. Any conclusion
> resting on the old §3.2 three-dot figures must be re-derived, not carried forward.

## 4.3 🔴 MERGE CONFLICT — 1 file, 6 hunks

**File:** `src/lib/generateCertificatePdf.ts` (main 724 lines · staging 756 lines)
**Reproduced locally:** `git merge --no-commit --no-ff origin/staging` from `origin/main` → `CONFLICT (content)`, exactly 1 file, 6 conflict regions. **Class: VERIFIED.**

All six are `d.setTextColor(...)` calls — certificate PDF text colours:

| Hunk | Element | `main` | `staging` |
|---|---|---|---|
| 1 | "proudly presented to" | `TEXT_MUTED` | `TEXT_DARK` |
| 2 | **Recipient name** | `TEXT_DARK` | `TEXT_ACCENT` |
| 3 | "for successfully completing" | `TEXT_MUTED` | `TEXT_DARK` |
| 4 | **Course title** | `TEXT_DARK` | `TEXT_ACCENT` |
| 5 | Closing / description | `TEXT_SUBTLE` | `TEXT_DARK` |
| 6 | Footer date | `TEXT_DARK` | `TEXT_ACCENT` |

**⚠ DECISIVE TECHNICAL CONSTRAINT — only one resolution compiles.** The two branches define **different constant sets**:

```
main     TEXT_DARK, TEXT_MUTED, TEXT_SUBTLE            (no TEXT_ACCENT)
staging  TEXT_ACCENT=[0,123,177], TEXT_DARK, TEXT_SUBTLE  (no TEXT_MUTED)
```

The merged file's constant block resolves to **staging's**. Taking `main`'s side of any hunk references **`TEXT_MUTED`, which would be undefined** → TypeScript compile failure → build failure. **Class: VERIFIED** (`grep -nE "^const TEXT_"` on the merged working tree).

**RESOLUTION RULED — §22 D-6.** Owner, 2026-08-29: *"use the blue as in staging it is final, no difference from Staging."* Take **staging's side on all six hunks**.
**Visible effect:** recipient names, course titles and footer dates on every certificate change from dark grey to **blue `rgb(0,123,177)`**.
**NOT YET EXECUTED** — resolving on PR #104 commits to `staging`, which is T. Owner instruction for this revision was *"Do not modify T."* Deferred to promotion time (§24.2).

## 4.4 · CONFLICT RESOLUTION — ✅ EXECUTED 2026-08-29T08:05Z

**Owner ruling D-6 executed.** `main` was merged into `staging` through PR #104's web conflict
editor, taking **staging's side on all six hunks**.

| Field | Value |
|---|---|
| Merge commit | **`9faf5a17f2653ca5675250e274357248310198ba`** |
| Message | `Merge branch 'main' into staging` |
| Parents | `fe4505aa` (staging) · `b671e1fb` (main) |
| Direction | main → staging (so PR #104 becomes mergeable) |

**Which side is which — settled by the editor's own labels, not inferred:**

```
<<<<<<< staging (Current change)      ← taken
  d.setTextColor(...TEXT_DARK);
=======
  d.setTextColor(...TEXT_MUTED);
>>>>>>> main (Incoming change)        ← discarded
```

### Post-merge verification — all measured on `9faf5a17`

| Check | Result |
|---|---|
| Conflict markers in `generateCertificatePdf.ts` | **0** |
| `...TEXT_MUTED` **code** references | **0** (2 remain, both inside a comment recording its removal) |
| `TEXT_ACCENT` in the certificate colour block | **3** — the blue is in place |
| `main` is an ancestor of `staging` | ✅ **YES** |
| **`tsc --noEmit`** | ✅ **exit 0** |
| **Full suite** | ✅ **178 files passed, 1 skipped · 2,475 tests passed, 1 skipped** |
| PR #104 mergeability | ✅ **"Able to merge"** — conflict cleared, 36 commits |
| `main` | **unchanged at `b671e1fb`** |

**Visible product effect:** recipient names, course titles and footer dates on every certificate
render in **blue `rgb(0,123,177)`** instead of dark grey.

> **Disclosure retained.** An earlier hand-edit attempt consumed one line too many
> (`const completionText = tier.completionText;`) and left a stray marker. It was caught by
> inspection **before any commit**, discarded by force-reloading the page, and replaced by a
> deterministic `CodeMirror.setValue()` of staging's exact file. **No bad content ever reached the
> repository**, and the committed result is verified above.

---

---

# 5 · COMPLETE FILE-LEVEL CHANGE MANIFEST

> **⚠ CORRECTED AT REV-14 (C-9). Through REV-13 this section opened with "135 files: 29 added · 106
> modified · 0 deleted … Class: VERIFIED" and its sub-headings read ADDED (29), MODIFIED (106),
> Commit manifest (32). Those figures were measured at `25c0456` and were stale from REV-4 onward —
> nine revisions.** They were not in the auditor's REV-13 list; §27 row 1 cited them, so correcting
> §27 without §5 would have left the two contradicting each other. Old values preserved below.

## 5.0 · CURRENT — measured 2026-08-29T11:05Z

| Metric | Value | Basis |
|---|---|---|
| **Files changed, `main…staging`** | **138** — **31 added · 107 modified · 0 deleted** | `compare/main...staging.diff`, compiler |
| of which in `docs/` | **2** — `docs/DECISIONS.md`, `docs/PROMOTION_LEDGER.md` | same |
| of which **non-`docs/`** | **136** | same |
| Lines, total | **+9,680 / −1,293** | same |
| Lines, application only (`main…a42b209e`) | **+9,060 / −1,293** | `compare/main...a42b209e.diff` |
| Commits ahead of `main` | **46 counting merges · 44 excluding** | PR #104 Commits tab · `compare/main...staging.patch` |

**Reproduce:** `git diff --name-status origin/main origin/staging` *(the REV-1…REV-13 text gave
`git diff --name-status b671e1fb 25c0456`, which pins the void SHA — corrected)*.

> **Head-derived figures go stale by design (§3.5).** Re-measure at the freeze point; do not carry.

## 5.0.1 · DELTA since the `25c0456` enumeration — complete, 5 files

The tables in §5.1–§5.4 enumerate the state **at `25c0456`**. Rather than retype 138 entries — where
transcription error is the likeliest failure — the difference is stated exactly and is independently
reproducible with `git diff --name-status 25c0456 staging`:

| Status | Path | Effect on the counts |
|---|---|---|
| **A** | `docs/PROMOTION_LEDGER.md` | added → 29 → 30 |
| **A** | `src/components/__tests__/SummaryTriggerTapTarget.test.ts` | added → 30 → **31** |
| **M** | `.gitleaks.toml` | **newly** modified → 106 → **107** |
| M | `src/components/ReactionSummaryTooltip.tsx` | already counted; changed further (AF-15) |
| M | `src/components/ShareSummaryTooltip.tsx` | already counted; changed further (AF-15) |

**135 + 2 added + 1 newly-modified = 138.** ✅ reconciles exactly.

**Only three commits in that delta touch application code** — `bfcb68da` and `c8aec5d5` (AF-15) and
`a42b209e` (AF-19). Merge `9faf5a17` brought `main`'s `b671e1fb` and `6ebe6c3d` into `staging`
(§4.2). **Every remaining commit in the delta is a ledger revision, REV-4 … REV-13, touching only
`docs/PROMOTION_LEDGER.md`.**

## 5.1 ADDED — 29 as enumerated at `25c0456`; **31 currently** (see §5.0.1)

**CI / workflows (1)**
1. `.github/workflows/verify-schema-dependencies.yml`

**Build & lane scripts (7)**
2. `scripts/generate-headers.mjs`
3. `scripts/generate-seo-assets.mjs`
4. `scripts/lane-config.mjs`
5. `scripts/test-schema-dependencies.mjs`
6. `scripts/test-seo-assets.mjs`
7. `scripts/verify-schema-dependencies.mjs`
8. `functions/pages-runtime.d.ts`

**Application source (5)**
9. `src/lib/env.ts`
10. `src/components/comments/CommentThread.tsx`
11. `src/components/post/PostActionRow.tsx` ← **implicated in AF-15**
12. `supabase/functions/_shared/laneConfig.ts`
13. *(see 14–20 for tests)*

**Tests (7)**
14. `src/__tests__/certificatePalette.test.ts`
15. `src/__tests__/corsOriginAllowlist.test.ts`
16. `src/__tests__/laneIsolation.test.ts`
17. `src/__tests__/seoLaneRequired.test.ts`
18. `src/__tests__/storageLane.test.ts`
19. `src/components/__tests__/BrandBadgeEverywhere.test.tsx`
20. `src/components/__tests__/ComposerEnterKey.test.tsx`

**Tests, continued (4)**
21. `src/components/ads/__tests__/StoryCardComments.test.tsx`
22. `src/components/ads/__tests__/StoryCardReactions.test.tsx`
23. `src/components/comments/__tests__/CommentLineBreaks.test.tsx`

**Database (6)**
24. `supabase/migrations/20260824145345_admin_user_lookup_by_email.sql`
25. `supabase/migrations/20260828082136_ad_comment_ban_and_visibility_policies.sql` ← **post-RC; see §6.2**
26. `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql`
27. `supabase/rollback/20260828082136_ad_comment_ban_and_visibility_policies_ROLLBACK.sql`
28. `supabase/rollback/UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql`
29. `supabase/rollback/UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql`
30. `supabase/rollback/UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql`

*(Numbering runs to 30 because item 13 is a placeholder; the added-file count from `git` is **29**.)*

## 5.2 DELETED

**NONE.** `git diff --diff-filter=D` returns empty. **Class: VERIFIED.** No file is removed from `main` by this promotion.

## 5.3 MODIFIED — 106 as enumerated at `25c0456`; **107 currently** (see §5.0.1) — by area

> ⚠ **Do not confuse this §5.3 with the "runbook §5.3 secret-isolation probe" referenced in §11, §24 and §26.**
> That probe is **§5.3 of the migration/execution runbook**, a different document. The collision is
> real and an auditor following the reference lands here, in a file manifest. **All such references
> are relabelled "runbook §5.3" at REV-14 (C-9).** Found by the compiler, not in the auditor's list.

| Area | Count | Notable |
|---|---|---|
| `supabase/functions/**` | 44 | incl. `submit-judge-decision` (CORS + tag-mirror fix), 16 transactional-email templates, 6 email templates, `_shared/*` |
| `src/components/**` | 28 | post, ads, admin, judge surfaces |
| `src/__tests__/**` | 11 | |
| `src/lib/**` | 9 | incl. **`generateCertificatePdf.ts` — the conflicted file** |
| `.github/workflows/**` | 7 | **all 7 pre-existing workflows modified** — §8.2 |
| `src/pages/**` | 2 | |
| `functions/**` (Pages) | 6 | `_seo.ts`, competitions, courses, featured-artist, journal, page |
| `public/**` | 3 | `_headers`, `robots.txt`, `sitemap.xml` |
| root config | 5 | `vite.config.ts`, `vitest.config.ts`, `package.json`, `index.html`, `supabase/config.toml` |
| `docs/DECISIONS.md` | 1 | D-002 update (§22 D-4) |

**Full per-file list reproducible by:** `git diff --name-status origin/main origin/staging` for the current set, or `git diff --name-status b671e1fb 25c0456` to reproduce the historical enumeration above. *(REV-1…REV-13 gave only the second form, pinning the void SHA — corrected at REV-14, C-9.)*

## 5.4 Commit manifest — **32 as enumerated at `25c0456`; 46 currently (44 excluding merges)**

> **HISTORICAL ENUMERATION.** The 32 rows below are the state at `25c0456`. The 14-commit delta is
> itemised in §5.0.1: three code commits (`bfcb68da`, `c8aec5d5`, `a42b209e`), merge `9faf5a17`
> bringing `main`'s two commits, and the REV-4…REV-13 ledger revisions. **Reproduce:**
> `git log --oneline origin/main..origin/staging`.

| # | SHA | Date | Subject |
|---|---|---|---|
| 1 | `25c04560` | 08-29 | Drop the composer hint text; shorten the privacy notice copy (D-002 stays open) |
| 2 | `c8dc83b1` | 08-29 | Multi-line comments render as multiple lines; composer says how to post |
| 3 | `e7dbf51e` | 08-29 | The reaction triggers are real buttons, not clickable divs ← **AF-15 origin** |
| 4 | `8e09e0b7` | 08-28 | Blue tick shows wherever the name shows: resolve the brand badge in AutoBadge |
| 5 | `5d35e4b5` | 08-28 | Ad card: show the reaction break-up and name who reacted, like the feed |
| 6 | `af7166ba` | 08-28 | Merge remote-tracking branch 'origin/staging' into staging |
| 7 | `a193a7ee` | 08-28 | Fix story-card comments; put the ad card on the post card's row and thread |
| 8 | `b8535fe7` | 08-26 | G10: rollback coverage for four migrations, schema-dependency guard, gift-by-email (#102) ← **former RC** |
| 9–12 | `702e5ceb` `7642c282` `98ff9510` `b277729e` | 08-26 | Add files via upload ×4 (part of #102) |
| 13 | `c92d5345` | 08-25 | STAGING — certificates: live preview in the admin form as you type (#100) |
| 14 | `5dbfcf79` | 08-25 | STAGING — certificates: delete unbroken, all 16 types worded, description printed (#99) |
| 15 | `7380e28e` | 08-25 | STAGING — certificate view: draw the preview instead of framing a PDF (#98) |
| 16 | `cba8dae2` | 08-25 | STAGING — certificates: six admin defects (#96) |
| 17 | `6d6aa6c6` | 08-24 | STAGING PREVIEW — page the admin member list, filter role/badge in SQL (#95) |
| 18 | `9f3d20a0` | 08-24 | G9: CORS refuses unknown origins, judge tag mirror fixed, _redirects rule removed |
| 19 | `e658062e` | 08-24 | Fix measure-post-media import path and drop three stale config entries |
| 20 | `b3b8c21e` | 08-23 | G10: the isolation guard could not see supabase/functions at all (#94) |
| 21 | `a8c595d2` | 08-23 | G9: the email layer gets a lane, six signing paths assert, CORS stops matching a prefix (#93) |
| 22 | `87aa5eac` | 08-23 | G9: assert the storage lane where the credentials are loaded (#92) |
| 23 | `e2db18b6` | 08-23 | G8: an unchecked lane is a refusal, not a silent PASS (R12) (#91) |
| 24 | `06b91623` | 08-23 | G7: the production lane is the only indexable lane (#90) |
| 25 | `d33c91ef` | 08-23 | G5b: remove production defaults from Pages Functions, scan functions/ (#89) |
| 26 | `9aea8a30` | 08-22 | guard: host rules R7-R10 |
| 27 | `a9f5b80e` | 08-22 | ci: derive CORS from the apex form, wire both lanes explicitly |
| 28 | `9a89aadf` | 08-22 | web: de-hardcode every lane-specific address |
| 29 | `44e3e925` | 08-22 | Revert "TEMPORARY: blank the staging lane's forbidden list to prove R6 fires" |
| 30 | `ec1a3b98` | 08-22 | TEMPORARY: blank the staging lane's forbidden list to prove R6 fires |
| 31 | `9af9ef7d` | 08-22 | test(isolation): make the mutation harness hermetic |
| 32 | `ccd5e423` | 08-22 | ci: lane-aware CI for the staging and production lanes |

**Commits 29+30 are a deliberate prove-then-revert pair** (R6 fired, then was restored). Net effect on T: zero. Recorded because a reader seeing only #30 would conclude the forbidden list was blanked.

---

# 6 · DATABASE & MIGRATION LEDGER

## 6.1 Inventory

| | staging repo | main repo | Class |
|---|---|---|---|
| `supabase/migrations/*.sql` | **635** | **633** | VERIFIED |
| `supabase/rollback/*.sql` | **35** | **30** | VERIFIED |

**Delta introduced by this promotion: +2 migrations, +5 rollbacks.**

## 6.2 The two new migrations

### M1 · `20260824145345_admin_user_lookup_by_email.sql`

| Field | Value | Class |
|---|---|---|
| Applied — **staging** | ✅ `20260824144927` (name `admin_user_lookup_by_email`) | VERIFIED (SQL) |
| Applied — **production** | ✅ `20260824145345` | VERIFIED (SQL) |
| Rollback | `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql` | VERIFIED |
| Net effect of promotion | **None on either DB** — already applied to both | VERIFIED |

**⚠ Version-stamp divergence:** the same logical migration carries **different version integers per lane** (`…144927` staging vs `…145345` production). The *filename* matches production. Recorded as **AF-16**.

### M2 · `20260828082136_ad_comment_ban_and_visibility_policies.sql` — **🔴 THE LOAD-BEARING ONE**

| Field | Value | Class |
|---|---|---|
| Applied — **staging** | ✅ `20260828082136` | **VERIFIED (SQL)** |
| Applied — **production** | ❌ **NOT APPLIED** | **VERIFIED (SQL)** |
| Rollback | ✅ present, reviewed, **never executed** | VERIFIED |
| Shape | **EXPAND-ONLY** — adds 2 RESTRICTIVE policies, drops nothing, alters no table/column/row | VERIFIED (read in full) |
| Post-dates the former RC | **YES** — created 08-28, after `b8535fe7` (08-26) | VERIFIED |

**What it does — it closes two live production security gaps:**

1. **A banned member can comment on advertisements.** `post_comments` carries the RESTRICTIVE policy *"Banned users cannot comment on posts"*; `ad_creative_comments` reads `is_banned` **nowhere**. Banning a member closes post threads and leaves every sponsored ad open.
2. **A hidden ad's comment thread is readable by any signed-in member.** `ad_creative_comments`' only SELECT policy is `USING (true)`. Switching a creative to Hidden removes it from the feed and its page, while `/rest/v1/ad_creative_comments?creative_id=eq.<id>` **still serves the thread underneath it**.

**MEASURED POLICY STATE — instrument `pg_policies`, both lanes, 2026-08-29:**

| Lane | Policy count | `Banned users cannot comment on ads` | `Ad comments follow the ad's visibility` |
|---|---|---|---|
| **production** | **7** | ❌ **ABSENT** | ❌ **ABSENT** |
| **staging** | **9** | ✅ RESTRICTIVE INSERT | ✅ RESTRICTIVE SELECT |

**Class: VERIFIED.** ⇒ **PRODUCTION CARRIES BOTH GAPS TODAY.** Recorded as **AF-17**.

**MEASURED LIVE EXPOSURE — production, 2026-08-29:**

```
ad_creatives            1
ad_creatives hidden     0     ← gap 2 not currently reachable
ad_creative_comments    1
comments on hidden ads  0
banned members          0     ← gap 1 not currently reachable
```
**Class: VERIFIED.** **Live exposure today is ZERO.** Both gaps become real the moment an admin hides a creative or bans a member. *(Structurally identical to D-002: a correct control absent, harmless only because the triggering state does not yet exist.)*

**⚠ CRITICAL SEQUENCING — merging PR #104 does NOT close these gaps.** Migrations are applied by a **separate manual dispatch** of `apply-migration.yml`, never by a merge. **Action required at §24.3.**

## 6.3 The `UNAPPLIED_` prefix set (9 files, unchanged by this promotion)

| # | File | Forward applied in production? |
|---|---|---|
| 1 | `migrations/UNAPPLIED_20260824000000_admin_user_list_pagination.sql` | ✅ as `20260825092152` |
| 2 | `migrations/UNAPPLIED_20260825060000_certificate_types_and_admin_search.sql` | ✅ as `20260825115030` |
| 3 | `migrations/UNAPPLIED_20260825120000_certificate_delete_removes_notifications.sql` | ✅ as `20260825115116` |
| 4 | `migrations/UNAPPLIED_20260825170000_certificate_custom_heading.sql` | ✅ as `20260825115208` |
| 5–8 | the four matching `rollback/UNAPPLIED_*_ROLLBACK.sql` | — |
| 9 | `rollback/UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` | ✅ forward applied as `20260820180836 classf_repoint_originals` |

**Every file prefixed `UNAPPLIED_` names a migration that IS applied in production.** The prefix is factually wrong on all nine. **Class: VERIFIED (SQL).** Disposition §22 D-1.

**Correction to a prior conclusion:** the 08-27 preparation ledger called file 9 an *"orphan — no forward migration in this RC."* Accurate as to *this RC*, but it **does** have a forward migration, applied in production 2026-08-20. §14 C-4.

## 6.4 Destructive / data-changing operations

| Category | Finding | Class |
|---|---|---|
| `DROP TABLE` / `DROP COLUMN` | **NONE** in either new migration | VERIFIED |
| `DELETE` / `UPDATE` / `TRUNCATE` on member data | **NONE** | VERIFIED |
| `ALTER TABLE` | **NONE** | VERIFIED |
| Policy drops | Only `DROP POLICY IF EXISTS` immediately preceding `CREATE POLICY` of the same name (idempotency idiom) | VERIFIED |
| Function / trigger / index changes | **NONE** in the 2 new migrations | VERIFIED |

**No destructive operation is introduced by this promotion.**

---

# 7 · ENVIRONMENT / SECRET / CONFIGURATION LEDGER

**No secret value was read, requested, displayed, transmitted or stored at any point in compiling this ledger.** Scopes and names only.

## 7.1 GitHub secret scope — measured 2026-08-29

| Secret | Scope | Status | Class |
|---|---|---|---|
| **`SUPABASE_DB_URL`** | **Environment `production` ONLY** | ✅ Present. **Absent at repository level** — which is correct: a repo-level copy would defeat Environment binding. | **VERIFIED** |
| `ANDROID_KEYSTORE_BASE64` | Repository | Present | VERIFIED |
| `ANDROID_KEYSTORE_PASSWORD` | Repository | Present | VERIFIED |
| `ANDROID_KEY_ALIAS` | Repository | Present ⚠ known-wrong value (harmless since `1fcd745`; CI resolves from the keystore) | VERIFIED (presence) |
| `ANDROID_KEY_PASSWORD` | Repository | Present ⚠ same | VERIFIED (presence) |

**Repository-level secrets total: 4, all `ANDROID_*`.** **Class: VERIFIED** (Settings → Secrets and variables → Actions).

**⚠ Not verified:** whether a **`staging` Environment** exists and holds its own `SUPABASE_DB_URL`. The secrets page lists Environment secrets for `production` only. If absent, `apply-migration.yml` with `target=staging` fails at its credential gate. **Class: BLOCKED** — owner check, §24.1.

## 7.2 Configuration changed by this promotion

| File | Change | Class |
|---|---|---|
| `scripts/lane-config.mjs` | **NEW** — single source of lane addresses | VERIFIED |
| `src/lib/env.ts` | **NEW** — client-side lane resolution | VERIFIED |
| `supabase/functions/_shared/laneConfig.ts` | **NEW** — edge-function lane resolution | VERIFIED |
| `public/_headers` | Generated. **`Access-Control-Allow-Origin` moves apex → `www`** | VERIFIED (prior G4 audit) |
| `public/robots.txt`, `public/sitemap.xml` | Generated; byte-identical to `main`'s | INFERRED (prior G4 audit; not re-measured) |
| `supabase/config.toml` | Modified | VERIFIED (presence) |

**⚠ The `_headers` CORS change is a production behaviour change** carried under a de-hardcoding commit. Flagged by the G4 audit as unflagged then; carried here as **AF-11**, §22 D-8 required.

---

# 8 · CI/CD PROVENANCE

## 8.1 The candidate's runs

| Workflow | Run | Commit | Actor | Result | Class |
|---|---|---|---|---|---|
| **UI gate** | **#122** — `33232872781`, job `99048633354` | `25c0456` | `altisinfonet` | 🔴 **FAILED 7m 46s** | VERIFIED |
| Typecheck | (PR #104 check) | `25c0456` | `altisinfonet` | ✅ 1m | VERIFIED |
| Web build — staging lane | (PR #104 check) | `25c0456` | `altisinfonet` | ✅ 52s | VERIFIED |
| Web build — production lane | (PR #104 check) | `25c0456` | — | ⏭ **SKIPPED** | VERIFIED |
| Web build — lane resolves to one | (PR #104 check) | `25c0456` | — | ✅ 4s | VERIFIED |
| Security — dependency vulns | (PR #104 check) | `25c0456` | — | ✅ 30s | VERIFIED |
| Security — secret scan (full history) | (PR #104 check) | `25c0456` | — | ✅ 9s | VERIFIED |
| Security — own security rules | (PR #104 check) | `25c0456` | — | ✅ 9s | VERIFIED |
| Cloudflare Pages (staging) | — | `25c0456` | — | ✅ Deployed | VERIFIED |

**UI gate history on `staging` — the regression boundary, measured:**

| Run | Commit | Subject | Result |
|---|---|---|---|
| #122 | `25c0456` | composer hint / privacy copy | 🔴 **failed** |
| #121 | `c8dc83b` | multi-line comments | 🔴 **failed** |
| #120 | `e7dbf51` | **reaction triggers → real buttons** | 🔴 **failed** ← **first red** |
| #119 | `8e09e0b` | blue tick | ✅ success |
| #118 | `5d35e4b` | ad card reactions | ✅ success |
| #117 | `af7166b` | merge | ✅ success |
| #116 | `b8535fe` | **former RC (#102)** | ✅ success |
| …earlier | | | ✅ success |

**Class: VERIFIED** (workflow run list + per-run status labels). **The gate went red at `e7dbf51` and has never recovered.** §13 AF-15.

## 8.2 Workflow files changed by this promotion

**All 7 existing workflows modified; 1 added.** **Class: VERIFIED.**

`android-build.yml` · `apply-migration.yml` · `health.yml` · `security.yml` · `typecheck.yml` · `ui-gate.yml` · `web-build.yml` · **+ `verify-schema-dependencies.yml` (new)**

**⚠ Promoting this PR changes the CI system itself.** The workflows that will police `main` after the merge are not the workflows that police it now.

## 8.3 Deployment identity

| Artifact | State |
|---|---|
| Staging Pages deployment | ✅ exists for `25c0456` |
| **Production Pages deployment for merged tree** | **N/A — NOT PROMOTED** |
| Android artifact | **N/A** — no `android/` directory at any commit; generated at build time |

---

# 9 · SECURITY & LANE ISOLATION

| Control | State on `main` **now** | State in T (after promotion) | Class |
|---|---|---|---|
| **Migration lane gate** | 🔴 **ABSENT** — `apply-migration.yml` line 77 reads `# environment: production`, **commented out** | ✅ `environment: ${{ inputs.target }}` live, plus 4 ordered gates (branch↔target, credential present, **ref assertion**, path validation), all before `psql` | **VERIFIED** |
| **Branch protection (`main`)** | ✅ ruleset `protect-main` **Active**, bypass list **EMPTY**, rules: *Require a pull request before merging* · *Block force pushes* · *Restrict deletions* | unchanged | **VERIFIED** |
| Environment protection | `production` Environment exists and holds `SUPABASE_DB_URL` | unchanged | VERIFIED (existence) |
| **runbook §5.3 secret-isolation probe** | not run | not run | **BLOCKED** — §24.2 |
| DB isolation | Distinct projects: `jtdtehuqtinjxropkkcn` (prod) / `ztzutckwdhetphwghuzj` (staging) | unchanged | VERIFIED |
| **R2 write isolation** | Token scoped to one bucket — §10.2 | unchanged | **VERIFIED (scope)** |
| CDN isolation | `cdn.` / `cdn-staging.` split; production CDN refuses staging-origin reads | unchanged | INFERRED (prior G9 measurement, not re-measured) |
| Production-write protection | No production write performed — §16 | — | VERIFIED |

**The most consequential line in this table:** the migration lane gate **does not exist on `main` today**. Until PR #104 merges, a production migration dispatch on `main` runs with **no environment binding and no ref assertion**. **Promotion installs the gate; it does not create the exposure.**

---

# 10 · R2 / STORAGE / CDN LEDGER

## 10.1 Buckets

| Bucket | Lane | Public access | Size | Class |
|---|---|---|---|---|
| `50mm` | production | **Enabled** | **1.12 GB** (was 1.09 GB on 08-27) | VERIFIED |
| `50mm-staging` | staging | — | — | VERIFIED (existence) |
| `agentcrm` | unrelated | — | — | VERIFIED — **out of scope, do not touch** |

Production prefixes: `avatars/`, `competition-photos/`, `course-images/`, `journal-images/`, `national-ids/`, `portfolio-images/`, `post-images/`, `site-assets/`. Class A ops 1.04k · Class B 39.16k.

**Size growth 1.09→1.12 GB is organic**: `DAILY_MEDIA_DELTA_CHECK_2026-08-29` independently measured **28 posts on 08-28**, the busiest day in the series. Not QA contamination. **A GB-rounded figure cannot detect a 0-byte probe** — which is why §10.3 uses a prefix search instead.

## 10.2 Write isolation — **the token scope IS readable**

**Chain, complete:**

| # | Link | Evidence | Class |
|---|---|---|---|
| 1 | App's staging credential `access_key_id` = `73a7920647481fd93553f9c1f68bf5a3` | `site_settings` → `s3_storage_settings` | **OWNER-ATTESTED** 2026-08-29 |
| 2 | For R2, **Access Key ID *is* the API token id** | Cloudflare docs, verbatim: *"Access Key ID: The `id` of the API token."* | **DOCUMENTED** |
| 3 | That id = token **`staging-upload`** | Cloudflare → Account API tokens | **VERIFIED** |
| 4 | Its permission policies = **exactly one**: `R2 › 50mm-staging` → Workers R2 Storage Bucket Item Write | token detail page | **VERIFIED** |
| 5 | **No policy names `50mm`** | same page | **VERIFIED** |
| 6 | Cloudflare authorization is deny-by-default | platform model | PLATFORM |
| 7 | ⇒ `PutObject` to `50mm` is refused at the authorization layer | follows 1–6 | **INFERRED** |

**It is the only API token in the account** (`Showing 1-1 of 1`). Expiration: **none**.

**⚠ §8.6's stated premise is FALSE.** It reads *"Token scope is not readable after creation, so this is OWNER-ATTESTED by construction."* The **secret** is unreadable; the **scope** is permanently readable, and was read. §14 C-1.

**Why the prescribed runtime test cannot settle it.** A.5's control 3 (`PutObject` to a non-existent bucket, expecting `NoSuchBucket`) **cannot discriminate for a bucket-scoped token**: `50mm` and `50mm-does-not-exist-*` are both outside the policy, so both are refused at authorization (`10003 AccessDenied`) before reaching the existence check that emits `10006 NoSuchBucket`. **A correctly-scoped token must return `AccessDenied` for both.** Control 3 can only discriminate for a credential broad enough to fail the gate. **Class: INFERRED** — Cloudflare documents both codes but is **silent on evaluation order**; this rests on the documented Access-Policy model plus one observed run.

**Prior runtime run `33079091310`** (recorded in the 08-27 signing pack) concluded FAILURE for exactly this reason. Its valid narrow finding, verbatim: *"the same credential, in one run seconds apart, **succeeded** writing and reading back a zero-byte object in `50mm-staging` and was **denied** writing to `50mm`."* **That success/denial pairing already carries the discrimination control 3 was meant to supply.**

## 10.3 Production bucket unchanged

**Prefix search, `50mm`, `isolation-probe/`, 2026-08-29T04:37:25Z → "No objects matched your search."** Zero results. **Class: VERIFIED.**

Since run `33079091310` attempted `PutObject` to `50mm` at `isolation-probe/<TS>.txt`, a zero-result search of that exact prefix afterwards **measures** that no object was created — A.5's *"and no object created"* clause, measured rather than inferred.

**Honest limit:** this is an **after** measurement only. No **before** baseline was captured prior to that run and none can be created retroactively.

## 10.4 AF-03 / D-5 reconciliation

Staging `public.site_settings` holds **46 references** to `https://cdn.50mmretina.com` → **12 distinct production objects**, across six keys: **37 live** (`managed_pages` 17 = 6 `og_image` + 11 in `json_ld`; `seo_pages` 7; `ad_slots` 9; `ad_zones_v2` 3; `seo_global` 1) and **9 backup-only** (`ad_slots_backup_20260723`). `af03_keys_still_present = 6`, unchanged.

Measured with positive and negative controls on both origins: the 12 objects **exist in production R2**, are **absent from staging R2**, and requested from a staging page the **production CDN refuses them**. **No cross-lane data leak** — staging cannot obtain production assets.

**Class: INFERRED for this ledger** — carried from the 08-27 record; **not re-measured today.**

**Accepted defects:** (a) §15 row 1's negative criterion literally fails; (b) staging renders broken ad/OG images on 29 routes.
**Control gap → G11:** the isolation guard scans **built code**; these references live in **database rows**, invisible to every R-rule and mutant. A data-side isolation scan is required. The guard's 21/21 mutant result is unaffected and is **not** downgraded.

---

# 11 · G1–G10 AUDIT MATRIX

> **No gate is marked GREEN because a previous report said so.** Every row states its own evidence and class.

| Gate | Requirement | Instrument | Evidence | Result | Class |
|---|---|---|---|---|---|
| **G1–G2** | Lane-aware CI; forbidden-ref guard fires | `ci: lane-aware CI` (`ccd5e42`); prove/revert pair `ec1a3b9`/`44e3e92` | R6 demonstrated firing then restored; 8 workflows present in T | ✅ **CLOSED** | INFERRED (prior CI runs; not re-run today) |
| **G3** | Migration lane gate armed on the **target** lane | `git show origin/main:.github/workflows/apply-migration.yml` | **Line 77 = `# environment: production` — COMMENTED OUT on `main`.** Live in T with 4 ordered gates | 🔴 **OPEN on `main`** — closes *only* on promotion | **VERIFIED** |
| | runbook §5.3 secret-isolation probe | throwaway branch + echo-only workflow, **no `environment:` key — its absence IS the test** | **RE-TAKEN at the candidate, 2026-08-31.** Run **`33378911297`**, branch `scratch/g10-53-secret-isolation-20260831` at `9c556b8ebe4f480b85b4b415a48cd95b1d846180`, parented on `5ca0d256`. Workflow blob sha256 `4da0826127e32f950cdf79750dc3cb1a054c585ebb053f573bff679f65ca42a0`, byte-identical to the 2026-08-26 design. **Step log line 12 read verbatim: `EMPTY`.** `NON-EMPTY` absent from the log. Job `probe` succeeded in 4s, all three steps green. Branch deleted; cleanup proved — 0 `secret-isolation` refs, remote branch count restored to its pre-probe 119, `main` and `staging` unmoved, 0 tags. Residue: the run record and its logs persist and cannot be removed; **no deployment record was created** | ✅ **CLOSED** | **VERIFIED** |
| **G4** | No production literals in staging bundle | bundle census (prior) | staging bundle: `cdn.50mmretina.com` 0 · `www.50mmretina.com` 0 · prod ref 0 | ✅ **CLOSED** | INFERRED (prior; not re-built today) |
| | ACAO derivation | `public/_headers` diff | **apex → `www` — a production behaviour change** carried under a de-hardcoding commit | ⚠ **AMBER** | VERIFIED (diff) · **AF-11** |
| **G5b** | No production defaults in Pages Functions; guard scans `functions/` | `d33c91e` (#89) | 6 Pages Functions modified; guard extended | ✅ **CLOSED** | INFERRED (prior) |
| **G6** | Production-lane cross-reference negative test; forbidden-ref guard fires in both directions | Six executed negative tests, 2026-08-22 — `claude/G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md` | **N-PROD-1 FAIL [R3] exit 1** (production bundle carrying a staging ref) · **N-PROD-3 PASS exit 0** (ref belonging to neither lane — the discriminating control) · N-PROD-2 FAIL [R6] · N-PROD-4 FAIL [R8] · N-STG-1 FAIL [R3] · P-1 PASS · 12/12 mutants held. **Production Cloudflare Pages variable `ISOLATION_FORBIDDEN_REFS` NOT READABLE from any session to date** | ⚠ **AMBER** | **VERIFIED** (guard, both directions) + **OWNER-ATTESTED** (Pages variable) |
| | *G6 corrected at REV-17.* | *Prior row read: "(not separately evidenced in the record available to this compiler)" — ⬜ NOT ESTABLISHED — BLOCKED.* | ***That was stale, not empty**: the evidence existed in the project and not in this ledger. Prior wording preserved above per the owner's standing rule. **To reach GREEN one observation is still required and only the owner can take it:** the next production Pages deploy log line reading `forbidden=[ztzutckwdhetphwghuzj]`, captured and recorded* | | |
| **G7** | Production lane is the only indexable lane | `06b9162` (#90); `public/robots.txt`, `sitemap.xml` | robots/sitemap generated per lane | ✅ **CLOSED** | INFERRED (prior) |
| **G8** | Storage lane asserted where credentials load | `87aa5ea` (#92); `src/__tests__/storageLane.test.ts` (new) | test added in T | ✅ **CLOSED** | VERIFIED (file present) |
| | §8.6 pt.2 — staging credential refused write to production bucket | A.5 runtime test / token-scope read | **Scope read directly: 1 policy, `50mm-staging` only** (§10.2). Runtime run `33079091310` = staging SUCCESS + production DENIED. Control 3 structurally cannot discriminate | ⚠ **SUBSTANCE MET, INSTRUMENT NOT** | **VERIFIED (scope)** + **INFERRED (runtime enforcement)** |
| | §8.6 pt.3 — production bucket unchanged | prefix search `isolation-probe/` | **0 results, 04:37:25Z** | ✅ | **VERIFIED (after only; no before)** |
| **G9** | CORS refuses unknown origins; lane config for email/storage | `9f3d20a`, `a8c595d`, `87aa5ea` | Source fixed in T. **Production edge functions NOT redeployed** — 71 functions still serve pre-G9 CORS; `submit-judge-decision` v23 still answers `*` | 🔴 **EXCLUDED from G10** | **OWNER-ATTESTED** (countersignature pending, §23) |
| **G10** | Promotion executed, tree equality asserted | merge + `git rev-parse` | **Not performed** | ⬜ **NOT REACHED** | **N/A** |
| **G-A** | Android versionCode | Play Console | No `android/` directory at any commit; **web-only release** | **N/A** — with reason | **N/A** · **AF-13** |

**Honest ceiling, unchanged:** G3's Environment configuration and branch protection are **OWNER-ATTESTED by construction** and may never be described as independently verified. **G10 cannot be GREEN before promotion occurs.** Anyone reporting "11 green" on this candidate is reporting something that does not exist.

---

# 12 · §15 QA MATRIX

| Row | Instrument | Evidence | Result | Disposition | Class |
|---|---|---|---|---|---|
| **1 · UI** | staging deployment `3a6f3df9-639b-444f-846a-b17be22cde73` | Broken ad/OG images on 29 routes | 🔴 **FAILING** | **Approving over a known-failing row** under D-5. **Not a pass; must not be recorded as one** | VERIFIED (prior) |
| **2 · Flows** | manual QA | 7/10 | ⚠ PARTIAL | 2 blocked on production-authenticated QA profile; 1 structurally untestable (0 journal articles) | OWNER-ATTESTED |
| **3 · Auth** | — | — | **N/A** | No staging mail path (§8.8 opt 1); `/login`+`/signup` need anonymous context | N/A with reason |
| **4** | — | verified | ✅ | — | INFERRED (prior) |
| **5 · Storage** | §10.2 | token scope + runtime pairing | ⚠ | Governed by §10.2; **not signed here** | VERIFIED (scope) |
| **6 · Edge functions** | §15 flows | 5/74 exercised | ⚠ PARTIAL | Scoped to functions reachable by the 10 flows. **5 financial functions = NOT TESTABLE — POLICY EXCLUSION, displayed explicitly, never folded into a ratio** | OWNER-ATTESTED |
| **7** | — | verified | ✅ | — | INFERRED (prior) |
| **8 · SEO** | instrument closed 07:26Z | — | 🔴 **FAILING** | **Approving over a known-failing row** under D-5 | VERIFIED (prior) |
| **9** | — | verified **vacuously** | ✅ | **Recorded as vacuous** | INFERRED (prior) |
| **10 · Responsive** | `resize_window` | reported success 3× while `innerWidth` never moved | 🔴 **BLOCKED** | **N/A with reason. No substitute instrument accepted.** → G11 | VERIFIED (prior) |
| **11 · Regression** | §18 | — | ⏸ **DEFERRED** | Post-promotion by construction (§17-12) → Phase 8 | DEFERRED · owner · at promotion |
| **12 · Cross-lane** | N1 / N2 | N1 ✅ | ⏸ **DEFERRED** | **N2 cannot run before promotion** — `main` has no gate, so a pre-promotion N2 tests nothing (§14 HS-11) → §24.3 | DEFERRED · owner · post-merge |

**⚠ §15 has TWO tests and both are live:** the preamble requires *both* positive and negative columns to carry evidence; **§17-1 additionally requires no row blank and none marked "expected."** Rows 1 and 8 are **failing**, not blank — they satisfy §17-1 while failing on merit.

---

# 13 · FINDINGS REGISTER

| ID | Finding | Introduced | Severity | Evidence | Disposition |
|---|---|---|---|---|---|
| **AF-03** | 46 production-CDN refs in staging DB config → 12 production objects | Pre-existing | Medium | §10.4 | **ACCEPTED** as D-5. Data-side scan → G11 |
| **AF-11** | `_headers` ACAO moved apex → `www` under a de-hardcoding commit, undeclared | Candidate | Medium | §7.2 | **OWNER RULING REQUIRED** — §22 D-8 |
| **AF-13** | Android version records contradict across 4 repository sources (1005/1010/1073/1102/1110; 1.1.1 vs 1.2.16). **No repository source authoritative** | Pre-existing | Low | `android-build.yml`, `ANDROID_RELEASE_RUNBOOK.md` | **N/A this release** (web-only) → G11. Only Play Console is authoritative |
| **AF-14** | **Ledger-closure deadlock** — §11 requires a closed ledger for Phase 7, but the ledger could not close until CHG-003 merged, which occurs at Phase 8 *after* approval | Process defect | Medium | §11 vs §9.4 | **RESOLVED** by removing CHG-003 from scope: PR #103 is **not in T** (§2). No longer blocking |
| **AF-15** | ~~🔴 THE UI GATE IS RED ON THE CANDIDATE~~ → **FIXED 2026-08-29.** 9 problems / 148 screenshots, 3 scenes × 3 mobile viewports | **Candidate — `e7dbf51`** | **HIGH** | §13.1 below | ✅ **RESOLVED** by `bfcb68da` + `c8aec5d5`. Owner ruling D-9 = **"fix it first"**. Reproduced, fixed, controlled, pinned |
| **AF-16** | Same logical migration carries different version integers per lane (`…144927` staging / `…145345` production) | Pre-existing | Low | §6.2 M1 | **RECORD ONLY.** `schema_migrations` is keyed on version, so the lanes cannot be compared by version alone |
| **AF-17** | 🔴 **PRODUCTION IS MISSING TWO RLS POLICIES** on `ad_creative_comments`: banned members may comment on ads; a hidden ad's thread is readable by any signed-in member | Pre-existing (gap since `20260811120000`) | **HIGH (latent)** | §6.2 M2 — `pg_policies` both lanes | **ACTION REQUIRED** — §24.3. Fix exists and is applied on staging; **live exposure today = 0** |
| **AF-20** | ⚠ **The gate named "Secret scan (FULL HISTORY)" does not scan full history.** CI restricts it to `--no-merges --first-parent <range>`. An unrestricted scan of the same repository returns **23 findings across 6 commits, 2026-07-09 → 2026-08-05** — every one of them **outside** the range CI checks | Pre-existing control-scope gap | **Low (name/scope mismatch)** · **no real secret found** | §13.3 below | **RECORD ONLY** — not a release blocker. Carried to G11 |
| **AF-19** | ~~🔴 SECRET SCAN FAILS~~ → ✅ **FIXED.** The allowlist covered only the **production** anon key; the **staging** anon key added by the lane-aware CI commit was never added | **Pre-existing — commit `ccd5e423`, 2026-08-22.** NOT introduced by any 2026-08-29 commit | **Medium** | §13.2 | ✅ **RESOLVED** by `a42b209e`. Verified with real gitleaks 8.24.3 + control + mutation test |
| **AF-18** | `main`'s `apply-migration.yml` has `environment:` **commented out** — no lane gate, no ref assertion on the production lane | Pre-existing | **HIGH** | §9 | **CLOSED BY THIS PROMOTION** — the merge installs the gate |

## 13.1 AF-15 in full — the UI gate failure

**Measured output, verbatim, from run `33232872781` job `99048633354`:**

```
layout: tap targets too small (6): button.cursor-pointer.inline-flex 45x20,
  button.cursor-pointer.inline-flex 24x20, button.cursor-pointer.inline-flex 69x16,
  button.cursor-pointer.inline-flex 16x20, button.cursor-pointer.inline-flex 24x20,
  button.cursor-pointer.inline-flex 16x20

layout: tap targets too small (2): button.cursor-pointer.inline-flex 16x20,
  button.cursor-pointer.inline-flex 69x16
```

**Affected:** `journey-create-from-feed`, `screen-feed`, `screen-post-detail` × `android-360`, `iphone-390`, `app-360`. **Desktop-1280 passes on all three.** Summary line: `148 screenshots, 9 problem(s) reported.` · `baseline diff: clean against 148 recorded scene/viewport keys.` · `[ui:gate] FAIL (exit 1)`

**Root cause — traced to the exact diff.** `e7dbf51` changed, in `ReactionSummaryTooltip.tsx`:

```diff
- <div onClick={handleOpen} className="cursor-pointer">
+ <button type="button" onClick={handleOpen}
+   aria-label={`See who reacted (${totalCount})`}
+   className="cursor-pointer inline-flex items-center">
```

The gate's selector `button.cursor-pointer.inline-flex` matches this element exactly. **Class: VERIFIED.**

**The honest reading — this is a net accessibility IMPROVEMENT that trips a gate.**

- **Before:** a `<div onClick>` — no role, no tabindex, no accessible name. The Reactions dialog was openable **by mouse only**: not reachable by Tab, not announced, not operable by Enter or Space. The targets were **already 16–20px**; as `<div>`s they were **invisible to the gate's tap-target checker**, which measures interactive elements.
- **After:** a real `<button>` — keyboard-reachable, screen-reader-announced, count preserved in the accessible name. The targets are **still 16–20px**, but now **measured**, and they fall far below the project's own **44px floor** (the floor 4 dedicated commits were spent establishing).

**So the change did not shrink anything.** It converted a *hidden* defect (unreachable control) into a *reported* one (reachable but too small). **The gate is behaving correctly; the tree is genuinely below the project's own standard on mobile.**

**Also true:** `baseline diff: clean` means no scene or control went missing — this is a layout-quality failure, not a disappearance.

### ✅ RESOLUTION — owner chose "fix it first" (D-9), executed 2026-08-29

**The rule, read from the gate rather than assumed** — `tools/uishot/capture.mjs:412`:

```js
if (long < 44 || short < 32) small.push(...)   // long = max(w,h), short = min(w,h)
```

**It is NOT 44×44.** The requirement is **long ≥ 44 AND short ≥ 32** — a relaxation the owner
approved earlier so a deliberately-narrow 32×44 control passes. The rect is
`getBoundingClientRect()`, which **includes padding**.

**The fix** — both trigger buttons gain `h-12 px-2.5`:

| | before | after | long | short | verdict |
|---|---|---|---|---|---|
| like count (narrow) | 16×20 | 36×48 | 48 ✓ | 36 ✓ | pass |
| like count | 24×20 | 44×48 | 48 ✓ | 44 ✓ | pass |
| like count (wide) | 45×20 | 65×48 | 65 ✓ | 48 ✓ | pass |
| reaction break-up | 69×16 | 89×48 | 89 ✓ | 48 ✓ | pass |

`h-12 px-2.5` is **the exact box the Comment and Share buttons in `PostActionRow` already use**, so
the row gains one consistent shape rather than a third. **The row is already 48px tall because of
those siblings, so the height costs no layout at all.**

**BOTH files, not one.** `ShareSummaryTooltip.tsx` carried the **identical** trigger and was *not*
reported by the gate only because every fixture scene has `shareCount` 0, so its trigger never
rendered. **It would have gone red the first time a post was shared.** Fixed in the same commit.

**Verified locally against the real sweep, with a control:**

| Run | Result |
|---|---|
| **With the fix** | `exit 0` · **12/12 scene×viewport pass** · **zero** tap-target problems |
| **Control — fix removed** | `exit 1` · the same six failures reproduce (`45x20, 24x20, 70x16, 16x20, 24x20, 16x20`) |

*(CI reported `69x16`, local reproduced `70x16` — a 1px sub-pixel difference between runners, not a
discrepancy in the finding.)*

**⚠ Honest note on the first local attempt:** it initially reported "no tap-target problems" while
the page had **not rendered at all** (`pageerror: supabaseUrl is required` ×12). That was a false
pass, caught and discarded. The environment was corrected to the dummy values CI itself uses
(`.github/workflows/ui-gate.yml:123-125`) before any result was believed.

**Pinned:** `src/components/__tests__/SummaryTriggerTapTarget.test.ts` — 11 assertions across both
components. **Mutation-tested:** removing `h-12 px-2.5` fails 2 assertions.

**The pin strips comments before matching.** Both components' headers *quote* the old
`<div onClick={handleOpen} className="cursor-pointer">` markup, so a naive source match fails on the
documentation instead of the code — the same trap this repo hit before with a guard that matched
`|| true` inside its own comment. Caught during authoring, not after.

**Full suite after the fix: `tsc` clean · 178 files passed, 1 skipped · 2,475 tests passed, 1 skipped.**

**✅ CONFIRMED IN CI, not only locally.** UI gate on `staging`:

| Run | Commit | Result |
|---|---|---|
| **#124** | `c8aec5d5` (the pin) | ✅ **completed successfully** |
| **#123** | `bfcb68da` (the fix) | ✅ **completed successfully** |
| #122 | `25c0456` | 🔴 failed |
| #121 | `c8dc83b` | 🔴 failed |
| #120 | `e7dbf51` | 🔴 failed |

**The red streak that began at `e7dbf51` is broken. The gate is GREEN on the candidate.**

**Commits:** `bfcb68da` (fix, both components) · `c8aec5d5` (the pin).
**Consequence:** T moved `25c0456` → `c8aec5d5`. **`RC-20260829-01` is void; the candidate is now
`RC-20260829-02`.** This is the tree-immutability rule of §3.4 operating as designed, not a defect.

## 13.2 AF-19 in full — the failing secret scan

**Measured from run `33241906543`, job `99072570195`, on merge commit `9faf5a17`.**

```
RuleID:      jwt
Entropy:     5.544294
File:        .github/workflows/web-build.yml
Line:        125
Commit:      ccd5e423bf92742d98f7d1fbe4869594a11e0832
Author:      Claude <noreply@anthropic.com>
Date:        2026-08-22T11:19:08Z
Finding:     ...SE_PUBLISHABLE_KEY: <REDACTED>
leaks found: 1
```

**Provenance — this is NOT a 2026-08-29 regression.** Commit `ccd5e423` is *"ci: lane-aware CI for
the staging and production lanes"*, dated **22 August** — item **32** (the oldest) in the commit
manifest of §5.4. None of today's commits (`bfcb68da`, `c8aec5d5`, `5a700d91`, `fe4505aa`,
`9faf5a17`) contain it.

**Why it started failing only now.** The scan runs `gitleaks detect --log-opts="--no-merges
--first-parent <range>"`. Merging `main` into `staging` changed the first-parent history, so the
scanned range now reaches back through `ccd5e423`, which earlier runs did not cover. **The defect
was always in the tree; the scan window moved onto it.**

**Present on BOTH lanes** (measured, values redacted):

| Branch | Occurrences in `web-build.yml` |
|---|---|
| `staging` | **2** — lines 74 and 155 (one per lane) |
| `main` | **1** — line 54 |

### What the value actually is — and why this is not a credential incident

It is a Supabase **publishable (anon) key**. `PROJECT_MASTER_RECORD.md` §9 classifies it verbatim as
**public-safe**, and by construction it ships inside **every browser bundle** the site serves. It is
not the service-role key, not `SUPABASE_DB_URL`, and not an R2 credential. **Nothing here requires
rotation under §14 HS-10**, and this ledger does not record it as an exposure.

**But the project's own gate disagrees**, because gitleaks' generic `jwt` rule matches on shape and
entropy, not on whether a key is meant to be public. **A red gate that everyone knows to ignore is
the failure mode this whole programme exists to prevent** — so it is raised rather than waved
through.

**Does it block the merge?** **No, not mechanically.** Branch protection on `main` requires a pull
request and blocks force pushes; **"Require status checks to pass" is NOT enabled** (§9, verified).
GitHub therefore reports **"Able to merge"**. Whether it *should* block is the owner's call.

### ✅ RESOLUTION — root cause found and fixed, 2026-08-29 (`a42b209e`)

**The root cause is not a leaked secret. It is an allowlist written for one lane and never extended
to two.**

`.gitleaks.toml` already pinned the **production** anon key by exact literal, with a header
explaining it is public by design. `ccd5e423` gave `web-build.yml` a **second lane** and therefore a
**second anon key** — staging's — and **the allowlist was never extended**. That key sat in the tree
as an unallowlisted JWT from 22 August.

**Measured, both tokens decoded from their JWT payloads:**

| Token | `role` | `ref` | In allowlist before | After |
|---|---|---|---|---|
| production | **`anon`** | `jtdtehuqtinjxropkkcn` | ✅ yes | ✅ yes |
| staging | **`anon`** | `ztzutckwdhetphwghuzj` | ❌ **no ← the finding** | ✅ yes |

**Neither is a `service_role` key.** An anon key is public by construction — it ships in every
browser bundle and every table behind it is RLS-guarded. **No rotation is required, and none should
be performed** (§14 HS-10 does not apply): rotating an anon key churns every client and buys no
security.

### Verified with the real binary, with a control

**gitleaks 8.24.3 — the exact version CI runs — on the exact CI range:**

| Run | Result |
|---|---|
| **Without the fix** | 🔴 `leaks found: 1` |
| **With the fix** | ✅ `no leaks found` |

### Mutation-tested, so the allowlist cannot be over-broad

A synthetic JWT with `role="service_role"` against the same project ref, placed in a file and scanned
with the **new** config: **still caught — `leaks found: 1`.**

**Only the two exact anon literals pass. Any other JWT — including a service-role key, and including
a rotated anon key — still fails**, exactly as the config's own header promises. The fix teaches the
scanner one true fact; it does not blunt it.

**CI confirmation:** PR #104 went from **2 failing** to **ZERO failing** checks.

**D-11 did not need an owner ruling after all.** The three options in REV-6 all assumed the finding
was a true positive to be accepted or worked around. It was neither: it was a **gap in the
allowlist**, and closing the gap is a fix, not a deviation. **No deviation is carried and nothing is
signed away.**

---

## 13.3 AF-20 — the "full history" scan is not full history

**Measured 2026-08-29 with gitleaks 8.24.3 on candidate `d06b0379`.**

| Scan | Result |
|---|---|
| **As CI runs it** (`--no-merges --first-parent <range>`) | ✅ **no leaks found** |
| **Unrestricted, whole repository** | ⚠ **23 findings, 6 commits, 2026-07-09 → 2026-08-05** |

**Every one of the 23 predates the candidate window** (which begins 2026-08-22). **None is
candidate-introduced.**

### What the 23 actually are — each checked, no value printed

| Rule | Count | Assessment |
|---|---|---|
| `jwt` ×3 — `.github/workflows/test-agent.yml`, `scripts/test-agent/run-checks.mjs` | 3 | **Decoded: `role="anon"`, ref `isywidnfnjhtydmdfgtk`** — a *third* (test-agent) project's anon key. Public by design, same class as AF-19 |
| `gcp-api-key` — `google-services.json` | 1 | `PROJECT_MASTER_RECORD.md` §9, verbatim: *"Firebase client config … **client config, not a secret**"* |
| `generic-api-key` — source, tests, migrations, a `.lovable` memo | 19 | gitleaks' loosest rule, firing on long identifiers (stage keys, UUIDs). **Not individually adjudicated** — see the honest limit below |

**No evidence of a real secret in history was found.** Every finding that could be identified
resolves to a value the project already documents as public.

### The actual finding is the name, not the secrets

A gate called **"Secret scan (full history)"** that scans a **commit range** is a gate whose name
overstates its coverage. That mismatch is exactly the class of defect this programme exists to
catch — and it is also **why AF-19 hid for a week**: the range simply never reached `ccd5e423`.

### Honest limits

- The 19 `generic-api-key` findings were **classified by rule and file, not individually opened**.
  Calling them false positives is **INFERRED** from the rule's known noisiness and the file types,
  **not VERIFIED** one by one.
- This is therefore **not** a statement that the repository's history is clean. It is a statement
  that **nothing identifiable is a real secret**, and that **the gate's scope is narrower than its
  name**.

**Disposition: RECORD ONLY.** Not a release blocker — the CI gate passes honestly on what it
scans, and nothing found is a live credential. **Carried to G11:** either widen the scan and
adjudicate the 23, or rename the gate to state its true scope.

---

---

# 14 · CONTRADICTION / CORRECTION REGISTER

> Previous conclusions are **preserved, not overwritten.**

| ID | Previous claim | Source | New evidence | Corrected conclusion | Impact |
|---|---|---|---|---|---|
| **C-1** | *"Token scope is not readable after creation, so this is OWNER-ATTESTED by construction"* | MEP §8.6 | Token detail page read 2026-08-29; scope is permanently visible | **The premise is FALSE.** The *secret* is unreadable; the *scope* is readable | The entire justification for A.5's runtime test as a "compensating control" is void |
| **C-2** | Compiler stated *"205 commits"* between the branches | This session, 05:10Z | Full unshallowed clone: `git rev-list --count` = **32** | **32 commits.** 205 was a shallow-clone artifact | File count (135) and line counts were correct throughout; only the commit figure was wrong |
| **C-3** | Compiler recommended **"Option A (accept scope observation) — recommended"** for G8 | This session, 05:30Z | 08-27 signing pack marks C-1 *"intentionally left unsignable"* and requires control 3 re-run **before any substitution ruling** | **Recommendation WITHDRAWN.** A prior substitution ruling on this gate was already withdrawn once | Owner must waive the precondition **explicitly** — §23 |
| **C-4** | `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` described as *"orphan — no forward migration"* | 08-27 prep ledger | `schema_migrations`: `20260820180836 classf_repoint_originals` **applied in production** | Accurate **as to this RC**; the forward migration **does exist and is applied** | Its G11 disposition is a rename, not an investigation |
| **C-5** | *"CHG-G10-003 (PR #103) blocks ledger closure"* (AF-14 deadlock) | 08-27 prep ledger | `704ad57` is **not an ancestor of `staging`**; PR #103 body says *"Do not merge"* | **PR #103 is not in T.** The deadlock dissolves — it was never in this candidate's scope | AF-14 downgraded from blocker to resolved |
| **C-6** | RC-20260826-01 (`e2e05fbb`) treated as the promotion candidate | 08-26/27 audit set | 7 commits landed since; owner elected current `staging` | **RC-20260826-01 is VOID.** Candidate is `25c0456` | The 08-26/27 audit does **not** cover 7 of the 32 commits, incl. the one that broke the UI gate |
| **C-11** | Five **active** inconsistencies at REV-15, all introduced or left by the compiler: (a) the document's **closing footer** — *"`main` unchanged at `b671e1fb`. **T unchanged at `25c0456`**"* — present in every revision to REV-15; (b) §26 blocker 9 — *"**ROUNDS 1 AND 2** COMPLETE"* / *"**Neither round** reviewed the 138 changed files"*; (c) §26 heading — *"READY FOR APPROVAL — **THREE prerequisites**"*, reading as three still outstanding when B11 was already closed; (d) ***"runbook runbook §5.3"*** ×3, from two overlapping find-and-replaces at REV-14; (e) §26's *"Progress at REV-12"* paragraph saying *"one **vacant** audit (§25)"* with no historical label | REV-1…REV-15 (a); REV-14 (b, d); REV-15 (c); REV-12 (e) | **Independent audit round 4.** (a) is a **self-contradiction**: C-8 and §3.1 record `25c0456` as **void**, so the closing line asserted an identity §3 denies. (b) three rounds exist, not two. (c) B11 closed at 11:42Z. (d) compiler error. (e) §25 is **PARTIAL**, not vacant | **All corrected at REV-16, prior wording preserved.** Footer now reads *"Application/code RC remains `a42b209e…`; only `docs/PROMOTION_LEDGER.md` changed afterward"*; blocker 9 cites **three** rounds; §26 reads *"three-item resolution record; item 1 (B11) closed; **two prerequisites remain**"*; the duplication removed; the REV-12 paragraph labelled **HISTORICAL** | **Four of the five were cosmetic; one was a real contradiction.** That ratio is the finding: **corrections have converged to near-zero substance while cost per round has not fallen** — every revision re-triggers 17 CI runs and invalidates the head the previous audit measured. **This ledger had begun auditing itself instead of the release.** Answered structurally by the **§28 documentation freeze**, and by **D-13** (§25.7) granting the auditor read-only access, since a repository-only auditor can only ever return repository findings |
| **C-10** | REV-14 §3.5 rule 1: *"The compiler searched all **138** changed files … **Four files reference `docs/` and all four references are comments** … **No file read, import or glob of a `docs/` path was found** … **the narrowing is a precaution, not a response to a demonstrated failure**."* Repeated in the §25.5 additions list and the REV-14 revision row | REV-14, written by the compiler | **Independent audit round 3** (§25.6): **10** changed files reference `docs/`, at least one **executable** — **`src/__tests__/candidatePatternWidening.test.ts` reads `docs/CANDIDATE_PATTERN_AUDIT.md`**; the wider repository holds further consumers. **Compiler re-derivation with the corrected instrument:** that file **is** among the 138, is **463 lines**, and contains a `docs/` path adjacent to a file reader — ✅ **CONFIRMED**. A whole-file scan of **40 of 138** (tests, scripts, workflows, configs) found **5** referencing `docs/`, **1 executable** — a **lower bound, not a total**. **The figure 10 is the auditor's and is NOT restated as a compiler measurement.** ⚠ The offending file's **contents could not be read** — the fetch is refused by a content filter, consistent with a secret-pattern test carrying sample credential strings; confirmation is therefore **by property test, not by reading the code** | **The statement was FALSE and is preserved verbatim, struck through, in §3.5 rule 1 and §25.5 — not replaced.** The **rule stands as narrowed**; its stated reason is corrected — the broad `docs/`-only exception would have been unsafe for a **DEMONSTRATED** reason. What the rule now rests on: every commit after `a42b209e` changes only `docs/PROMOTION_LEDGER.md`, and **no executable consumer of that one file was found** — the sole reference is a **comment in `.gitleaks.toml`**. **New §3.5 rule 6: every search declares its scope.** Also corrected: REV-14's *"exactly two prerequisites"* while the B11 decision was open — **three** are now stated (§26), of which B11 is resolved | **Root cause: the instrument, not the arithmetic.** The search read **diff hunks**, not **file contents**; a diff shows only changed lines, so a reference in an untouched part of a changed file is invisible. **A wrongly-scoped search returns a confident, clean, false answer.** Third compiler error in three audit rounds, all one shape — **conclusions stated above the confidence the instrument supports** — named as a pattern at §25.6.1 rather than filed as three unrelated slips |
| **C-9** | Nine claims left **active** at REV-13, four of them **written or left standing by the compiler at REV-13 itself**: (a) §5 — *"135 files: 29 added · 106 modified · 0 deleted … **Class: VERIFIED**"*, headings ADDED (29) / MODIFIED (106) / Commit manifest (32), and the repro command `git diff --name-status b671e1fb 25c0456`; (b) §27 rows 1, 2, 10, 20, 21 — *"135 = 29 A + 106 M"*, *"32 enumerated + 2 main-only"*, *"D-8, 9, 10 **OPEN**"*, *"§25 **vacant**"*, *"§23 **all unsigned**"*; (c) §3.2 — non-`docs/` files **137**; (d) §3.5 rule 1 — *"a commit touching only `docs/` is a governance commit"*; (e) §25.4 — six-item list not mapped to the §25.3 rows, silent on whether owner re-measurement closes them; (f) §25.1 — did not say the audit excludes the application code; (g) §3.3 — headed *"CI state at **T**"* where `T` = the **void** `25c0456`; (h) the *"§5.3 probe"* references, colliding with **this ledger's own §5.3** (a file manifest); (i) §17.1 heading + the **owner-signed** §23.1 binding naming **`d06b0379`** as the RC | REV-13 · items (a)–(f) at REV-13, (g)–(i) inherited | **Independent audit round 2** (§25.5) found (b)–(f). **Compiler sweep at REV-14** found (a), (g), (h), (i). Re-measured 11:05Z: **138 files = 31 A + 107 M + 0 D**, `docs/` = **2** (`DECISIONS.md`, `PROMOTION_LEDGER.md`), **non-`docs/` = 136**; **46 commits / 44 excluding merges**; **+9,680 / −1,293**; **17 checks — 15 success, 2 skipped, 0 failing** at `393bc558`. Delta from the `25c0456` enumeration is exactly **5 files** and reconciles: 135 + 2 A + 1 newly-M = 138 | **All corrected at REV-14.** §5 gains §5.0 (current) + §5.0.1 (exact 5-file delta) instead of a 138-row retype; §27 restated with a basis line and rows 20/21 **split** (owner decisions RULED vs §11 approval UNSIGNED); §3.2 non-`docs/` → **136**; §3.5 rule 1 narrowed to **`docs/PROMOTION_LEDGER.md` only**; §25.4 rewritten with **one row per §25.3 instrument** and a **closure rule** (owner re-measurement is OWNER-ATTESTED, **not** an audit); §25.1 states the audit **excludes the 138 changed files and the test suite**; §3.3 re-based off the void SHA; references relabelled **"runbook §5.3"**. **§17.1/§23.1: the signed text is NOT edited** — a correction is attached and the re-signature is put to the owner (§26). Prior wording preserved in place | **Root cause: fixing only the sections an auditor names.** C-2, C-6, C-8 and C-9 are one failure four times — a figure written without its basis, then carried. Three audit rounds each found stale actives the last missed. **New §3.5 rule 5 — every figure carries its basis or is marked historical — plus the REV-14 sweep, exist to prevent a C-10 of this shape** |
| **C-8** | Five linked identity/scope claims, all carried as **VERIFIED** through REV-12: (a) §1 **RC SHA `d06b0379…`**, tree `f4616fb6…`; (b) §3.1 **`25c0456…` as the "immutable candidate"**, tree `51616b21…`; (c) §3.2 **32 commits · 135 files · +7,711 / −1,280**, and three-dot **151 files / +10,795 / −1,578**; (d) §4.2 ***"`main` carries 2 commits absent from `staging`"***; (e) PR #104 title ***"— 32 commits"*** | REV-1 … REV-12 | Independent audit 2026-08-29 (§25.1) + compiler re-measurement 10:40–10:45Z. **`main` is now an ANCESTOR of `staging`** (merge `9faf5a17`). Head at audit `fe63e944`, tree `5b00b690…`. `main…staging` = **45 commits counting merges / 43 excluding** · **138 files** (31 added, 107 modified, 0 deleted) · **+9,494 / −1,293**. And, found by the compiler and **not** by the auditor: **`d06b0379` is a docs-only commit — the REV-7 ledger save.** `git diff a42b209e...fe63e944` = **one file, `docs/PROMOTION_LEDGER.md` only** | **All five corrected at REV-13.** Application RC is **`a42b209e…`**; application scope is **+9,060 / −1,293** (the extra 434 lines are this ledger); identity is now recorded in **two layers** (§3.1) under a **freeze rule** (§3.5); ancestry corrected (§4.2); PR title corrected. **Previous values preserved in §3.1, §3.2, §4.1 and §4.2, not deleted** | **Root cause: the ledger lives inside the repository it describes, so recording the head changes the head.** Fixed structurally by §3.5, not by re-measuring. Every earlier revision was self-invalidating on save; C-8 is the first revision that says so |
| **C-7** | Compiler drafted a G9 countersignature and rollback binding as *"ready to sign"* | This session, 05:55Z | Both assert *"I have read…"* facts only the owner can attest | **Not signable by the compiler, and not pre-attestable.** Drafts remain drafts | §23 signatures stay open |

---

# 15 · QA / TEST-DATA MUTATION LEDGER

**Source:** `G10_CHANGE_LEDGER_CLOSED_2026-08-27.md`. **Class: OWNER-ATTESTED / INFERRED — not re-measured today** except where noted.

| ID | Mutation | Lane | Class | Before → After | Disposition |
|---|---|---|---|---|---|
| CHG-G10-001 | PR #102 → `staging`, 9 files | staging repo | INTENDED | — | ✅ Applied & verified |
| CHG-G10-002 | ACL remediation, 252 statements, 76 signatures | staging DB | INTENDED | fingerprint `ab26c06a…` identical both lanes | ✅ Applied & verified |
| CHG-G10-003 | PR #103 — arm production isolation host rules | repo | INTENDED | — | **WITHDRAWN from this RC** (C-5) |
| CHG-G10-004 | Friendship row +1 (Flow 6) | staging DB | INTENDED | 0 → 1 | Retained as QA evidence |
| **CHG-G10-005** | **Story row +1** | staging DB | **TEST/HARNESS** (reclassified) | 0 → 1 · `expires_at` 2026-08-28T05:19:25Z (**passed**) · **no reaper exists** | **WAIVED** — ruling written 08-27, **signature line still blank** (§23) |
| CHG-G10-006 | Test post +1 (Flow 1) | staging DB | INTENDED | 0 → 1 | Retained |
| CHG-G10-007 | Reaction +1 (Flow 5) | staging DB | INTENDED | 0 → 1 | Retained |
| CHG-G10-008 | Comment +1 (Flow 4) | staging DB | INTENDED | 0 → 1 | Retained |
| CHG-G10-009 | Notification fan-out +513 | staging DB | INTENDED (consequence of 006) | 0 → 513 | Retained |

**All RLS write tests ran inside rolled-back transactions and left zero residue.**
**Disclosure retained verbatim:** CHG-005 arose when a QA file-upload landed in the page's **Story** input rather than the composer — the composer's file input is the *second* on that page. Detected from the "Story added!" toast, confirmed in the database, disclosed immediately. **Carried to G11:** the duplicate-file-input hazard.

**Mutations by THIS session (2026-08-29):** **NONE.** All database access was `SELECT`-only; all Cloudflare and GitHub access was read-only except the creation of PR #104 (§19.1).

---

# 16 · PRODUCTION WRITE LEDGER

> Stated separately and not folded into any other section.

| Category | This session | Whole release cycle | Class |
|---|---|---|---|
| **Production DB writes** | **NONE** — every query `SELECT` (`schema_migrations`, `pg_policies`, row counts) | **NONE** — §15 records zero production rows written | **VERIFIED** |
| **Production R2 writes** | **NONE** | **NONE** — `isolation-probe/` prefix returns 0 objects (§10.3); run `33079091310`'s production `PutObject` was **denied** | **VERIFIED (after-state)** |
| **Production application writes** | **NONE** | **NONE** | VERIFIED |
| **Financial actions** | **NONE.** No trade, transfer, payment or wallet operation. The 5 financial edge functions are a **POLICY EXCLUSION** and were never invoked | **NONE** | **VERIFIED** |
| **Secret exposure** | **NONE.** No secret value read, requested, displayed or stored. §7 records scopes and names only | ⚠ **ONE PRIOR EXPOSURE** — see below | **VERIFIED (this session)** |
| **Production deployment** | **NONE** | **NONE — NOT PROMOTED** | VERIFIED |
| **Production edge-function deploy** | **NONE** | **NONE** — functions do not auto-deploy from GitHub | VERIFIED |

**⚠ Historical secret exposure, retained on the record.** `G9_CLOSURE_FINAL_2026-08-24.md` BLOCKER-2: a query selected the whole `s3_storage_settings` JSON, **placing the staging R2 secret access key in a session transcript.** The token was rotated in response — which is why `staging-upload` is only days old. §14 **HS-10** treats any recurrence as a hard stop. **This is the reason no session may execute the A.5 runtime test.**

---

# 17 · ROLLBACK CONTROL

## 17.1 Database rollback set

> ### ⚠ CORRECTION ATTACHED AT REV-14 (C-9) — THE SIGNED BINDING NAMES THE WRONG SHA
>
> This section was headed **"RC-20260829-01"**, and the **owner-signed** B11 binding at §23.1 reads
> *"the database rollback for candidate `d06b0379776aef94d006d78b1de37a0cda685927`"*. **C-8
> established that `d06b0379` is a docs-only commit — the REV-7 ledger save — not a code RC.**
>
> **The compiler has NOT edited the signed text, and will not.** A signature covers the words that
> were signed. This note is attached beside it instead.
>
> **What is and is not affected:**
> - **The rollback set itself is unaffected.** It is defined by **six named files**, not by a SHA,
>   and those six files are identical in `d06b0379` and in the code RC `a42b209e` — every commit
>   between them touches only `docs/PROMOTION_LEDGER.md` (§3.1 Layer 1).
> - **The owner's ruling is unaffected.** B11 was a ruling on *which files roll back what*, and the
>   owner was shown the substantive limitations before signing (§23.1).
> - **The identifier in the signed text is wrong** and would mislead anyone reconstructing the RC
>   from the binding alone.
>
> **⚠ OWNER DECISION REQUIRED — not taken by the compiler.** Either (a) re-sign B11 naming
> `a42b209e4f70a6efed4f3dcdb654e0f994416594`, or (b) let the signature stand with this correction
> attached. **Neither option is exercised here.** Recorded as an open item in §26.

Execute in **reverse migration order**, via `apply-migration.yml`, `target=production`, dispatched from `main`:

Execute in **reverse migration order**, via `apply-migration.yml`, `target=production`, dispatched from `main`:

| Order | File | Forward migration | Tested? |
|---|---|---|---|
| **0** | `20260828082136_ad_comment_ban_and_visibility_policies_ROLLBACK.sql` | M2 (§6.2) | ❌ **never executed** |
| 1 | `UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql` | applied prod `20260825115208` | ❌ never executed |
| 2 | `UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql` | applied prod `20260825115116` | ❌ never executed |
| 3 | `UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql` | applied prod `20260825115030` | ❌ never executed |
| 4 | `UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql` | applied prod `20260825092152` | ❌ never executed |
| 5 | `20260824145345_admin_user_lookup_by_email_ROLLBACK.sql` | applied both lanes | ❌ never executed |

**⚠ CHANGED FROM THE 08-27 BINDING:** that binding named **five** files. This RC adds **M2's rollback at order 0** — it must run **first**, because M2 was applied last. **Signing the 08-27 five-file binding would leave M2 un-rollbackable.** *(REV-13 and earlier cross-referenced this to "§14 C-8" — a wrong reference: C-8 is the identity/scope correction. The five-vs-six-file change is recorded at §23.1 and REV-10. Corrected at REV-14, C-9.)*

**EXCLUDED:** `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` — its forward migration (`20260820180836`) is applied in production but is **not part of this RC**.

## 17.2 Limitations — stated plainly

- **The entire set is prepared and reviewed but NEVER EXECUTED against a live database.**
- §17-9's Pages-deployment rollback covers **the web bundle only** — it does **not** cover schema.
- M2's rollback **reopens both security gaps** by design; its own header says so. It is not a safe default.
- **No rollback exists for the merge itself** beyond `git revert` of the merge commit, which does not un-apply migrations.

---

# 18 · PRE-PROMOTION SNAPSHOT — 2026-08-29T08:45Z

> **HISTORICAL SNAPSHOT — do not read as current (§3.5 rule 5).** Taken at 08:45Z. The `RC SHA (T)`
> line below names `d06b0379`, which **C-8 established is a docs-only commit**, not the code RC; the
> code RC is `a42b209e` (§3.1). The snapshot is retained **as taken**, uncorrected, because that is
> what a snapshot is. **`main SHA` is the one line still true today.** A fresh snapshot must be taken
> at the freeze point (§24.1 step 7).

```
RC SHA (T)          d06b0379776aef94d006d78b1de37a0cda685927
T tree              f4616fb680f863d1141491d9ab5f3b619c048f4b
promotion merge base 9faf5a17  (parents fe4505aa + b671e1fb)
main SHA            b671e1fb0c5bcf145d442076c229eca888afd674   ← UNCHANGED all session
main is ancestor    YES  (conflict resolved 08:05Z, D-6)
working tree        clean
PR #104             "Able to merge" — no conflicts

CI ON THE CANDIDATE — ALL GREEN
  Typecheck                             pass
  Web build / staging lane              pass
  Web build / lane resolves to one      pass
  Security / dependency vulnerabilities pass
  Security / own security rules         pass
  Security / Secret scan (full history) pass   9s   (was RED — AF-19)
  UI gate / every control reachable     pass   7m   (was RED — AF-15)
  Cloudflare Pages (staging)            deployed
  failing checks                        ZERO

LOCAL VERIFICATION ON d06b0379
  tsc --noEmit                          exit 0
  vitest                                178 files, 2,475 passed, 1 skipped
  gitleaks (CI range)                   no leaks found
  gitleaks (unrestricted)               23 findings, all pre-candidate — AF-20

DATABASE
  new migrations in promotion           2
    20260824145345  applied BOTH lanes            (net effect: none)
    20260828082136  applied STAGING ONLY  ← D-10, must run post-merge
  production ad_creative_comments RLS   7 policies  (staging: 9)
  live exposure of the 2 missing policies  ZERO (0 hidden creatives, 0 banned members)

SECURITY POSTURE
  branch protection protect-main        ACTIVE, bypass EMPTY, PR required, force-push blocked
  SUPABASE_DB_URL                       production Environment only; absent at repo level
  repo secrets                          4, all ANDROID_*
  R2 token staging-upload               1 policy, 50mm-staging only, no expiration
  production R2 isolation-probe/        0 objects

APPROVAL
  tags in repository                    0
  §11 Release Approval Record           UNSIGNED
  §25 independent audit                 NOT PERFORMED
```

---

---

# 19 · PROMOTION RECORD

## 19.1 Actions taken by this session

| Action | Detail | Reversible? |
|---|---|---|
| **PR #104 created** | base `main` ← head `staging`; title *"Promote staging to main — 32 commits…"*; PROVE block completed with evidence classes; actor `altisinfonet` | ✅ Yes — closing the PR lands nothing |

**PR #104 changes nothing on `main`.** It is a reviewable proposal. **No merge, no tag, no deployment, no migration dispatch has occurred.**

## 19.2 Promotion — **NOT PERFORMED**

| Field | Value |
|---|---|
| Approval | ❌ **NOT GIVEN** — §11 record unsigned |
| Tag | ❌ **NONE** — repository holds **0 tags** |
| Merge SHA | ❌ does not exist |
| Actor | — |
| Timestamp | — |
| Deployment | ❌ does not exist |

---

# 20 · POST-PROMOTION RECONCILIATION

**`APPROVED RC → PR → MERGE → BUILD → DEPLOYMENT → PRODUCTION`**

| Link | State |
|---|---|
| APPROVED RC | ❌ not approved |
| PR | ✅ #104 exists (conflicted) |
| MERGE | ❌ not performed |
| BUILD | ❌ not performed |
| DEPLOYMENT | ❌ not performed |
| PRODUCTION | ❌ unchanged — still `b671e1fb` |

**Nothing to reconcile. This section is intentionally empty of assertions.** At promotion it must record: merge SHA; tree equality of the merged tree against the tag created **before** the merge (§17-11); build run ID; deployment ID; and the production-served commit.

**Expected tree after conflict resolution ≠ `51616b21`.** Resolving the certificate conflict produces a merge commit whose tree differs from both parents. **Tree equality must therefore be asserted against the tag created at approval time, not against T.**

---

# 21 · UNAUTHORIZED-CHANGE CHECK

| Category | Finding | Class |
|---|---|---|
| Unexpected files | **NONE.** All 29 additions map to a named commit and a stated purpose (§5.1) | VERIFIED |
| Unexpected commits | **NONE.** All 32 enumerated (§5.4). The `ec1a3b9`/`44e3e92` pair is a deliberate prove-then-revert with net-zero effect | VERIFIED |
| Unexpected migrations | **ONE REQUIRING NOTICE** — `20260828082136` post-dates the former RC. **Legitimate, expand-only, security-tightening, with a rollback.** Not unauthorized; **it does void the 08-26 audit's coverage** | VERIFIED |
| Unexpected DB changes | **NONE.** Staging `schema_migrations` matches the repo; production carries nothing not in the repo | VERIFIED |
| Unexpected configuration | **ONE** — `_headers` ACAO apex→`www` (AF-11), a production behaviour change carried under a de-hardcoding commit | VERIFIED |
| Unexpected production writes | **NONE** (§16) | VERIFIED |
| Deleted files | **NONE** | VERIFIED |

---

# 22 · OWNER DECISIONS / DEVIATIONS

| ID | Decision | Reason | Date | Owner | Evidence | State |
|---|---|---|---|---|---|---|
| **D-1** | Accept the 9 `UNAPPLIED_`-prefixed filenames as a documented deviation | Renaming changes the tree → rebaselines the candidate → invalidates every earned CI artifact. Defect is documentary; nothing machine-readable depends on the names | 2026-08-27 | Neil Basu | §6.3 | **DRAFTED — UNSIGNED** |
| **D-2** | *(reserved — superseded by D-1)* | | | | | — |
| **D-4** | Shorten the "Only Me" notice to one sentence; **D-002 stays OPEN** | UI-copy-only change; storage remediation deferred | 2026-08-29 | Neil Basu | `docs/DECISIONS.md` D-002 "Update, 2026-08-29"; `25c0456` | ✅ **EXECUTED** |
| **D-5** | Accept AF-03 (production-CDN refs in staging config); decline remediation | Nulling SEO keys would convert a visible failure into a **vacuous pass** on §15 row 8 — the anti-pattern the gate exists to prevent | 2026-08-27 | Neil Basu | §10.4 | **DRAFTED — UNSIGNED** |
| **D-6** | **Certificate conflict resolves to STAGING's colours (blue).** *"use the blue as in staging it is final, no difference from Staging"* | Owner's design ruling; also the **only** resolution that compiles (§4.3) | 2026-08-29 | Neil Basu | §4.3, §4.4 | ⚠ **RULED · RESOLUTION PREPARED AND VERIFIED · COMMIT NOT LANDED** — see §4.4 |
| **D-7** | Promote **current `staging`**, not the audited 08-26 tree | Today's fixes must reach members and the app build | 2026-08-29 | Neil Basu | §3.4 | ✅ **RULED.** Consequence: 7 commits bypass the full gate review |
| **D-8** | **ACAO accepted as `www`** (option D-8b) | Owner: *"approve ACAO header"*. The site is served on `www`, so a browser there sends `Origin: https://www.50mmretina.com`; the apex value would not match it | 2026-08-29 | Neil Basu | §7.2 | ✅ **RULED — ACCEPTED.** On promotion, production `Access-Control-Allow-Origin` changes **apex → `www`**. This is a deliberate CORS correction, no longer an undeclared side effect |
| **D-9** | **AF-15 — fix the tap targets rather than ship the red gate** | Owner: *"fix it first"*. Option (a) chosen over accepting a deviation or reverting | 2026-08-29 | Neil Basu | §13.1 | ✅ **RULED AND EXECUTED** — `bfcb68da` (fix) + `c8aec5d5` (pin) |
| **D-13** | **Grant the independent auditor read-only access** to both Supabase projects, edge functions, Cloudflare R2/API-tokens/Zero Trust, and GitHub repo settings | §25.4's closure rule means owner re-measurement is OWNER-ATTESTED and can never close an audit row. Without access §25 stays PARTIAL permanently, and a repository-only auditor returns only repository findings (§28.1). Owner chose access over an accepted deviation | 2026-08-29 | Neil Basu | §25.7 | ✅ **RULED — access to be granted in each provider's console, to the auditor's own account. No credential to any chat, ledger or file; the compiler never handles any of it** |
| **D-12** | **G8 — waive the control-3 precondition; accept token-scope observation** | The control cannot discriminate for a correctly-scoped token (§10.2 / §4A). Owner informed that a prior ruling on this gate was withdrawn | 2026-08-29 | Neil Basu | §23.3 | ✅ **RULED — WAIVED.** G8 = CLOSED WITH DOCUMENTED DEVIATION |
| **D-10** | **Apply migration `20260828082136` to production, post-merge** (option D-10a) | Owner: *"apply migration 20260828082136 post-merge"*. Closes two live RLS gaps on `ad_creative_comments` | 2026-08-29 | Neil Basu | §6.2, §24.3 | ✅ **RULED — SCHEDULED.** ⚠ **NOT YET EXECUTED.** It is a production DB write and an owner action; see §24.3 step 12 |

### D-8 · THE DECISION TO BE MADE (not yet made)

**Fact:** `public/_headers` on `main` serves `Access-Control-Allow-Origin: https://50mmretina.com`
(apex). The generated file in T emits `https://www.50mmretina.com` (www). Everything else in that
file is byte-identical. **This is a production behaviour change carried under a de-hardcoding
commit and never declared.**

| Option | Effect |
|---|---|
| **D-8a** | Derive ACAO from the **apex** display form → production stays **byte-identical**; the change is reverted to a no-op for this release |
| **D-8b** | Accept **`www`** as a deliberate CORS correction, recorded as its own decision. Arguably the *more correct* value — the site is served on `www`, so a browser there sends `Origin: https://www.50mmretina.com` and the apex value would not match it |

**Neither option is chosen. This is an owner ruling about what the production CDN accepts.**

### D-10 · THE DECISION TO BE MADE (not yet made)

**Fact:** migration `20260828082136` is applied on staging, **not** on production (§6.2, measured).
Production is missing two RLS policies; **live exposure is currently 0** (0 hidden creatives, 0
banned members). **Merging PR #104 does NOT apply it** — migrations need a separate dispatch.

| Option | Effect |
|---|---|
| **D-10a** | Apply M2 to production immediately after the merge (§24.3), verify `pg_policies` returns **9 rows** |
| **D-10b** | Defer, and accept that both gaps stay open in production until a later cycle |

**Neither option is chosen.** Applying a migration is a **production database write** and is an
owner action by construction — no session performs it.

---

# 23 · SIGNATURES / APPROVALS

**All unsigned. None may be signed by the compiler.**

| ID | Instrument | Prerequisite | State |
|---|---|---|---|
| **B8 / D-1** | `UNAPPLIED_` deviation acceptance | — | ✅ **RULED 2026-08-29** — §23.4 |
| **B11** | Database rollback binding | Re-drafted to **SIX** files; the 08-27 five-file version omitted M2's rollback (§17.1) | ✅ **SIGNED 2026-08-29** — §23.1. *(This row read "UNSIGNED — and the existing draft is now WRONG" until REV-12; it was stale from REV-10. Corrected, not deleted — §14.)* |
| **B13** | G9 exclusion countersignature — accepts 4 residual production risks incl. `submit-judge-decision` answering `*` | Owner read the measured basis in session, then ruled in their own words. Compiler pre-checked the text against source and added **two items at the owner's direction**: per-function review of the 29 drift cases (3 opposite-direction), and a date-stamp on the 08-26 counts | ✅ **RULED 2026-08-29** — §23.5. **Authorises nothing else** — §23.5.5 |
| **B12 / CHG-005** | Change-ledger closure + Story-row waiver | Ruling written 08-27 | ✅ **RULED 2026-08-29** — §23.4 |
| **D-5 / AF-03** | Deviation acceptance | — | ✅ **RULED 2026-08-29** — §23.4 |
| **G8 substitution** | Accept token-scope observation in place of A.5 | Precondition **explicitly waived** by the owner, §23.3 | ✅ **RULED 2026-08-29 — D-12** |
| **D-8 / AF-11** | ACAO ruling | — | ☐ **NOT DRAFTED** |
| **D-9 / AF-15** | UI-gate ruling | — | ☐ **NOT DRAFTED** |
| **D-10 / AF-17** | Apply M2 to production | — | ☐ **NOT DRAFTED** |
| **§11 Release Approval Record (OA-19)** | 8 fields, signed **and tagged BEFORE the merge** (§17-10) | **Cannot be signed while G8 and AF-15 are unresolved** | ☐ **UNSIGNED** |
| **Promotion approval (OA-20)** | §12.4 in order | All above | ☐ **UNSIGNED** |
| **Ledger closure** | This document | All above + §25 | ☐ **OPEN** |

## 23.4 · B8, B12 and D-5 — RULED 2026-08-29

**Transcribed verbatim from the owner's decision in session. Not signed by the compiler.**
These three are **rulings on disposition**, not attestations of having read evidence — which is why
they could be taken together and **B13 could not** (§23.5).

### B8 / D-1 — the nine `UNAPPLIED_`-prefixed files

> I accept for this release that nine files keep the `UNAPPLIED_` prefix while the migrations they
> name **are applied in production** (§6.3, measured: all nine have forward migrations live).
>
> **The defect is documentary.** Nothing machine-readable depends on the names — the migration
> workflow takes a free-text path, no CI enumerates them, and `schema_migrations` is keyed on
> version integers. **Renaming would change the tree**, voiding every CI artifact earned against
> this candidate and forcing a rebaseline. The rename and the orphan's disposition are **deferred
> to G11**.
>
> I further note the approved migration manifest for §12.4 step 12 is **explicitly EMPTY**.
>
> Ruled by: **Neil Basu (owner)** · 2026-08-29

### B12 — change-ledger closure

> With CHG-G10-005 dispositioned (reclassified TEST/HARNESS, 08-27) and **CHG-G10-003 withdrawn
> from this candidate** — PR #103's head `704ad57` is not an ancestor of `staging` and its own body
> says "Do not merge" — **all nine ledger entries are terminal and none is UNINTENDED.**
>
> **The Change Ledger for this release is CLOSED.** §11 prerequisite 2 is satisfied.
>
> I accept that the Story row remains in the **staging** database (no reaper exists; `expires_at`
> governs display only), and that the duplicate-file-input hazard that created it is carried to G11.
>
> Ruled by: **Neil Basu (owner)** · 2026-08-29

### D-5 / AF-03 — production-CDN references in staging configuration

> I accept **46 references** to `https://cdn.50mmretina.com` in staging `site_settings`, resolving
> to **12 distinct production objects** across six keys.
>
> **Measured with controls on both origins: there is no cross-lane data leak** — the 12 objects
> exist in production R2, are absent from staging R2, and the production CDN **refuses** them when
> requested from a staging page.
>
> **I accept the two residual defects:** §15 row 1's negative criterion literally fails, and
> staging renders broken ad/OG images on **29 routes**.
>
> **I accept that remediation was declined deliberately** — nulling the SEO keys would remove
> `og:image` and `json_ld` entirely, converting a visible failure into a **vacuous pass** on §15
> row 8, which is the exact anti-pattern the gate exists to prevent.
>
> **Control gap carried to G11:** the isolation guard scans **built code**; these references live in
> **database rows** and are invisible to every R-rule and mutant. A data-side isolation scan is
> required. The guard's 21/21 mutant result is **not** downgraded.
>
> ⚠ **Evidence class: INFERRED.** This ledger carries AF-03 from the 2026-08-27 record; it was
> **not re-measured** on 2026-08-29. The owner ruled on the record as it stands.
>
> Ruled by: **Neil Basu (owner)** · 2026-08-29

---

## 23.5 · B13 — G9 EXCLUSION COUNTERSIGNATURE — ✅ RULED 2026-08-29

**Ruled 2026-08-29T10:20Z by Neil Basu, in this session.** Superseding the HELD state recorded at
REV-11 (preserved below, §23.5.4). Transcribed from the owner's own decision text; **two additions
were made at the owner's explicit direction after the compiler's pre-check** (§23.5.2). **Not signed
by the compiler.**

### 23.5.1 · The owner's ruling — as accepted

> **B13 — G9 EXCLUSION COUNTERSIGNATURE.**
>
> I accept B13 as a **documented, temporary risk acceptance** for this release.
>
> **I accept these four residual production risks, and I accept that they are LIVE TODAY, not
> historical:**
>
> 1. **Pre-G9 CORS in all 71 production edge functions.** The deployed `_shared/secureHeaders.ts` is
>    byte-identical across production (md5 `58b9f45d…`) and uses prefix matching with a
>    `.lovable.app` wildcard.
> 2. **`submit-judge-decision` answers `Access-Control-Allow-Origin: *`** — a judging-decision
>    endpoint reachable from **any origin on the internet**. The source fix is in this candidate, but
>    **edge functions do not auto-deploy from GitHub**, so production remains exposed until the
>    function is deployed separately.
> 3. **The storage-lane guard is absent in ten functions:** `s3-delete`, `s3-presign-upload`,
>    `s3-signed-url`, `s3-upload`, `migrate-storage`, `hard-delete-competition`, `purge-s3-orphans`,
>    `detect-orphan-files`, `backfill-image-dims`, `media-register-upload`.
> 4. **Lane-config drift in eight functions**, including all three email functions.
>
> **My reasoning:**
>
> - Production is **ahead of** staging in three functions. A blanket staging-over-production deploy
>   would be a regression, not a fix.
> - **29 of 71** functions differ. That is too many to deploy blind alongside a Pages promotion.
> - There is **no function-level rollback**. Supabase edge functions cannot be rolled back per
>   function; the only rollback available is at the Pages level, which does not touch functions.
> - Therefore separating the function deployment from this release **reduces** risk. Carrying the
>   four risks for a bounded period is the lesser exposure.
>
> **Conditions of this acceptance:**
>
> 1. This acceptance is **temporary and bounded to this release**. It does not carry forward to any
>    later release without being re-taken.
> 2. **No edge function is deployed as part of this promotion.** The G9 function work is excluded
>    from RC-20260829-05 entirely.
> 3. The four risks above are carried into **G11** as open items, not closed here.
> 4. Before any G9 function deployment, the **71 production function bundles must be captured AND
>    HASHED** so the pre-deployment state is reconstructible. A captured snapshot alone is not
>    sufficient; the hashes are required.
> 5. **[ADDED — see §23.5.2]** Before any G9 function deployment, a **per-function review of the 29
>    drifted functions** must be completed and recorded. **Three of the 29 must be resolved in the
>    OPPOSITE direction from the other 26** — production holds the newer version in those three, and
>    staging must not overwrite them. A blanket staging→production deploy is expressly prohibited.
> 6. `submit-judge-decision` is treated as the **highest-priority** item of the four, because it is
>    the only one where an unauthenticated third-party origin can reach a decision endpoint.
> 7. The two findings below remain **unresolved and are not closed by this acceptance.**
>
> **Unresolved findings carried forward, not closed:**
>
> - **Cloudflare Zero Trust posture — NEED EVIDENCE.** Not measured; must not be recorded as pass.
> - **Brevo API-key prefix logging — DEFERRED.** Known, accepted for now, still open.
>
> **Limits on what this acceptance authorises:**
>
> **Do not deploy functions, merge PR #104, apply migrations, create a tag, or perform production
> writes merely because I have accepted B13.** Continue only with the remaining pre-promotion gates
> and approvals.
>
> Ruled by: **Neil Basu (owner)** · Date (UTC): **2026-08-29** · **Not signed by the compiler.**

### 23.5.2 · Pre-check performed before recording — and the two additions

The owner instructed the compiler to **check the text before recording it** rather than transcribe it
as given. That check was performed against the source document
`claude/G10_S14_G9_EXCLUSION_RULING_AND_EXECUTION_2026-08-26.md`.

| Item checked | Result |
|---|---|
| Four risks vs source | **MATCH** — verbatim, all four |
| Reasoning (production ahead in 3 · 29/71 · no function-level rollback · Pages-only rollback) | **MATCH** |
| Measurement `21 MATCH / 21 secureHeaders-only / 29 DRIFT / 0 UNKNOWN` | **MATCH** |
| Two unresolved findings (Zero Trust, Brevo) | **MATCH** |
| Owner's requirement to **hash** the 71 bundles | **STRONGER than source** — source asked only for a captured snapshot. Retained as written. |
| Per-function review of the 29, with 3 opposite-direction | **GAP — present in source, absent from the owner's text** → added as condition 5 |
| Currency of the 29/71 figures | **GAP — figures are as of 2026-08-26** → date-stamped, §23.5.3 |

**Both gaps were put to the owner before recording. The owner directed: add both, then record.**
Nothing was removed from the owner's text; the additions are marked `[ADDED]` in place.

**Independent currency check performed by the compiler, 2026-08-29:** the live production
`submit-judge-decision` function was fetched and read. It is **version 23, ACTIVE**, and its source
still declares a local `corsHeaders` object containing `"Access-Control-Allow-Origin": "*"`.
**Evidence class: VERIFIED.** Risk 2 is therefore live on the date of this ruling, not merely as of
2026-08-26.

### 23.5.3 · Evidence class and date-stamp of the measured basis

> ⚠ **The 71-function comparison was taken on 2026-08-26 against `staging @ 702e5ce`.** The candidate
> has moved since. **The drift counts have NOT been re-measured against RC-20260829-05.**
>
> | Element | Value | Class |
> |---|---|---|
> | `21 MATCH · 21 secureHeaders-only · 29 DRIFT · 0 UNKNOWN` | as of **2026-08-26**, staging `702e5ce` | **VERIFIED (as of that date) — NOT re-measured** |
> | The four risks still standing on 2026-08-29 | production has **not** been redeployed since 08-26 | **VERIFIED** |
> | `submit-judge-decision` v23 serving `*` on 2026-08-29 | live function source fetched and read | **VERIFIED** |
> | Owner's reading of the measured basis | owner attestation | **OWNER-ATTESTED** |
>
> **The owner was shown this staleness before ruling and ruled on the record as it stands.** The
> counts must be re-measured before condition 5's per-function review is carried out; the review may
> **not** be performed against the 08-26 numbers.

### 23.5.4 · Superseded state — preserved, not overwritten (§14 rule)

**At REV-11, 2026-08-29T09:35Z, this section read: "B13 — HELD, NOT SIGNED."** The stated reason was
that B13's text asserted *"I have read the measured basis"* — an assertion about the owner's state of
knowledge that the compiler could not witness and would not transcribe.

**That conclusion is preserved, not deleted.** It was correct at the time it was written. It was
resolved — not reversed — by the owner reading the measured basis in session (the owner asked for it
to be pasted and read it), and then issuing the ruling above in their own words. The compiler still
does not attest to the owner's knowledge; **the owner does**, and that is recorded as
**OWNER-ATTESTED**, not as VERIFIED.

### 23.5.5 · What this ruling does NOT authorise

Restated at the owner's explicit instruction, because this is the ruling most likely to be misread as
a green light:

| Action | Authorised by B13? |
|---|---|
| Deploy any edge function | ❌ **NO** — expressly excluded, condition 2 |
| Merge PR #104 | ❌ **NO** |
| Apply migration `20260828082136` | ❌ **NO** |
| Create the release tag | ❌ **NO** |
| Any production write | ❌ **NO** |
| Proceed with the remaining pre-promotion gates (§24.1 steps 6–7) | ✅ yes — and only those |

**§11 is now unblocked by B13. It remains unsignable while the runbook §5.3 probe is un-run and §25 is
vacant.**

---

## 23.3 · D-12 — G8 SUBSTITUTION, WAIVED AND ACCEPTED BY THE OWNER

**Ruled 2026-08-29 by Neil Basu, in this session, after being shown the evidence, its class, and the
fact that a prior substitution ruling on this same gate had been withdrawn.**

> **§8.6 — R2 WRITE ISOLATION. PRECONDITION WAIVED; SCOPE OBSERVATION ACCEPTED.**
>
> I accept direct observation of the token's permission list as evidence that the staging storage
> credential cannot write to the production bucket, **in place of** A.5's runtime negative test.
>
> **I waive** the 2026-08-27 signing pack's requirement that A.5's known-absent control be re-run
> before any substitution ruling is signed. I do so on the recorded finding that **the control
> cannot discriminate for a correctly-scoped token**: `50mm` and a non-existent bucket are both
> outside the token's Access Policy, so both are refused at the authorization layer (`10003
> AccessDenied`) before the existence check that would emit `10006 NoSuchBucket`. **Only a
> credential broad enough to fail the gate could produce the answer the control asks for.**
>
> **I am aware** that a prior session's substitution ruling on this gate was withdrawn, and that
> the signing pack marked it "intentionally left unsignable." This waiver is made knowingly.
>
> **I accept the evidence class:** the token's scope is **VERIFIED** by direct reading; runtime
> enforcement is **INFERRED** from Cloudflare's documented deny-by-default Access Policy model,
> **not observed**. Cloudflare's error-code reference documents both codes but is silent on
> evaluation order.
>
> **I accept the residual limits:** §8.6 part 3 has an **after** measurement only — the production
> bucket's `isolation-probe/` prefix returned **zero objects** at 2026-08-29T04:37:25Z — and **no
> before baseline exists** for run `33079091310`, nor can one be created retroactively.
>
> **Evidence relied upon:**
> 1. Token `staging-upload` (`73a7920647481fd93553f9c1f68bf5a3`) — **exactly one** permission policy: `R2 › 50mm-staging`, Bucket Item Write. **No policy names `50mm`.** Only token in the account.
> 2. Owner-confirmed: `site_settings.s3_storage_settings.access_key_id` **equals that token id**; Cloudflare docs state verbatim *"Access Key ID: The `id` of the API token."*
> 3. Run `33079091310`: the same credential, seconds apart, **succeeded** writing to `50mm-staging` and was **denied** writing to `50mm`. A credential erroring on everything could not have succeeded on the first.
> 4. Production `50mm`, prefix `isolation-probe/` → **no objects matched**, measured 04:37:25Z.
> 5. Precedent: `G9_CLOSURE_FINAL_2026-08-24.md` closed **G9 GREEN** on this same evidence class, naming this same token.
>
> **G8 recorded as: CLOSED WITH DOCUMENTED DEVIATION** — the substance of §8.6 part 2 is met; the
> prescribed instrument was not used, and that substitution is this deviation.
>
> Ruled by: **Neil Basu (owner)** · Date (UTC): **2026-08-29** · Recorded in session, transcribed
> verbatim from the owner's decision. **Not signed by the compiler.**

---

## 23.1 · B11 — SIX-FILE ROLLBACK BINDING — ✅ SIGNED 2026-08-29 · ✅ **RE-SIGNED 2026-08-29T11:42Z**

### 23.1.0 · RE-SIGNATURE — owner ruling, 2026-08-29T11:42Z (C-9 / C-10)

**Reason.** The signed text below names `d06b0379776aef94d006d78b1de37a0cda685927` as the candidate.
**C-8 established that commit is the REV-7 ledger save — a docs-only commit, not the application RC.**
The compiler did not and will not edit signed words; the owner was asked to settle it and chose to
re-sign. The auditor's round-3 verdict recommended exactly this.

> **B11 — RE-SIGNED.**
>
> **I re-sign B11 against application/code RC `a42b209e4f70a6efed4f3dcdb654e0f994416594`.**
> **The six named rollback files, their reverse order, and all previously accepted limitations remain
> unchanged.**
>
> Ruled by: **Neil Basu (owner)** · Date (UTC): **2026-08-29** · **Not signed by the compiler.**

**What this changes:** the identifier only. **What it does not change:** the six files, their reverse
execution order (0 → 5), and every limitation the owner accepted on 2026-08-29 — in particular that
**the set has never been executed against a live database**, that **file 0 deliberately reopens both
RLS gaps**, and that **`git revert` does not un-apply migrations** (§17.2).

**Why the substance was never at risk:** the rollback set is defined by **six named files**, not by a
SHA, and those six files are byte-identical in `d06b0379` and `a42b209e` — every commit between them
touches only `docs/PROMOTION_LEDGER.md` (§3.1 Layer 1).

**The original signature is retained below, unedited.** It is superseded, not deleted (§14).

### 23.1.1 · Original signature — 2026-08-29, superseded by §23.1.0

> ⚠ **Do not sign the 2026-08-27 five-file version.** It predates migration `20260828082136` and
> would leave that migration **un-rollbackable**. This supersedes it.

> **DATABASE ROLLBACK COMPONENT — RC-20260829-05.**
> The database rollback for candidate `d06b0379776aef94d006d78b1de37a0cda685927` is the following
> **six** files, executed in **reverse migration order (0 → 5)** via
> `.github/workflows/apply-migration.yml` with `target = production`, dispatched from `main`:
>
> 0. `supabase/rollback/20260828082136_ad_comment_ban_and_visibility_policies_ROLLBACK.sql`
>    **← runs FIRST; absent from the 08-27 draft**
> 1. `supabase/rollback/UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql`
> 2. `supabase/rollback/UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql`
> 3. `supabase/rollback/UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql`
> 4. `supabase/rollback/UNAPPLIED_20260824000000_admin_user_list_pagination_ROLLBACK.sql`
> 5. `supabase/rollback/20260824145345_admin_user_lookup_by_email_ROLLBACK.sql`
>
> `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` is **NOT** part of this set — its
> forward migration is applied in production but is not part of this RC.
>
> **I acknowledge:**
> * this set is **prepared and reviewed but NEVER EXECUTED** against a live database;
> * **file 0 reopens both RLS gaps by design** — a banned member could comment on ads again, and a
>   hidden ad's thread would become readable again. It is not a safe default and its own header
>   says so;
> * §17-9's Pages-deployment rollback covers the **web bundle only** and does **not** cover schema;
> * `git revert` of the merge does **not** un-apply any migration.
>
> **Ruled by: Neil Basu (owner) · Date (UTC): 2026-08-29** · transcribed verbatim from the owner's
> decision in session. **Not signed by the compiler.**
>
> **The owner was shown, and accepted, before ruling:**
> * the set has **NEVER been executed against a live database** — it is written and reviewed only,
>   so in an incident it would be untested SQL run against production under pressure;
> * **file 0 deliberately reopens both RLS gaps** — a banned member could comment on ads again, and
>   a hidden ad's thread would become readable again;
> * **`git revert` of the merge does NOT un-apply any migration** — schema and code roll back
>   separately;
> * §17-9's Pages rollback covers **the web bundle only**;
> * the 2026-08-27 five-file draft **would have left `20260828082136` un-rollbackable**, and is
>   superseded by this six-file set.
>
> **The owner declined to test the set on staging first, and signed it as-is.** That choice is
> recorded here rather than left implicit: **the rollback plan exists and is correct on paper; its
> behaviour against a live database remains unverified.**

---

## 23.2 · §11 RELEASE APPROVAL RECORD (OA-19) — pre-filled, UNSIGNED

> ⚠ **Must be signed AND the tag created BEFORE the merge** (§17-10). Tree equality after the merge
> is asserted against **that tag**, not against T (§20).
> ⚠ **§3.5 freeze rule applies from the moment this record is signed:** no further commit of any kind
> to `staging` until after the merge. That is what makes the signed head equal the merged head.
> ⚠ **G8 (D-12), B11 (§23.1), B8, B12, D-5 and now B13 (§23.5) are ALL RULED.** Still cannot be signed while **the runbook §5.3 probe is un-run** and **§25 is vacant** — **two blockers remain**.

| # | Field | Value |
|---|---|---|
| 1 | Release ID | `RC-20260829-05` |
| 2 | **Application / code RC** | **`a42b209e4f70a6efed4f3dcdb654e0f994416594`** — frozen; zero non-`docs/` changes after it (§3.1 Layer 1) |
| 3 | **Merged identity** | **NOT RECORDABLE HERE BY CONSTRUCTION.** Read `git rev-parse staging` at the freeze point (§3.5 rule 3), create the tag against it (rule 4), and write **the tag** in the Tag field below. §20 asserts tree equality against **the tag**, never against a SHA quoted in this document |
| 4 | Target | `main` at `b671e1fb0c5bcf145d442076c229eca888afd674` |
| 5 | Gate status | 7 GREEN · 4 CLOSED-WITH-DEVIATION · G10 not reachable pre-merge (§10 ceiling). **CI must be re-confirmed on the head existing at the freeze point** — evidence taken on `fe63e944` does not carry (§25.2) |
| 6 | Deviations accepted | **D-1** `UNAPPLIED_` filenames · **D-5** AF-03 data-borne CDN refs · **D-7** 7 commits outside the 08-26 review · **G8** substitution — **waived, D-12 §23.3** |
| 7 | Findings carried to G11 | AF-03 · AF-11 *(ruled D-8)* · AF-13 · AF-16 · **AF-20** · **the six INSUFFICIENT-EVIDENCE instruments of §25.3** |
| 8 | Post-promotion obligations | **D-10** apply `20260828082136` · N2 cross-lane · §18 regression · **G9 edge-function deployment — gated by B13 conditions 4 and 5 (§23.5.1): 71 bundles captured AND HASHED first; per-function review of the 29 drift cases, 3 of them resolved in the OPPOSITE direction; drift counts RE-MEASURED (the 08-26 figures are stale). Blanket staging→production deploy expressly prohibited.** |
|  | **Tag** | `______________________` *(create BEFORE merging, AFTER the §3.5 freeze point, against `git rev-parse staging` read at that moment)* |
|  | **Signed** | `______________________`  Date (UTC): `____________` |

---

---

# 24 · POST-PROMOTION GATES — SEQUENCING

## 24.1 PRE-PROMOTION (before the merge button)

1. **D-9** — rule on AF-15 (red UI gate). If fixing: new commit → **new RC** → re-run §18.
2. **D-8** — rule on AF-11 (ACAO).
3. **G8** — resolve (§10.2 / §23).
4. **Confirm a `staging` Environment exists** with its own `SUPABASE_DB_URL` (§7.1), or `apply-migration.yml target=staging` cannot run.
5. ~~Sign B8, B11 (**six-file version**), B12, B13, D-5.~~ ✅ **ALL RULED** — B8/B12/D-5 §23.4 · B11 §23.1 · B13 §23.5.
6. **runbook §5.3 secret-isolation probe** — runbook §5.3.6 requires it **immediately before** promotion. Running it early goes stale and must be repeated.
6a. **Re-confirm CI on the head that actually exists at that moment** — §25.2: evidence taken on `fe63e944` does not carry to a later head. Application code is unchanged (§3.1 Layer 1), so this is a re-read, not a re-test.
7. **§11 approval signed AND tagged** — sign, then **LEDGER FREEZE** (§3.5 rule 3: no more commits to `staging`), then `git rev-parse staging`, then create the tag against that SHA. The tag must exist **before** the merge (§17-10).

## 24.2 PROMOTION-TIME

8. **Resolve the certificate conflict → staging's blue (D-6).** This creates a commit; the merged tree will differ from T.
9. Merge PR #104.
10. **Assert tree equality against the tag from step 7**, not against T (§20).
11. Verify the production build and deployment.

## 24.3 POST-PROMOTION

12. **🔴 APPLY M2 TO PRODUCTION** — `20260828082136_ad_comment_ban_and_visibility_policies.sql` via `apply-migration.yml`, `target=production`, from `main`. **Until this runs, both RLS gaps stay open in production even though the file is on `main`.** Verify: `pg_policies` on `ad_creative_comments` returns **9 rows**.
13. **N2 cross-lane test** — only meaningful **after** the merge installs the gate on `main` (§12 row 12). ⚠ Execute **N2 only** (staging URL / production target). **Do NOT execute N1 as written** — it places a production credential in a staging Environment, and a gate failure would hit **production live member data**. Safe N1 substitute: dispatch `target=staging` from `main`, which trips gate 1 before any credential is read.
14. **§18 regression suite** — post-promotion by construction.
15. **Deploy the G9 edge-function fixes** — merging does **not** deploy them; `submit-judge-decision` keeps answering `*` until deployed. **⚠ B13 (§23.5) attaches four preconditions to this step, and they are binding:**
    - **15a.** Capture **and HASH** all 71 production function bundles first. A snapshot without hashes does not satisfy condition 4.
    - **15b.** **Re-measure** the drift. The `21/21/29/0` split is **as of 2026-08-26 @ `702e5ce`** and is stale against RC-20260829-05 (§23.5.3). The review may not be done against the old numbers.
    - **15c.** Complete and record a **per-function review of the 29 drifted functions**. **Three of them must be resolved in the OPPOSITE direction** — production holds the newer version there and must not be overwritten by staging.
    - **15d.** **A blanket staging→production deploy is expressly prohibited.** `submit-judge-decision` is the highest-priority single item (B13 condition 6).
16. Android build from `main` — separate release, own versionCode, AF-13 unresolved.

---

# 25 · INDEPENDENT AUDIT SECTION

> **RESERVED. Not to be completed by the compiler of this ledger.**
> For an independent auditor. Every item should be re-derived **from the repository, the databases
> and the dashboards**, never from this document's conclusions.

## 25.1 · AUDIT ROUND 1 — 2026-08-29, REV-12 — **PARTIAL**

**Auditor:** independent auditor engaged by the owner, findings relayed by **Neil Basu (owner)** on
2026-08-29. **Transcribed by the compiler with attribution; the compiler did not perform this audit.**

> ⚠ **This audit is PARTIAL and does NOT satisfy §26 blocker 9.** The auditor had **no independent
> access** to the production database, the staging database, the deployed edge functions, Cloudflare
> R2, the Cloudflare dashboard, or GitHub Environments. It is a **repository and governance audit**.
> The infrastructure half is unaudited. See §25.3.
>
> ⚠ **AND IT DOES NOT COVER THE APPLICATION CODE — added at REV-14 (C-9) at the auditor's own
> insistence.** Round 1 verified **the specific repository and governance claims listed below and
> nothing more**. It did **NOT** independently review the **138 changed files**, did **NOT** re-run
> the test suite, and did **NOT** re-derive the UI-gate, typecheck, build or secret-scan results.
> **Nobody may cite this audit as evidence that the code RC `a42b209e` has been reviewed.** No such
> review has been performed by anyone other than the compiler.

### Independently verified by the auditor

| # | Finding (auditor's words, condensed) | Compiler re-derivation |
|---|---|---|
| 1 | REV-12 is byte-identical on `staging` and `altisinfonet-patch-35`; git blob `39b3e76d8c1e8891bde5b64c71b054e6f2764cc3` | ✅ **INDEPENDENTLY CONFIRMED** — `git hash-object` on the compiler's own file returns the identical blob SHA. This is a second-source match on the exact bytes. |
| 2 | B13 contains the four accepted risks, the 2026-08-26 / `702e5ce` date-stamp, mandatory re-measurement, the per-function review of the 29, the three production-newer exceptions, and the blanket-deploy prohibition | ✅ present at §23.5 |
| 3 | The REV-11 HELD history is preserved | ✅ §23.5.4 |
| 4 | B8, B11, B12, B13, D-5 and D-12 are recorded as ruled | ✅ §23.1 / §23.3 / §23.4 / §23.5 |
| 5 | `main` remains `b671e1fb0c5bcf145d442076c229eca888afd674` | ✅ **INDEPENDENTLY CONFIRMED** by the compiler, 10:40Z |
| 6 | PR #104 is open and mergeable; all **8** public CI runs for head `fe63e94483ac9c25c335ad9721258228ebe04571` succeeded | ⚠ **head confirmed** by the compiler; **mergeability and the 8 run conclusions were NOT re-read by the compiler** — carried as auditor-attested. **And see §25.2: this head is now superseded.** |
| 7 | No remote tags exist; `staging` has not been merged to `main` | ✅ **INDEPENDENTLY CONFIRMED** — tag ref list returns empty; `main` unchanged |

### Corrections the auditor required — all applied at REV-13

Recorded as **C-8** in §14, with every previous value preserved. §1, §2, §3.1, §3.2, §3.4, §4.1,
§4.2, §11 (§23.2), §24 and §26 were corrected consistently in the same revision.

### Compiler additions the auditor did not specify

Made because the auditor's instruction, followed literally, would have produced a record that was
false on arrival. Each is flagged so the auditor can accept or reject it independently:

1. **§3.5 freeze rule** — the auditor said *"do not describe any SHA as immutable if committing the
   correction will change it"* but gave no terminating rule. Without one the correction invalidates
   itself. §3.5 supplies it.
2. **§3.1 Layer 1 correction** — the auditor did not notice that **`d06b0379`, the SHA §1 recorded as
   the RC, is a docs-only commit** (the REV-7 ledger save). The application RC is `a42b209e`, proven
   by a zero-non-`docs/` diff to the head.
3. **§3.2 split counts** — `+9,494` mixes 434 lines of this ledger into the code scope. Application
   scope is `+9,060 / −1,293`. Both are now recorded with their basis.
4. **45 vs 43 commits** — 45 counts merge commits, 43 does not. Both recorded, with the instrument
   for each, rather than one number presented as the count.
5. **This section's PARTIAL classification** and §25.3.

## 25.2 · ⚠ THIS AUDIT'S EVIDENCE IS ALREADY PARTLY SUPERSEDED

The auditor measured against head `fe63e944`. **Recording their findings required this commit**,
which creates a new head. Therefore:

- Findings 1–5 and 7 are **unaffected** — they concern the ledger's content, `main`, and tag absence.
- Finding 6's **CI evidence does not carry forward.** The 8 successful runs belong to `fe63e944`.
  CI state on the new head is reported separately below and must be read there.
- **No application code changed** (§3.1 Layer 1), so the *code* the CI runs tested is unchanged.
  Under §3.5 rule 1 this is a governance commit and does not void §3.3.

## 25.3 · RECORDED AS INSUFFICIENT EVIDENCE — NOT VERIFIED

**At the auditor's explicit instruction.** The auditor had no independent access to these instruments,
so nothing below may be cited as audited, by anyone, including this ledger:

| Instrument | Ledger's own claim | Audit status |
|---|---|---|
| Live production edge-function state (71 functions; `submit-judge-decision` v23 serving `*`) | §23.5, class VERIFIED **by the compiler** | **INSUFFICIENT EVIDENCE — not independently audited** |
| Production database policy state (`ad_creative_comments`, 7 policies) | §13 AF-17 | **INSUFFICIENT EVIDENCE** |
| Staging database policy state (9 policies) | §13 AF-17 | **INSUFFICIENT EVIDENCE** |
| R2 token policy / bucket scope (`staging-upload`, one policy) | §10.2, §23.3 D-12 | **INSUFFICIENT EVIDENCE** |
| GitHub `staging` Environment existence and secrets | §7.1 | **INSUFFICIENT EVIDENCE** |
| All Cloudflare dashboard observations (bucket sizes, prefix searches, Zero Trust posture) | §8, §10.2 | **INSUFFICIENT EVIDENCE** |

**This does not mean the claims are wrong.** It means one person measured them and no second party
has checked. **The compiler is not a second party.**

## 25.4 · WHAT WOULD COMPLETE THE AUDIT — one row per §25.3 instrument (REV-14, C-9)

> ### ⚠ THE CLOSURE RULE — read before planning round 2
>
> **The owner re-measuring these instruments does NOT close them.** Owner re-measurement is
> **OWNER-ATTESTED**, which is the class these items already carry; repeating it changes nothing.
>
> **To close §25, each row must be either:**
> **(a)** checked directly by a **separate auditor holding read-only access** to that instrument; or
> **(b)** **exported through an instrument the separate auditor can independently validate** — a
> signed/timestamped export, a CI job whose logs the auditor reads, or a provider-side artifact the
> auditor can fetch themselves. **A value pasted into a chat by the owner is not an export.**
>
> **No row below may be marked closed by the compiler.** The compiler is not a second party.

| # | §25.3 instrument | What must be checked | Acceptable closure |
|---|---|---|---|
| 1 | **Production DB policy state** | `pg_policies` on `ad_creative_comments` — expect **7** rows pre-migration, **9** after D-10 (AF-17, highest-severity live finding) | (a) auditor with read-only DB role · or (b) CI job output the auditor reads |
| 2 | **Staging DB policy state** | same query on the staging lane — expect **9** | (a) or (b) |
| 3 | **Deployed edge-function state** | `submit-judge-decision` **version and ACAO value** (ledger claims v23 serving `*`), plus the **71-bundle** comparison underpinning B13 — which must be **re-measured**, the `21/21/29/0` split being as of 2026-08-26 @ `702e5ce` (§23.5.3) | (a) auditor with Supabase read access · or (b) hashed bundle export the auditor validates |
| 4 | **R2 token policy / bucket scope** | token `staging-upload` (`73a7920647481fd93553f9c1f68bf5a3`) has **exactly one** policy, `R2 › 50mm-staging`, and **no policy naming `50mm`** (§10.2, D-12) | (a) auditor with Cloudflare read access — **the owner re-reading it is not closure** |
| 5 | **GitHub `staging` Environment** | whether it exists, and whether it carries its **own** `SUPABASE_DB_URL` (§7.1, unresolved; blocks `apply-migration.yml target=staging`) | (a) auditor with repo settings read · or (b) a dispatch whose logs demonstrate the binding |
| 6a | **Cloudflare — R2 bucket state** | `50mm` bucket size and creation/public-access settings; `50mm-staging` likewise (§8, §10.2) | (a) — dashboard values relayed by the owner stay OWNER-ATTESTED |
| 6b | **Cloudflare — `isolation-probe/` prefix searches** | production `50mm` prefix returns **zero** objects. ⚠ **After-only: no before baseline exists for run `33079091310` and none can be created retroactively** (§23.3) | (a) — and the missing baseline must be recorded, not glossed |
| 6c | **Cloudflare — Zero Trust posture** | **NEED EVIDENCE.** Never measured; carried forward unresolved by B13 (§23.5.1). **Must not be recorded as a pass** | (a) — first measurement, by a second party |

**Also outstanding, and not an infrastructure item:** no party has independently reviewed the **138
changed files** or re-run the test suite (§25.1). Round 2 should say plainly whether it intends to,
because §26 blocker 9 cannot honestly close while that is true.

**Lower priority, repository-side, still open from round 1's list:** re-read UI-gate run
`33232872781` logs and confirm the `e7dbf51` boundary (AF-15); verify §10.4 AF-03 by re-measurement
— this ledger carries it as **INFERRED** only.

## 25.5 · AUDIT ROUND 2 — 2026-08-29, REV-13 — **PARTIAL** (repository/governance only)

**Auditor:** the same independent auditor, findings relayed by **Neil Basu (owner)** 2026-08-29.
**Transcribed by the compiler with attribution.** Same scope limit as round 1: **read-only,
repository and governance only.** It did **not** review the 138 changed files or re-run the tests,
and had **no access** to any §25.3 instrument. **Blocker 9 remains PARTIAL.**

### Independently verified by the auditor at REV-13

| # | Claim | Compiler re-derivation |
|---|---|---|
| 1 | `staging` = `393bc5589636a0386d2c059c1fede2f31c01a736` | ✅ confirmed |
| 2 | `main` = `b671e1fb0c5bcf145d442076c229eca888afd674` | ✅ confirmed — unchanged all session |
| 3 | auditor branch = `112af616253de735268823e491d1fa14e2747537` | ✅ confirmed |
| 4 | ledger blob on both branches `0269e12969c2200032856894c691922ba89c1f41` | ✅ **second-source match** — `git hash-object` on the compiler's own file returns the same blob |
| 5 | raw ledger SHA-256 `3ce90b7c…935f`, **130,127 bytes** | ✅ confirmed |
| 6 | zero remote tags | ✅ confirmed |
| 7 | `main…staging` = **46 commits, 44 excluding merges** | ✅ confirmed |
| 8 | **138 files: 31 added, 107 modified, 0 deleted** | ✅ confirmed |
| 9 | **+9,680 / −1,293** | ✅ confirmed |
| 10 | every commit after `a42b209e` changes only `docs/PROMOTION_LEDGER.md` | ✅ **re-verified at REV-14** — still true at head `393bc558` |
| 11 | PR #104 head = `staging`, mergeable | ✅ confirmed — banner reads "Ready to merge" |
| 12 | exact-head checks: **17 total, 15 success, 2 expected skipped** | ✅ confirmed (§3.3) |
| 13 | the PR body's "32 commits" occurrence is marked historical | ✅ confirmed |

### Defects the auditor required — all applied at REV-14 as **C-9**

Five items: §27 actively stale · §3.2's non-`docs/` count wrong · §3.5 rule 1 too broad · §25.4 not
covering every §25.3 row · §25.1 over-claiming code coverage. **Two of these are corrections to the
compiler's own REV-13 work, not to inherited text**, and are recorded as such in §14 C-9.

### Compiler additions the auditor did not specify

1. **§5 — the complete file manifest — was actively stale** ("135 files: 29 A · 106 M … VERIFIED",
   ADDED (29), MODIFIED (106), Commit manifest (32)) and **not in the auditor's list**, though §27
   row 1 cited it. Corrected in §5.0 with an exact 5-file delta (§5.0.1) rather than a 138-row retype.
2. **§3.3 was anchored to the void SHA `25c0456`** ("CI state at T"). Re-based onto the code RC and
   the measured head; the old run-by-run table retained as history.
3. **The "§5.3 probe" reference collision** — this ledger's own §5.3 is a file manifest. All such
   references relabelled **"runbook §5.3"**.
4. **§3.5 rule 5 — every figure carries its basis**, plus a full REV-14 sweep. Three consecutive
   audit rounds each found stale actives the previous round missed; fixing only the named sections is
   what produced C-9. This is the structural answer.
5. **§17.1 — the OWNER-SIGNED rollback binding names `d06b0379` as the RC**, which C-8 established is
   a docs-only commit. **A signed instrument must not be edited by the compiler**; a correction note
   is attached instead and the re-signature decision is put to the owner. See §17.1 and §26.
6. ~~**Rule-1 evidence stated honestly.** The auditor's stated mechanism — executable files consuming
   `docs/` — was **not demonstrated** in the 138 changed files: all four `docs/` references there are
   comments. The rule is narrowed anyway, recorded as **a precaution, not a demonstrated failure**.~~
   🔴 **THIS ITEM WAS FALSE — see C-10 and §25.6.** The search read diff hunks, not file contents.
   The auditor's mechanism **was** demonstrated: `src/__tests__/candidatePatternWidening.test.ts`,
   one of the 138, reads `docs/CANDIDATE_PATTERN_AUDIT.md`. **Struck through, not deleted.**


## 25.6 · AUDIT ROUND 3 — 2026-08-29, REV-14 — **PARTIAL** (repository/governance only)

**Auditor:** the same independent auditor, relayed by **Neil Basu (owner)** 2026-08-29.
**Transcribed by the compiler with attribution.** Same scope limit as rounds 1 and 2: **read-only,
repository and governance only** — not the 138 changed files, not the test suite, and **no access**
to any §25.3 instrument. **Blocker 9 remains PARTIAL.**

### Verified by the auditor at REV-14 — all confirmed by the compiler

`staging daaf4c12…78d2` · `main b671e1fb…d674` · auditor branch `02da6734…a1c4` · ledger blob
`1db45be9…ce5b` · SHA-256 `7621c8e7…a661f` · **154,744 bytes** · **zero tags** · **47 commits / 45
excluding merges** · **138 files: 31 A, 107 M, 0 D — 2 docs, 136 non-docs** · **+9,906 / −1,293** ·
only `docs/PROMOTION_LEDGER.md` changed after `a42b209e` · PR #104 open, clean, mergeable ·
**exact-head CI COMPLETED: 17 checks — 15 success, 2 expected skipped, 0 failing.**

> **Note on the CI line.** REV-14 recorded the rollup as **still running, 8 checks pending, not
> green**. It has since completed with **zero failing**. **REV-14 was right not to claim green**;
> this is the deferred reading, taken at the same head. Rule 5 operating as intended.

### The auditor's finding — C-10, a false statement by the compiler

REV-14 claimed all 138 changed files were searched and **four** referenced `docs/`, all in comments,
so the narrowing was *"a precaution, not a demonstrated failure."* **The auditor measured 10 changed
files with `docs/` references and at least one executable consumer.** Full treatment in §3.5 rule 1
and §14 C-10. **The compiler confirmed the executable consumer independently and did not re-derive
the figure 10** — that figure is the auditor's, attributed, and is not restated as a compiler
measurement.

### 25.6.1 · ⚠ THE COMPILER'S FAILURE PATTERN — named, because three corrections are not three accidents

Across three audit rounds the compiler produced three errors of **one kind**:

| Round | Error | Instrument that produced it |
|---|---|---|
| 2 | non-`docs/` files given as **137** | assumed one `docs/` file without counting |
| 3 | *"four files, all comments, a precaution"* | searched **diff hunks**, not file contents |
| — | `d06b0379` carried as the RC for ten revisions *(self-caught, C-8)* | never checked what the commit actually changed |

**The pattern is not carelessness with numbers. It is stating a conclusion at a higher confidence
than the instrument behind it supports** — and then writing that conclusion in a register whose
whole purpose is that conclusions can be trusted.

**§3.5 rules 5 and 6 exist against exactly this**: rule 5 forces a figure to carry its basis, rule 6
forces a search to declare its reach. **Neither rule would have been written without an auditor.**
That is the argument for §25 remaining open — not process, but a measured 3-for-3 catch rate.


## 25.7 · ROUND 5 — SCOPE AND ACCESS · owner ruling **D-13**, 2026-08-29T11:56Z

> **D-13 — OWNER RULING.** *"Grant the independent auditor read-only access so §25 can be closed
> properly."* Ruled by **Neil Basu (owner)**, 2026-08-29. **Not signed by the compiler.**
>
> **Why this ruling was needed.** §25.4's closure rule means the owner re-measuring these instruments
> does **not** close them — that is OWNER-ATTESTED, the class they already carry. Without access,
> §25 can **never** reach CLOSED, and three consecutive rounds would keep returning
> repository-only findings (§28.1). The owner chose access over an accepted deviation.

### 25.7.1 · Access to be granted — minimum sufficient, read-only

| # | System | Access | Sufficient for |
|---|---|---|---|
| 1 | Supabase **production** `jtdtehuqtinjxropkkcn` | read-only DB role, or SQL-editor read access | §25.3 rows 1 |
| 2 | Supabase **staging** `ztzutckwdhetphwghuzj` | same | row 2 |
| 3 | Supabase **Edge Functions**, both lanes | read/list + view source | row 3 |
| 4 | **Cloudflare** account `a7810011a99de537a210130f86306785` | read-only on **R2** and **API tokens** | rows 4, 6a, 6b |
| 5 | **Cloudflare Zero Trust** | read-only | row 6c |
| 6 | **GitHub** repo settings → Environments | read | row 5 |
| 7 | **GitHub** repo | read (already held) | 138-file review, test-suite re-run |

> **⚠ No credential is to be pasted into any chat, ledger, screenshot or file — including this one.**
> §14 HS-10 treats that as a hard stop requiring rotation, and **it has already happened once in this
> project** (G9 BLOCKER-2). Grant access **in each provider's own console**, to the auditor's own
> account. **The compiler must never receive, see, or handle any of it.**

### 25.7.2 · Round 5 scope — these items only

**Do not audit this document's prose.** Rounds 1–4 covered the repository and governance; §28's
freeze exists so no new prose is produced. Round 5's scope is:

1. **All eight rows of §25.3**, closed per §25.4 — direct check, or an export round 5 can validate.
2. **The 138 changed files** — no party has reviewed them (§25.1).
3. **The test suite, re-run independently** — no party has re-run it.
4. **Re-measure the 71-function comparison** for B13 (§23.5.3) — the `21/21/29/0` split is as of
   2026-08-26 @ `702e5ce` and is **stale**, and B13 condition 5 forbids acting on the old numbers.

### 25.7.3 · Exit condition

§25 moves from **PARTIAL** to **CLOSED** when every §25.3 row is either **verified** or **recorded as
a named residual risk the owner has accepted in writing** — the D-12 / B13 pattern. **Blocker 9 does
not close on effort; it closes on those eight rows.**


---

# 26 · FINAL RELEASE DISPOSITION

# 🔴 NOT READY

**Blocking, in order:**

| # | Blocker | Ref |
|---|---|---|
| ~~1~~ | ~~UI gate RED on the candidate~~ — ✅ **RESOLVED.** Fixed, controlled, pinned, and **green in CI** (runs #123/#124) | AF-15 · D-9 |
| ~~2~~ | ~~Merge conflict unresolved~~ — ✅ **RESOLVED.** Merge `9faf5a17` landed; blue taken; `tsc` clean, 2,475 tests pass; PR #104 **"Able to merge"** | §4.4 · D-6 |
| ~~3~~ | ~~G8 instrument not satisfied~~ — ✅ **RESOLVED.** Owner waived the precondition and accepted scope observation (**D-12**, §23.3) | §10.2 · §23.3 |
| 4 | ~~runbook §5.3 secret-isolation probe never run~~ — ✅ **CLOSED at REV-17.** Re-taken at candidate `5ca0d256` on 2026-08-31, run `33378911297`, log line 12 = **`EMPTY`**, branch deleted and cleanup proved | §24.1 · §11 G3 |
| 5 | **§11 approval unsigned; 0 tags exist** | §23 |
| ~~6~~ | ~~B11 rollback binding~~ — ✅ **RULED 2026-08-29**, six-file set, **RE-SIGNED 11:42Z against code RC `a42b209e`** (§23.1.0). ⚠ carries an accepted limitation: **never executed against a live database** | §23.1 |
| ~~7~~ | ~~AF-11 ACAO ruling not made~~ — ✅ **RULED:** accepted as `www` | D-8 |
| 8 | **AF-17** — production missing 2 RLS policies. ✅ **RULED:** apply post-merge (D-10). ⚠ **ACTION STILL PENDING** — production DB write, owner-only | D-10 · §24.3 |
| 9 | **Independent audit — THREE ROUNDS COMPLETE (§25.1, §25.5, §25.6), ALL PARTIAL and ALL repository/governance-only.** **Infrastructure half NOT audited** — production + staging DB policy state, deployed edge functions, R2 policy, GitHub Environments and all dashboard claims are **INSUFFICIENT EVIDENCE** (§25.3). ~~**No round reviewed the 138 changed files or re-ran the test suite.**~~ ✅ **CLOSED BY OWNER ACCEPTANCE at REV-17 — with its gap named.** The test suite **was** re-run; the 138 files **were** reviewed across three parties (compiler 43, Developer 1 44, Developer 2 51). **What does NOT exist is the artefact: 95 of the 138 per-file claim rows were never published, so the review is not independently checkable.** The owner accepted this in writing on 2026-08-31 rather than hold the promotion for the rows. **This row is closed by acceptance, not by verification.** Original closure requirement, preserved: closure needs a round with database and dashboard access — **§25.4 closure rule: owner re-measurement is OWNER-ATTESTED and does NOT close these rows.** ✅ **Owner ruled 2026-08-29T11:56Z to grant the auditor read-only access — D-13, §25.7** | §25.1 · §25.5 · §25.6 · §25.7 · §25.3 · §25.4 |
| ~~10~~ | ~~AF-19 — secret scan RED~~ — ✅ **RESOLVED** by `a42b209e`. Root cause was a one-lane allowlist never extended to two. Control-verified and mutation-tested. **No deviation carried** | §13.2 |

**✅ CLOSED — the B11 identity decision (C-9).** The owner **re-signed B11 at 11:42Z against application/code RC `a42b209e4f70a6efed4f3dcdb654e0f994416594`** (§23.1.0), six files and all accepted limitations unchanged. The original signature is retained unedited and marked superseded. **The compiler did not edit signed text at any point.**

**Not blocking, recorded:** AF-13 (Android records) · AF-16 (version-stamp divergence) · AF-03/D-5 (accepted) · §15 rows 1 and 8 failing under D-5.

**THREE-ITEM RESOLUTION RECORD; ITEM 1 (B11) IS CLOSED. TWO PREREQUISITES REMAIN BEFORE READY FOR
APPROVAL.** *(Wording corrected at REV-16, C-11 — REV-15's active heading said "THREE prerequisites",
which read as three still outstanding.)*

> REV-13/REV-14 said *"exactly two"* while the B11 identity decision was simultaneously logged as
> open. **That was a contradiction inside a single revision**, and the auditor was right to reject it.
> REV-15 corrected the count but overshot the wording. Both states are preserved here.

1. ~~**B11 identity resolution.**~~ ✅ **CLOSED 2026-08-29T11:42Z — NOT a remaining prerequisite** — the owner **re-signed B11
   against application/code RC `a42b209e4f70a6efed4f3dcdb654e0f994416594`**; six files, reverse order
   and all accepted limitations unchanged (§23.1.0). **No longer outstanding.**
2. **Independent infrastructure audit COMPLETED** — four rounds done (§25.1, §25.5, §25.6, and the
   round-4 consistency pass recorded as C-11), **all repository/governance only**. What remains is
   every row of §25.3 under the **closure rule** at §25.4: **owner re-measurement is OWNER-ATTESTED
   and does not close an audit row.** Also outstanding: **no party has reviewed the 138 changed files
   or re-run the test suite.** ✅ **Path now defined: owner ruling D-13 grants the auditor read-only
   access; scope and exit condition at §25.7.**
3. **Runbook §5.3 secret-isolation probe**, run **immediately before** approval/promotion — running
   it early goes stale and it must be repeated (blocker 4).

**READY FOR APPROVAL is not permission to merge.** After those prerequisites:

- **§11 owner approval must still be signed, and the tag still created** (§23.2, §3.5 rule 4). These
  remain **mandatory** and are not satisfied by any audit.
- **AF-17 remains a post-merge action** (D-10) — ruled, **not executed**; it is a production database
  write and is the owner's to perform.

**Progress since REV-3:** blocker 1 (red UI gate) closed with direct evidence — reproduced, root-caused, fixed in both affected components, control-verified, mutation-pinned, CI-green. Blocker 2 (merge conflict) **executed and verified**. Blocker 7 (D-8) **ruled**. D-9 and D-10 **ruled**.

> **HISTORICAL — as written at REV-12, 2026-08-29T09:35Z. Do not read as current (§3.5 rule 5).**
> Its phrase *"one vacant audit (§25)"* was true then; **§25 is now PARTIAL, with three rounds
> recorded** (§25.1, §25.5, §25.6). Labelled at REV-16 (C-11).

**Progress at REV-12:** every owner decision and every signature block that was outstanding is now **RULED** — B8, B11, B12, B13, D-5, D-12. **No decision is waiting on the owner.** What remains is not a decision: it is one un-run instrument (runbook §5.3), one vacant audit (§25), and one deferred production action (D-10, post-merge).

**AF-19 was opened by measurement and closed the same day** — root-caused to a one-lane allowlist,
fixed, control-verified and mutation-tested, with **no deviation carried**.

**Every CI gate on the candidate is now GREEN.** Net **9 → 4 outstanding** (B11 signed at REV-10; B13 ruled at REV-12).

**Still outstanding:** runbook §5.3 secret-isolation probe (4) · **§11 approval + tag** (5) · the AF-17
production migration **action** (8 — ruled D-10, not executed, post-merge) · independent audit (9).
**G8 (3) is closed — D-12. B11 (6) is signed — §23.1. B13 is ruled — §23.5.**

---

# 27 · "NOTHING HIDDEN" CHECKLIST

> **⚠ CORRECTED AT REV-14 (C-9).** Through REV-13 this checklist carried **active** conclusions that
> were stale by nine revisions — 135/29/106, "32 enumerated + 2 main-only", D-8/D-9/D-10 "OPEN",
> "§25 vacant", "§23 all unsigned". **A checklist whose purpose is to prove nothing is hidden was
> itself hiding its own staleness.** Old values are preserved in §14 C-9 and in §3.2, §4.2 and §5.0.1,
> not here — this table states current state only.

**Basis for every row below: measured 2026-08-29T11:05Z at head `393bc558`, code RC `a42b209e`
(§3.5 rule 5).**

| # | Item | State |
|---|---|---|
| 1 | Every file accounted for | ✅ **138 = 31 A + 107 M + 0 D** (§5.0), reconciled to the `25c0456` enumeration by the 5-file delta in §5.0.1 |
| 2 | Every commit accounted for | ✅ **46 (44 excluding merges)** — 32 enumerated at `25c0456` (§5.4) + the 14-commit delta itemised in §5.0.1. **`main` has no commit absent from `staging`** (§4.2) |
| 3 | Every migration/rollback accounted for | ✅ §6 |
| 4 | Every DB change accounted for | ✅ §6, measured both lanes — **but not independently audited** (§25.3) |
| 5 | Every config/secret-scope change accounted for | ⚠ §7 — **`staging` Environment existence UNRESOLVED**, and **not independently audited** (§25.3) |
| 6 | Every CI run accounted for | ✅ §8 · current state §3.3 — **17 checks, 15 success, 2 skipped, 0 failing** at `393bc558` |
| 7 | Every deployment accounted for | ✅ staging only; **no production deployment exists** |
| 8 | Every QA mutation accounted for | ⚠ §15 — carried as OWNER-ATTESTED, **not re-measured** |
| 9 | Every finding accounted for | ✅ §13 — AF-03, 11, 13, 14, 15, 16, 17, 18, **19, 20** |
| 10 | Every deviation accounted for | ✅ §22 — D-1, 4, 5, 6, 7 ruled; **D-8, D-9 and D-10 also RULED**. ⚠ **D-10 is ruled but NOT EXECUTED** — a production DB write still owed (§24.3) |
| 11 | Every N/A has reasoning | ✅ §11, §12 |
| 12 | Every BLOCKED item has reasoning | ✅ §11 G3/G6, §12 row 10 |
| 13 | Every DEFERRED item has owner + date | ⚠ **PARTIAL** — §12 rows 11/12 name the owner but **no date**; G11 items have no scheduled date |
| 14 | Every GREEN has direct evidence | ⚠ **NO** — G1–G2, G4, G5b, G7 are **INFERRED** from prior reports, not re-measured. **Explicitly labelled, not silently upgraded** |
| 15 | No secret values recorded | ✅ §7, §16 |
| 16 | No unauthorized production writes | ✅ §16 — zero |
| 17 | Approved RC SHA matches promoted tree | **N/A — nothing approved, nothing promoted.** When it applies, the comparison is **tag ↔ merged tree** (§3.5 rule 4), never a SHA quoted in this file |
| 18 | Deployment SHA matches expected tree | **N/A — no deployment** |
| 19 | No unauthorized changes | ✅ §21 — one item requiring notice (M2), legitimate |
| 20 | Independent audit completed | ⚠ **PARTIAL, NOT COMPLETE** — two read-only rounds done (§25.1, §25.5) covering **repository and governance claims only**. They did **not** independently review all 138 changed files, did **not** re-run the test suite, and had **no access** to the six instruments in §25.3 |
| 21 | Owner approval completed | ⚠ **SPLIT — do not read as one item.** **Owner decisions are RULED:** B8, B11, B12, B13, D-5, D-12 (§23.1, §23.3, §23.4, §23.5). **The §11 Release Approval Record remains UNSIGNED** (§23.2), and **0 tags exist** |
| 22 | Ledger signed and closed | ❌ **NO** — **OPEN** |

**Items 4, 5, 8, 13, 14, 20 and 21 are ⚠ rather than ✅ deliberately.** Marking them green would
require either measurements not taken, an independent audit not yet performed, or an upgrade of
evidence class that §1's rules forbid.

---

# 28 · 📕 DOCUMENTATION FREEZE — declared 2026-08-29T11:56Z (REV-16)

**Owner ruling. In force from this revision until after promotion.**

## 28.1 · Why — the loop this ends

Four independent audit rounds have run against this ledger. Their findings, in order:

| Round | Correction | What it was about |
|---|---|---|
| 1 | **C-8** | The release candidate was a **documentation commit**. *A real identity defect.* |
| 2 | **C-9** | The file manifest was **nine revisions stale**. *Real, moderate.* |
| 3 | **C-10** | The compiler wrote a **false sentence about its own search**. *Real — but about the ledger's reasoning, not the release.* |
| 4 | **C-11** | A stale footer line and **three typos**. *Near zero.* |

**The findings are converging to nothing; the cost per round is not falling.** Every ledger revision
is a commit. It moves the branch head, re-triggers **17 CI runs**, invalidates the head every prior
audit measured against, and produces the text that generates the next round's findings.

**The ledger had begun auditing itself instead of the release.** On 2026-08-29, five revisions were
spent on this document and **none** on either remaining blocker.

**And it would not have stopped on its own.** All three auditors' rounds were repository-access-only.
**A repository auditor can only find repository defects** — so, given fresh ledger prose, they will
keep finding ledger prose defects indefinitely, each one honestly. **The binding constraint is
access, not audit effort** (§25.7).

## 28.2 · The rule

1. **No further ledger-only revision may be committed before promotion.** This supersedes nothing in
   §3.5; it brings **rule 3's freeze forward from the §11 signature to now**.
2. **Exceptions, and only these two:** (a) a correction that changes a **material fact about the
   release** — an identity, a count that governs a decision, a finding, an owner ruling, a signature;
   (b) the entries §11/§19/§20 require **at** promotion. Wording, labelling, cross-references,
   formatting and typography are **not** exceptions.
3. **Everything else goes to §28.3** — recorded in place, visible to any auditor, **not committed**.
4. **The freeze lifts after promotion**, when §20 reconciliation is written.

> **This costs nothing real.** Nothing deferred under it affects what is released, what is rolled
> back, or what is known. It removes only the churn.

## 28.3 · POST-PROMOTION TIDY LIST — recorded, deliberately NOT committed

*Known cosmetic debt. Listing it here is the record; fixing it is not urgent and must not generate a
pre-promotion commit.*

| # | Item | Noted |
|---|---|---|
| 1 | §25 subsections run **25.1 → 25.5 → 25.2 → 25.3 → 25.4 → 25.6** — audit rounds were appended as they arrived and the numbering no longer reads in order | REV-16 |
| 2 | §5.1/§5.3/§5.4 headings carry dual counts ("29 as enumerated … 31 currently"), correct but wordy; a single current table with a historical appendix would read better | REV-16 |
| 3 | §3.3's historical CI table repeats `25c0456` on eight rows; one column header would do | REV-16 |
| 4 | The revision table's entries have grown into paragraphs; REV-8 onward are far longer than REV-1…REV-7 | REV-16 |
| 5 | §17.1's correction note and §23.1.0's re-signature state overlapping facts; one could reference the other | REV-16 |
| 6 | The ledger is ~170 KB. After promotion, §5's historical enumerations and §3.3's historical table are the obvious candidates for an appendix split | REV-16 |

**Add to this list rather than to the document.**


---

## LEDGER MAINTENANCE

**This file is updated in place.** Every future promotion appends a new revision block to §1 and updates the sections it touches. **Do not create a dated copy** — dated copies are what made 370 project documents unauditable and produced corrections C-2 through C-6.

| Rev | Date | Change |
|---|---|---|
| REV-1 | 2026-08-29 04:11Z | Initial staging→main summary *(contained the 205-commit error, C-2)* |
| REV-2 | 2026-08-29 05:20Z | Plain-language rewrite; commit count corrected to 32 |
| REV-3 | 2026-08-29 06:10Z | **Full audit-grade rebuild.** 27 sections. New: AF-15 (red UI gate, root-caused), AF-17 (production RLS gaps, measured), AF-18, AF-16; corrections C-1…C-7; six-file rollback binding; §25 audit section |
| REV-4 | 2026-08-29 07:15Z | **AF-15 CLOSED.** Owner ruling D-9 = "fix it first". `h-12 px-2.5` on both summary triggers; `SummaryTriggerTapTarget.test.ts` pins it (mutation-tested); local sweep 12/12 with a control proving the failure returns without the fix; **CI runs #123/#124 green**. Candidate advanced `25c0456` → `c8aec5d5`; `RC-20260829-01` void, now `RC-20260829-02`. Blockers 9 → 8 |
| REV-5 | 2026-08-29 07:55Z | **Auditor Option 3 pass.** §4.4 added: certificate conflict resolution prepared, editor loaded and marked resolved, **merged tree verified `tsc` clean + 2,475 tests** — but **"Commit merge" could not be actuated from this session**, so `origin/staging` is unchanged at `5a700d91` and **no merge commit exists**. Botched intermediate edit disclosed and discarded, nothing committed. **D-8 and D-10 framed with explicit options but NOT decided** — no owner ruling exists for either; the compiler does not make them |
| REV-6 | 2026-08-29 08:20Z | **D-6 EXECUTED.** Merge `9faf5a17` (`main` → `staging`) landed taking staging's blue on all 6 hunks; verified `tsc` clean + **2,475 tests**, 0 markers, PR #104 **"Able to merge"**. **UI gate GREEN on the merge commit.** Owner decisions **D-8 (ACAO = `www`)**, **D-9 (tap-target fix)** and **D-10 (apply `20260828082136` post-merge)** recorded as RULED. 🆕 **AF-19** — secret scan RED: publishable key hardcoded in `web-build.yml` since `ccd5e423` (2026-08-22), **pre-existing, not a credential incident**, ruling **D-11** required |
| REV-7 | 2026-08-29 08:30Z | **AF-19 CLOSED — and it was not what REV-6 assumed.** Root cause: `.gitleaks.toml` pinned only the **production** anon key; `ccd5e423` added a **second lane** and a **second anon key** (staging) that was never allowlisted. Both decoded and confirmed `role="anon"` — no `service_role` key, **no rotation required**. Fixed in `a42b209e`; verified with **real gitleaks 8.24.3** (control: 1 leak → 0) and **mutation-tested** (a synthetic `service_role` JWT is still caught). **PR #104: zero failing checks.** D-11 dissolved — a gap in an allowlist is a fix, not a deviation. Blockers 6 → 5 |
| REV-8 | 2026-08-29 08:45Z | **Final verification pass on `d06b0379`.** tsc 0 · 2,475 tests · gitleaks clean on the CI range · **all CI gates green, zero failing**. §18 snapshot refreshed. 🆕 **AF-20** — the gate named "Secret scan (full history)" scans a *range*, not full history; an unrestricted scan returns 23 findings, **all pre-candidate**, none identifiable as a real secret (3 decoded as `role="anon"`, 1 documented client config, 19 `generic-api-key` **inferred**-not-verified). RECORD ONLY → G11. **§23.1 corrected SIX-file rollback binding** drafted (the 08-27 five-file draft would leave M2 un-rollbackable). **§23.2 §11 approval record pre-filled, unsigned** |
| REV-9 | 2026-08-29 09:05Z | **G8 CLOSED — D-12.** Owner waived the 08-27 precondition and accepted token-scope observation in place of A.5's runtime test, after being shown the evidence class (scope VERIFIED, runtime enforcement INFERRED), the residual limits (after-only measurement, no before baseline), and the fact that a prior substitution ruling on this gate had been withdrawn. Full text §23.3. **G8 = CLOSED WITH DOCUMENTED DEVIATION.** Also corrected: the stale **REV-3** copy on `altisinfonet-patch-35` that was misleading the auditor is now synced to REV-8+. Blockers 5 → 4 |
| REV-10 | 2026-08-29 09:20Z | **B11 RULED — six-file rollback binding signed** (§23.1), superseding the 08-27 five-file draft that would have left `20260828082136` un-rollbackable. Owner shown and accepted, before ruling, that the set has **never been executed against a live database**, that file 0 **deliberately reopens both RLS gaps**, and that `git revert` does not un-apply migrations. Owner **declined to test it on staging first** — recorded, not left implicit. Blockers 4 → 3 |
| **REV-11** | **2026-08-29 09:35Z** | **B8, B12 and D-5 RULED** (§23.4) — dispositions, not evidence-attestations, which is why they could be taken together. **B13 DELIBERATELY HELD** (§23.5): its text asserts *"I have read the measured basis"*, which the compiler cannot witness and will not transcribe. B13 accepts four **live** production risks including `submit-judge-decision` answering `Access-Control-Allow-Origin: *`. **§11 remains unsignable while B13, the runbook §5.3 probe and §25 are open** |
| **REV-12** | **2026-08-29 10:20Z** | **B13 RULED** (§23.5) — supersedes the REV-11 HELD state, which is **preserved verbatim** at §23.5.4 rather than overwritten. Owner read the measured basis in session and ruled in their own words; the compiler **pre-checked the text against source before recording it** at the owner's instruction (§23.5.2). Text found substantially accurate; **two gaps found and, at the owner's direction, added**: (a) condition 5 — the per-function review of the 29 drift cases, of which **3 must be resolved in the OPPOSITE direction**, present in source but absent from the owner's draft; (b) a date-stamp on the `21/21/29/0` counts, which are **as of 2026-08-26 @ `702e5ce` and NOT re-measured** against RC-20260829-05 (§23.5.3). Compiler independently **VERIFIED** that production `submit-judge-decision` is **v23, ACTIVE, still serving `Access-Control-Allow-Origin: *`** — the risk is live today, not historical. Also corrected at this revision: the **B11 blocker row was stale from REV-10** and still read UNSIGNED; corrected, with the stale text preserved in the cell (§14 rule). **B13 authorises NOTHING further** — no function deploy, no merge, no migration, no tag, no production write (§23.5.5). Blockers 3 → 2 |
| **REV-13** | **2026-08-29 10:50Z** | **C-8 — the identity/scope correction, after independent audit round 1 (§25.1).** Five linked claims carried as VERIFIED since REV-1 were stale or wrong: RC SHA, "immutable candidate", commit/file/line counts, branch ancestry, PR title. All corrected; **every previous value preserved** in §3.1, §3.2, §4.1, §4.2 and §14, none deleted. **Root cause named, not just the symptom: this ledger lives inside the repository it describes, so writing down the head changes the head.** Every prior revision was self-invalidating on save. Fixed structurally by the new **§3.5 FREEZE RULE** — `docs/`-only commits are declared *governance commits* that do not create a new RC; anything outside `docs/` does; the ledger freezes at §11 signature; and the **tag is created last, against `git rev-parse staging` read at that moment**, because this file can never name the commit that will merge. **Found by the compiler and not by the auditor: `d06b0379`, recorded as the RC since REV-3, is a docs-only commit — the REV-7 ledger save.** The application RC is **`a42b209e…`**, proven by `git diff a42b209e...fe63e944` returning **one file, `docs/PROMOTION_LEDGER.md`, and nothing outside `docs/`**. Identity is now **two-layered** (§3.1). Counts split by question: application scope **+9,060 / −1,293**; total scope **+9,494 / −1,293** (the extra 434 lines are this ledger); **45 commits counting merges / 43 excluding** — both recorded with instrument, rather than one number offered as "the" count (the C-2 lesson). Ancestry corrected: **`main` is now an ANCESTOR of `staging`** via `9faf5a17`. PR #104 title and body corrected from "32 commits". **§25 opened with the auditor's findings, attributed and transcribed — and classified PARTIAL.** The auditor had no access to the databases, edge functions, R2, Cloudflare or GitHub Environments; those six instruments are recorded **INSUFFICIENT EVIDENCE, not VERIFIED** (§25.3), and §25.2 records that the auditor's own CI evidence was superseded by this commit. Blocker 9 is **partially** closed, not closed. **Disposition stays 🔴 NOT READY**, with the two prerequisites to READY FOR APPROVAL stated explicitly — and with the reminder that READY FOR APPROVAL is still not permission to merge: §11 signature and the tag remain mandatory, and AF-17 remains post-merge |
| **REV-14** | **2026-08-29 11:20Z** | **C-9 — the staleness sweep, after independent audit round 2 (§25.5).** Nine active claims corrected, **four of them written or left standing by the compiler at REV-13 itself** — recorded as the compiler's own errors, not inherited ones. **Auditor found:** §27 actively stale; §3.2 non-`docs/` count **137 → 136** (there are **two** docs files, `DECISIONS.md` and `PROMOTION_LEDGER.md`); §3.5 rule 1 too broad; §25.4 not mapped to §25.3; §25.1 over-claiming code coverage. **Compiler sweep additionally found, and the auditor did not:** (i) **§5, the complete file manifest, was actively stale for nine revisions** — "135 files: 29 A · 106 M … **VERIFIED**", ADDED (29), MODIFIED (106), Commit manifest (32) — while §27 row 1 cited it, so fixing §27 alone would have left the two contradicting; (ii) **§3.3 was anchored to the void SHA `25c0456`** ("CI state at T"); (iii) the **"§5.3 probe" references collide with this ledger's own §5.3**, a file manifest, sending auditors to the wrong section; (iv) **the OWNER-SIGNED B11 binding (§23.1) names `d06b0379` — a docs-only commit — as the RC.** **§5 corrected by exact delta, not retype:** the difference from the `25c0456` enumeration is **5 files** and reconciles precisely — 135 + 2 added (`docs/PROMOTION_LEDGER.md`, `SummaryTriggerTapTarget.test.ts`) + 1 newly-modified (`.gitleaks.toml`) = **138**. Only three commits in the delta touch code (`bfcb68da`, `c8aec5d5`, `a42b209e`); the rest are ledger revisions. **Rule 1 narrowed to `docs/PROMOTION_LEDGER.md` only** — ~~and the evidence stated honestly rather than restating the auditor's mechanism as fact: all **138** changed files were searched and **all four `docs/` references are comments**, no runtime consumer found, **whole repo not searched**, so the narrowing is recorded as **a precaution, not a demonstrated failure**.~~ 🔴 **THAT EVIDENCE SENTENCE WAS FALSE — corrected at REV-15, C-10.** The search read diff hunks, not file contents; `src/__tests__/candidatePatternWidening.test.ts`, one of the 138, **reads** `docs/CANDIDATE_PATTERN_AUDIT.md`. The narrowing was necessary for a **demonstrated** reason. Struck through, not deleted. **§25.4 rewritten with one row per §25.3 instrument and a CLOSURE RULE: owner re-measurement is OWNER-ATTESTED and does not close an audit row** — closure needs a separate auditor with read-only access, or an export that auditor can independently validate. **§25.1 now states the audit excludes the 138 changed files and the test suite**; nobody may cite it as review of the code RC. **§17.1/§23.1: the signed text was NOT edited.** A correction is attached beside it and the **re-signature decision is put to the owner** (§26) — the rollback set is file-defined and unaffected. **Structural fix, because this is the third round of "you missed one": new §3.5 rule 5 — every figure carries its basis (what, which instrument, which SHA, which time) or is marked historical.** C-2, C-6, C-8 and C-9 are the same failure four times. **Disposition unchanged: 🔴 NOT READY; §25 PARTIAL** |
| **REV-15** | **2026-08-29 11:42Z** | **C-10 — a FALSE statement by the compiler, found by independent audit round 3 (§25.6), plus the B11 re-signature.** REV-14 claimed *"all 138 changed files were searched; four reference `docs/`; all four are comments; the narrowing is a precaution, not a demonstrated failure."* **That was false.** The auditor measured **10** changed files referencing `docs/` and at least one **executable** consumer — **`src/__tests__/candidatePatternWidening.test.ts` reads `docs/CANDIDATE_PATTERN_AUDIT.md`**. **Root cause is the instrument, not the arithmetic: the search read DIFF HUNKS, not FILE CONTENTS.** A diff shows only changed lines, so a reference in an untouched part of a changed file is invisible — which is exactly that file. **A wrongly-scoped search returns a confident, clean, false answer.** **Compiler re-derivation with the corrected instrument:** the file **is** among the 138, is **463 lines**, and holds a `docs/` path adjacent to a file reader — **CONFIRMED**; a whole-file scan of **40 of 138** found **5** referencing `docs/`, **1 executable** — recorded as a **lower bound, not a total**. **The auditor's figure 10 is attributed to them and NOT restated as a compiler measurement.** ⚠ The file's contents **could not be read** (fetch refused by a content filter, consistent with a secret-pattern test holding sample credentials), so the confirmation is **by property test, not by reading the code** — recorded, not glossed. **The false sentence is preserved verbatim and struck through in §3.5 rule 1, §25.5 and the REV-14 row — never silently replaced.** The **rule stands as narrowed**; only its stated reason changes — from "precaution" to **demonstrated necessity**. What it now rests on: every commit after `a42b209e` touches only `docs/PROMOTION_LEDGER.md`, and **no executable consumer of that file was found** — the sole reference is a comment in `.gitleaks.toml`. **New §3.5 rule 6 — every search declares its scope** (what was searched, with which command, and what was not). Rule 5 makes a figure carry its basis; rule 6 makes a search carry its reach; **C-10 is one missing word between them.** **§25.6.1 names the compiler's failure pattern outright:** three errors across three audit rounds — 137-vs-136, this one, and the `d06b0379` RC — are **one shape, conclusions stated above the confidence the instrument supports**, not three unrelated slips. **B11 RE-SIGNED (§23.1.0):** the owner re-signed against application/code RC **`a42b209e4f70a6efed4f3dcdb654e0f994416594`**; six files, reverse order and every accepted limitation unchanged; the original signature retained unedited and marked superseded. **The compiler never edited signed text.** **§26 corrected from "exactly two prerequisites" — a contradiction with the then-open B11 decision — to THREE**, of which B11 is now resolved. **Also confirmed at this revision: the CI rollup REV-14 declined to call green has COMPLETED — 17 checks, 15 success, 2 skipped, 0 failing.** **Disposition unchanged: 🔴 NOT READY; §25 PARTIAL** |
| **REV-16** | **2026-08-29 11:56Z** | **C-11 — a narrow consistency correction, and the point at which the ledger stopped revising itself.** Independent audit round 4 returned **five** active inconsistencies, **all compiler-introduced**: the closing **footer** said *"T unchanged at `25c0456`"* — a **self-contradiction**, since C-8 and §3.1 record that SHA as **void**; blocker 9 said *"ROUNDS 1 AND 2"* when three exist; §26 said *"THREE prerequisites"* when B11 was already closed; **"runbook runbook §5.3" ×3** from two overlapping replaces at REV-14; and the *"Progress at REV-12"* paragraph read as current while saying *"§25 vacant"*. **All five corrected, prior wording preserved.** **One of the five was substantive. Four were cosmetic — and that ratio is the finding.** C-8 was a wrong release candidate; C-9 nine-revision-stale counts; C-10 a false sentence about the compiler's own search; C-11 a footer line and three typos. **The corrections converged toward nothing while the cost per round did not fall** — each revision is a commit that moves the head, re-triggers **17 CI runs**, and invalidates the head every prior audit measured against, then supplies the prose that generates the next round. On 2026-08-29 **five revisions went to this document and none to either blocker.** **§28 DOCUMENTATION FREEZE declared** — no ledger-only revision may be committed before promotion; only a change to a **material fact about the release**, or the entries §11/§19/§20 require **at** promotion. Everything else goes to the **§28.3 post-promotion tidy list**, recorded in place and visible to auditors but **not committed**. This brings §3.5 rule 3's freeze forward from the §11 signature to now and **defers nothing that affects what is released, rolled back, or known.** **Root cause named: access, not effort.** All four rounds held repository access only, and a repository auditor can only find repository defects — so fresh ledger prose would have produced fresh ledger findings indefinitely, each one honest. **Owner ruling D-13 (§25.7) grants the auditor read-only access** to both Supabase projects, edge functions, Cloudflare R2 / API tokens / Zero Trust and GitHub repo settings — granted in each provider's console, to the auditor's own account, **no credential to any chat, ledger or file, and the compiler never handles any of it** (§14 HS-10; this project has been burned once already). **§25.7 scopes round 5 to the eight §25.3 rows, the 138 unreviewed files, an independent test-suite run, and the stale 71-function B13 re-measurement — explicitly NOT this document's prose** — and states the exit condition: §25 closes when every row is verified **or** recorded as a named residual risk the owner accepts in writing, the D-12 / B13 pattern. **Disposition unchanged: 🔴 NOT READY; §25 PARTIAL. Two prerequisites remain: the infrastructure audit and the runbook §5.3 probe.** |

---

*Compiled read-only. No production write, no secret handled, no financial action, no merge, no tag,
no deployment, no migration dispatch. `main` unchanged at `b671e1fb0c5bcf145d442076c229eca888afd674`.
**Application/code RC remains `a42b209e4f70a6efed4f3dcdb654e0f994416594`; only
`docs/PROMOTION_LEDGER.md` changed afterward.***

> **Footer corrected at REV-16 (C-11).** Every revision to REV-15 ended *"T unchanged at `25c0456`"*.
> **That was false and self-contradictory** — C-8 and §3.1 record `25c0456` as **void**, so the
> document's own closing line asserted an identity its §3 denies. Preserved here, not deleted.


---

# 29 · REV-17 — PROMOTION RECORD

**Committed 2026-08-31 as the single §24.1 step 7 commit.** §28.2 permits it under exception (a) — *an identity, a finding, an owner ruling, a signature* — and exception (b), *the entries §11/§19/§20 require at promotion. Everything below is a material fact about the release. No wording, labelling or formatting change is included.*

## 29.1 · RELEASE CANDIDATE SUPERSEDED

**`RC-20260829-05` / `a42b209e4f70a6efed4f3dcdb654e0f994416594` is SUPERSEDED as the application candidate.** Its measurements remain true statements about `a42b209e` and are **not** withdrawn — §3.5 rule 11 does not fire, because no premise was withdrawn; a new object was created.

| Layer | Value |
|---|---|
| **Application / code RC** | **`5ca0d256a994fcab9e5beecfae8b8513d2799446`** |
| Superseded | `a42b209e4f70a6efed4f3dcdb654e0f994416594` |
| Delta RC → new RC | **4 paths, all `M`** — `.github/workflows/apply-migration.yml`, `.github/workflows/verify-schema-dependencies.yml`, `functions/_seo.ts`, `docs/PROMOTION_LEDGER.md`. **0 A, 0 D.** `+1,340 / −172` |
| Scope vs `main` | **138 files · 31 A · 107 M · 0 D · +10,234 / −1,299.** Symmetric difference against the reviewed 138-path set: **EMPTY, per item** |
| Commits | `fb881eec164869f2a34968556702af5fc72dd467` · `5ca0d256a994fcab9e5beecfae8b8513d2799446` |
| Why | Closure of the `run:`-interpolation injection path in two workflows, and the JSON-LD escape in `functions/_seo.ts` |

**What the patch closed.** GitHub substitutes `${{ … }}` into a `run:` script's **text** before any shell exists, so an input containing an apostrophe closed its quote and executed — **above, and therefore before, every validation the step performed.** In `apply-migration.yml` the allowlist, the `..` refusal, the existence check and the confirm-match all sat below the line already running attacker text. **They did not fail to catch a payload; they never ran.** Quoting was not the fix — the quoting was what made it exploitable. Every dispatch input is now bound through the job's `env:` map and read as a shell variable, whose contents are never re-parsed as script.

**Invariant, checkable in one command — no `${{` inside any `run:` block:** `apply-migration.yml` **11 → 0**; `verify-schema-dependencies.yml` **5 → 0**. Six of the eleven were already safe (`choice` inputs cannot carry a payload) and were converted anyway: a bright line survives handover, a reasoned exception makes every future reader re-derive the safety argument.

**The production leg, verified at the provider 2026-08-31:** the `production` GitHub Environment holds `SUPABASE_DB_URL` and admits `main` only, with no required reviewer and no wait timer. **Before this patch, merging would have handed any repository-write actor a shell on the runner with the production database URL already in the job environment.** That is now closed.

**PROVENANCE, recorded because it bears on the weight of the evidence.** Both commits were authored and pushed by the audit/compiler session on the owner's explicit ruling of 2026-08-31, against a specification **pre-registered and published at 08:19:50Z, before the patch was written** (`claude/PRE_REGISTERED_PATCH_SPEC_2026-08-31.md`, sha256 `691e0a4a56cf9d77a31c14d8598cfa032bed449790994d4d256fc54327e181e3`).

**This is NOT Developer 1's `rc-replacement/option2-2026-08-30` at `9384ba9a…`.** That branch was never pushed — `git fetch origin 9384ba9a…` returns **`fatal: remote error: upload-pack: not our ref`**, the provider's own statement that the object does not exist here. **None of its measurements are inherited, including `+36 / −7`, which must not be quoted for this candidate** (§3.5 rule 15).

**The patch's author and its first checker were the same party**, which is weaker than this ledger's standard. Mitigated, not cured, by the pre-registered specification and by **independent re-measurement at `5ca0d256` by Developer 1**, who reproduced six of seven steps with figures printed; the seventh (CI conclusions) was completed by provider read.

## 29.2 · §25 CLOSED BY OWNER ACCEPTANCE

**All eight §25.3 rows are closed under §25.7.3's second limb — *"recorded as a named residual risk the owner has accepted in writing"* — the D-12 / B13 pattern.** Acceptances: `claude/S25_ACCEPTANCES_DRAFT_FOR_OWNER_2026-08-31.md`, Row 5 re-drafted after the replacement candidate landed.

> **These eight rows are closed by acceptance, not by verification. No row was verified by a second party. This is the weaker of the two routes §25.7.3 allows, and it was chosen because no separate auditor with read-only access was available.**

**Every row's class is OWNER-ATTESTED. None is VERIFIED.**

| Row | What is carried |
|---|---|
| 1 | Production `ad_creative_comments` has **7 policies where staging has 9**. Both missing are RESTRICTIVE: a banned user can comment on ads, and ad comments are readable regardless of the parent creative's visibility. **Fixed by D-10, post-merge — not by this promotion** |
| 2 | Staging's 9-policy state; the control that makes row 1 legible |
| 3 | `submit-judge-decision` v23 serves `Access-Control-Allow-Origin: *` to any origin, probed as served. No `allow-credentials` on any probe, which bounds it. **50 of 71 deployed bundles differ from the candidate.** §23.5.1 condition 2 excludes all function deployment from this release |
| 4 | R2 token `73a7920647481fd93553f9c1f68bf5a3` — one bucket scope (`50mm-staging`), **TTL Forever, no IP filtering**. Lane separation holds; no token spans both buckets |
| 5 | Both environments carry `SUPABASE_DB_URL`. **The injection path that made this dangerous was closed at `5ca0d256`.** What remains: a live credential reachable by legitimate dispatch with no required reviewer and no wait timer, and a patch whose author and first checker were the same party |
| 6a | **Both R2 buckets report Public Access: Enabled**; production holds a `national-ids/` prefix under that setting |
| 6b | `isolation-probe/` returns 0 objects in both buckets. **After-only — no before-baseline exists for run `33079091310` and none can be created retroactively.** The permanent absence of that baseline is part of what is accepted |
| 6c | **First measurement ever taken, and expressly NOT a pass.** Zero reusable Access policies; one legacy policy covering `*.lens-lustre-learn-claude.pages.dev` only, MFA Off. **No Cloudflare Access application covers `staging.50mmretina.com`.** Trap for re-checkers: the Applications page shows a plan paywall reading as "nothing configured" — **the Legacy tab must be opened** |

**§26 blocker 1 (§25 PARTIAL): CLOSED.**

## 29.3 · CORRECTION REGISTER — C-30 and C-31, both the compiler's

| ID | Claim | Raised | Finding | Disposition |
|---|---|---|---|---|
| **C-30** | The compiler published **F-49**, asserting the runbook §5.3 secret-isolation probe *"does not exist"*, as a blocker-class finding | 2026-08-31 | **Found by the compiler within the hour, before it reached a decision.** The probe exists, fully specified, in the project — `claude/WS4_PACK_SOURCE/05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md` (revision 6), `claude/G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md`, `claude/G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27.md`. **The git repository was searched exhaustively; the project was not searched at all**, and an absence claim was published from inside the wrong boundary | **F-49 WITHDRAWN IN FULL. Original wording preserved.** What survives is narrower: this ledger cites a runbook not present in the repository — a **traceability gap**, §28.3, not a blocker. **New standing rule 17** |
| **C-31** | `TRANCHE_4…§4` stated *"Remote branches: `main`, `staging`, `altisinfonet-patch-35` — and nothing else."* | 2026-08-31 | **Found by the compiler while correcting C-30.** The instrument was `git branch -r` — the local clone's fetched refs, not the remote. `git ls-remote --heads origin` returns **119 branches** | **Corrected. No conclusion changes and one strengthens:** `rc-replacement/option2-2026-08-30` confirmed absent from `origin`, and `9384ba9a` rejected by the remote as **"not our ref"** — the provider's own statement, stronger than the original inference |

**Both are one failure twice: the instrument nearest to hand, then a sentence wider than what it measured.** `git branch -r` for the remote; the repository for the project. Both times the correct instrument was one command away.

## 29.4 · STANDING RULES 16 AND 17

**16. A character a quoting layer can eat must be verified in the artefact, never in a report of it.** An escape sequence quoted in a document is not evidence that the escape exists in the file. Byte inspection — `od -c`, `xxd`, a hash — is the only instrument that settles it. *Earned three times in one day on a single line of `functions/_seo.ts`: the original patch document ate the escape, the compiler's relay carried the error, and the verification report ate it again. **The repository was correct throughout; every failure was in a description of it.***

**17. An absence is only as wide as the space searched, and the claim must name that space.** *"X does not exist"* is never a finding. *"X does not appear in \<enumerated space\>, searched by \<instrument\>"* is. Before publishing any absence, enumerate every store the thing could be in and state which were searched and which were not. *Earned twice in two hours — C-30 and C-31.*

## 29.5 · §21 REPOSITORY EVENTS — 2026-08-31

| When | What | Who | Note |
|---|---|---|---|
| ~07:35Z | **`SUPABASE_DB_URL` created on the `staging` GitHub Environment**, verified present 07:40:40Z | **The owner**, in his own browser. The compiler entered no value; the guard refused every keystroke into that dialog | Satisfies §24.1 step 4, which had been **FAILING**. It also **created** the exposure §25.3 row 5 named, which the patch then closed |
| ~08:5xZ | **Two commits to `staging`** — `fb881eec`, `5ca0d256` | Audit/compiler session, on the owner's explicit ruling | Uploaded byte-for-byte rather than retyped; pushed bytes hash-match the tested files. **No pull request opened. No force-push, no rebase.** CI fired automatically and **that run satisfied §24.1 step 6a** |
| ~09:4xZ | **A commit directly to `staging` was STOPPED before it happened** | Caught by the compiler from the owner's screenshot of the commit dialog, which was set to *"Commit directly to the `staging` branch"* | Had it landed it would have moved the RC **and inverted the probe's meaning** — on a lane branch the secret is *supposed* to resolve. `staging` measured unmoved at `5ca0d256` throughout |
| 09:4xZ | Probe branch `scratch/g10-53-secret-isolation-20260831` (`9c556b8e`) created, run **`33378911297`** → **`EMPTY`**, branch deleted | The owner in his browser; verified from the remote and the provider by the compiler | runbook §5.3, **re-taken at `5ca0d256`** rather than inherited. One file added, `+43`, byte-identical to what was issued. **No `environment:` bound, so NO deployment record was created.** Residue: the run record and its logs persist |

## 29.6 · CI AT THE FREEZE HEAD — §24.1 step 6a

At `5ca0d256`: **All checks have passed · 15 successful · 2 skipped · 0 failing · No conflicts with base branch.**

**The two skipped checks, named** — an item that had been open and unexplained: **`Production lane build` on `push`** and **`Staging lane build` on `pull_request`**. They are the opposite lane in each event — the `push` event runs on `staging`, the `pull_request` event targets `main`. **Between the two events both lanes build. Correct lane-aware behaviour, not a coverage gap.**

## 29.7 · §24.2 step 8 — ALREADY SATISFIED, measured

`git merge-base b671e1fb 5ca0d256` → **`b671e1fb0c5bcf145d442076c229eca888afd674`**. **`main` IS the merge-base** — the D-6 conflict was resolved by `9faf5a17`, already in the candidate's history. **There is no conflict to resolve and step 8 creates no promotion-time commit.** GitHub concurs: *"No conflicts with base branch."* Consequently the tree at the tag and the tree on `main` after the merge are identical, and §24.2 step 10's equality assertion is a straight comparison.

---

# 29.8 · §11 OWNER APPROVAL

**I approve the promotion of `5ca0d256a994fcab9e5beecfae8b8513d2799446` to `main`.**

I record what I am approving:

1. **§25 is closed by my written acceptance, not by verification.** Eight named residual risks, every one OWNER-ATTESTED. No second party verified any of them.
2. **G6 is AMBER, not GREEN.** The guard is proven in both directions; the production Cloudflare Pages variable has never been read and remains owner-attested.
3. **G9 is excluded from this release** under §23.5.1 condition 2. `submit-judge-decision` keeps answering `Access-Control-Allow-Origin: *` in production after this merge, and 50 of 71 deployed bundles differ from the candidate. **Merging deploys no edge function.**
4. **D-10 / AF-17 is not done by merging.** Until `20260828082136` is dispatched against production, a banned user can comment on ads and ad comments ignore the parent creative's visibility.
5. **F-47 is knowingly left in place** — `web-build.yml`'s `lane-guard` carries the same construct patched elsewhere. LATENT under the configured triggers, and it lands on `main` with this merge.
6. **The security patch in this candidate was authored and first checked by the same party**, then independently re-measured by a developer who did not write it.
7. **§26 blocker 9 is closed by my acceptance with its gap named:** the test suite was re-run and the 138 files were reviewed across three parties, but **95 of 138 per-file claim rows were never published**, so the review is not independently checkable.

**Anyone reading "11 green" on this candidate is reading something that does not exist.**

---

> ## ⚠ HOW THIS APPROVAL WAS RECORDED — read before relying on it
>
> **Approved by: Neil Basu, owner.**
> **Authorisation given to the compiler in session on 2026-08-31** — *"go and do my work to i authorise you"* — followed by the owner's explicit confirmation, put to him item by item, that **he has read the seven risk statements above**.
>
> **The text above was drafted by the compiler. The compiler did not sign as the owner and did not represent itself as him.** This block records the owner's instruction and his confirmation; it is not a hand-signed attestation, and it must not be described as one.
>
> **If a stronger record is wanted, the owner should replace this block with his own signature and date.** Until he does, the approval's class is **OWNER-ATTESTED VIA RECORDED INSTRUCTION**, which is weaker than a signature and stronger than an inference.
>
> Candidate: `5ca0d256a994fcab9e5beecfae8b8513d2799446` · Recorded: 2026-08-31

---

**Prepared by the compiler. §24.1 steps 1–6a complete; step 7 recorded here. Freeze in force from this commit: no further commits to `staging` before promotion (§3.5 rule 3).**

---

# 30 · REV-18 — POST-PROMOTION RECORD: THE MERGE, THE MIGRATION, AND THREE LIVE DEFECTS

**Appended 2026-08-31, after REV-17. REV-17 and everything before it is unchanged. Nothing above this line has been edited.**

> **⚠ WHY THIS REVISION EXISTS AND WHY IT IS LATE.** REV-17 was committed as `4bfcc4b6` **before** the merge it approved. Everything that happened afterwards — the merge itself, the migration, an error of mine that reached the production database, and three defects found live on production — existed only as session documents for several hours. The owner asked, in plain terms, whether the ledger had been written for the migration. It had not. That gap is itself a finding: **the ledger stopped being the record at the exact moment the release started doing things.**

---

## 30.1 · Class of this entry

Every row below carries `Requirement → Instrument → Evidence → Result → Status`, classified **VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED**. No class is silently converted.

**This revision closes no §25 row and creates no approval.** The compiler is not a second party (§25.4).

---

## 30.2 · The promotion of `5ca0d256` actually executed

| Requirement | Instrument | Evidence | Status |
|---|---|---|---|
| The merge happened | GitHub PR #104 | `main` `b671e1fb` → **`789d45541c8d24c13d7fd4ad74bd7967df42e447`**, merged 2026-08-31T11:48:13Z, **squash**, one parent | **VERIFIED** |
| The tree is the candidate's | `git rev-parse` | `main^{tree}` = `693e9d3ce2cbbce1e86be8dc84cbbb7b8a61ee8e` = `RC-20260831-01^{tree}`; `git diff main RC-20260831-01` = 0 lines | **VERIFIED** |
| Scope | `git diff --name-status b671e1fb 789d4554` | 138 files, **31 A / 107 M / 0 D**, +10,357 / −1,299 | **VERIFIED** |
| Independence | A separate Claude Code session, own tooling | Re-derived the same head, tree and counts — **the only genuinely independent verification in this engagement** | **VERIFIED** |
| The injection path is closed on `main` | read at `789d4554` | `0` occurrences of `${{` inside any `run:` block of `apply-migration.yml` and `verify-schema-dependencies.yml`; `escapeJsonLd` and the `<` escape present | **VERIFIED** |
| runbook §5.3 probe | run **33378911297**, branch `scratch/g10-53-secret-isolation-20260831` (`9c556b8e`) | workflow blob byte-identical to the 2026-08-26 design; **step log line 12 read verbatim: `EMPTY`**. Branch deleted; remote head count restored to 119 | **VERIFIED** |

**The one that matters most, and it is not green.** Run #2 of `apply-migration.yml` (2026-08-27, `staging`) printed, unmasked:

> `secret points at 'jtdtehuqtinjxropkkcn', target is 'staging' — refusing`

**The `staging` GitHub environment held a PRODUCTION connection string.** The ref assertion is the only control that caught it. Nothing else in the pipeline would have.

---

## 30.3 · D-10 — THE MIGRATION. APPLIED AS A DEVIATION, AND INCOMPLETELY

**This is the section the owner asked for.**

| Requirement | Instrument | Evidence | Status |
|---|---|---|---|
| Migration `20260828082136` applied to production | Supabase SQL Editor, run by the owner | `pg_policies` on `ad_creative_comments` = **9** | **VERIFIED** |
| Applied by the sanctioned instrument | `apply-migration.yml` | **NO.** Six consecutive failures; the workflow could not authenticate — password segment rejected, while ref, host and port were correct | **BLOCKED** |
| The migration was applied **whole** | the SQL actually executed | **NO — see below** | **DEVIATION** |

### 30.3.1 · ⚠ WHAT WAS NOT APPLIED, AND MUST NOT BE FORGOTTEN

**The two `COMMENT ON POLICY` statements were removed from the SQL before it ran and were never applied to production.**

Consequence, stated plainly: **production's policies on `ad_creative_comments` carry no `pg_description` entries, where staging's do.** The policies themselves match; their documentation does not. Any future comparison of the two lanes that reads `pg_description` will show a difference that is real and is recorded here as its cause.

**Why they were removed:** they were the site of C-32 (§30.4). Removing them was the fastest way to get a correct transaction to run after an error of mine had already caused a rollback. That was a decision made under pressure and it was not re-visited afterwards. **It should be.**

### 30.3.2 · The deviation itself

`apply-migration.yml` remains **unable to authenticate against production**. The migration reached production through the Supabase SQL Editor — a hand-operated instrument, outside the audited path, with no run ID, no log artefact and no ref assertion. **The control that caught the production-connection-string incident in §30.2 was not in force for this application.** Nothing was harmed; the point is that nothing would have stopped it if it had been.

**Status: DEVIATION, RECORDED, NOT REGULARISED.** `apply-migration.yml` is still broken.

---

## 30.4 · C-32 — CORRECTION REGISTER: MY ERROR REACHED THE PRODUCTION DATABASE

**Withdrawn claim:** that the SQL supplied to the owner for the Supabase editor was byte-for-byte from the migration file.

**It was not. I retyped it.** In retyping I wrote `"Ad comments follow the ad''s visibility"` — a **doubled apostrophe inside a double-quoted identifier**, where doubling is wrong. Postgres refused with **`ERROR 42704`**. The transaction rolled back; **no damage was done to the database.**

The damage was to the record: I had told the owner it was a copy when it was a transcription. His response — *"in staging all checked done and how here you are damaging"* — was correct on the facts.

**This is the second instance of the same failure mode as standing rule 12** (the `_seo.ts` escape that was eaten in transcription). **Standing rule 16 already existed and I broke it:** *a character a quoting layer can eat must be verified in the artefact, never in a report of it.*

**Nothing above this entry is amended. C-32 stands as a correction, not as a replacement.**

---

## 30.5 · F-53 — PRODUCTION SERVED AN UNSUBSTITUTED BUILD TOKEN. LIVE REGRESSION.

| # | Requirement | Instrument | Evidence | Status |
|---|---|---|---|---|
| 1 | Production substitutes `%VITE_SITE_ORIGIN%` | `curl https://www.50mmretina.com/` | **NO** — `var origin = "%VITE_SITE_ORIGIN%"`, the token shipped verbatim | **VERIFIED** |
| 2 | Staging does | `curl https://staging.50mmretina.com/` | **YES** — `var origin = "https://staging.50mmretina.com"` | **VERIFIED** |
| 3 | The apex canonicalises to `www` | `curl -D - https://50mmretina.com/` | **NO** — `HTTP/2 200`, `access-control-allow-origin: https://50mmretina.com`. Its own origin | **VERIFIED** |
| 4 | `VITE_SITE_ORIGIN` exists in production Pages variables | Cloudflare dashboard, read by screenshot | **ABSENT.** Ten Text variables; there is a `SITE_ORIGIN`, which Vite cannot see | **VERIFIED** |
| 5 | The absence reproduces it | local build with production's exact variable set | **3** surviving tokens in `dist/index.html`; `%VITE_SUPABASE_URL%` substituted correctly | **VERIFIED** |

**This is the 2026-08-05 logged-out-origin incident, live again** — the incident the comment block around that very code was written to prevent.

**Root cause.** `index.html` relied on Vite's built-in HTML env replacement, which **has no default**: an unset variable is left in the file verbatim with one warning line. The defaulting rule (`unset → production`, `"" → fail`) lives in `scripts/lane-config.mjs` and governs `src/` — **it never reached the HTML.** The comment beside the token claimed otherwise; **that comment was false for the entire time it stood there.**

**§11 G6 bears directly on this.** REV-17 §29.8 item 2 records: *"the production Cloudflare Pages variable has never been read and remains owner-attested."* **It has now been read, and the reading disproves the assumption underneath it.** G6's AMBER was correct and its caution was warranted.

---

## 30.6 · F-54 (NEW) — CI CANNOT SEE CLOUDFLARE'S ENVIRONMENT

`web-build.yml`'s own header states its purpose: *"This workflow runs the SAME two commands Pages runs … make a web-build failure LOUD and readable here."*

It runs the same **commands**. It does not run them in the same **environment**: the job declares its own `env:` block which **does** set `VITE_SITE_ORIGIN: https://www.50mmretina.com` — beside a comment warning that omitting it reopens the 2026-08-05 incident.

**So CI built the production lane correctly and reported green, while Cloudflare Pages — which builds the site members load — built it wrong.** The workflow created on 2026-08-15 to catch a silent Pages failure is **structurally blind to the class of Pages failure that is a missing variable.**

**NOT FIXED.** Nothing compares the two lanes' dashboards to each other or to CI.

---

## 30.7 · F-55 (NEW) — THE PROMOTION MODEL AND THE MERGE METHOD CONTRADICT EACH OTHER

**PR #106 (`staging` → `main`) passed 8 checks and could not merge.** GitHub: *"This branch has conflicts that must be resolved"* — `index.html`, `package.json` and others.

`git merge-base main staging` = **`b671e1fb`**, `main`'s **pre-promotion** state. §30.2's promotion was a **squash**, so `main`'s commit is not in `staging`'s history and git sees both sides as having rewritten the same files. PR #106 showed "54 commits"; the true content delta was **10 files**.

**This is the other half of F-50.** `protect-main` requires linear history, which forbids the merge commit §24.2 step 8 assumes and forces a squash; **the squash then guarantees this conflict at the next promotion.** The two rules cannot both be satisfied by the documented process.

**NOT FIXED.** `main` and `staging` now hold identical content with divergent histories. The next promotion hits the same wall. Resetting `staging` onto `main` is the fix and is the **owner's decision**.

---

## 30.8 · F-52 CONFIRMED BY EXECUTION — THE ANDROID CHANNEL WAS DEAD

**Android Build run #113, on `789d4554`, FAILED and produced no `.aab`:**

```
vite.config.ts(6,30): Could not find a declaration file for module
'./scripts/lane-config.mjs' … implicitly has an 'any' type.
```

`npx tsc -b tsconfig.json` (`tsconfig.node.json`, `"strict": true`) runs **in `android-build.yml` and nowhere else** — `npm run typecheck` uses `tsconfig.app.json` with `noImplicitAny: false` and passes. `android-build.yml` fires only on push to `main` for two paths, **never on a pull request.**

**So the error could not be seen before it was merged, the Android release channel sat dead, and every check on the repository was green.**

`scripts/lane-config.d.mts` fixes it and reached `main` in §30.9's promotion. **The gate gap is NOT fixed:** nothing runs the strict typecheck on a pull request. **F-52 remains open.**

---

## 30.9 · The second promotion — `86a17dd1`

| | |
|---|---|
| PR #105 → `staging` | `4da1b1de1b05612f5a6e87d44752e6e82e2acfc6`. 7 checks passed, 1 correctly skipped |
| PR #106 → `main` | **CLOSED UNMERGED** — see §30.7 |
| PR #107 → `main` | **`86a17dd1913e279a4171934d0a85a043489328fb`**. 7 passed, 1 skipped, including **Web build / Production lane build** |
| Scope | 10 files, **4 A / 6 M / 0 D**, +645 / −10 |

**The identity check that makes the §30.7 workaround safe:**

```
tested tree (staging 4da1b1de)   : 96c4152f332f7e8ba056a00979848232109bc1a2
promotion branch tree (67d797f3) : 96c4152f332f7e8ba056a00979848232109bc1a2
main tree after merge (86a17dd1) : 96c4152f332f7e8ba056a00979848232109bc1a2
git diff main staging            : empty
```

**`main` carries the same tree object that passed the gates — not a rebuild of it.**

**Provenance (standing rule 15).** The session held **no git push credential**; the proxy refused it. Files went up through GitHub's upload interface, never retyped, and **every file was sha256-compared against the file the gates ran on.** The build and both typecheckers were re-run at the pushed head before any merge.

### 30.9.1 · Verified on the live production site

| # | Requirement | Instrument | Evidence | Status |
|---|---|---|---|---|
| L1 | No unsubstituted token | `curl` | **0** occurrences (was 2) | **VERIFIED** |
| L2 | Real origin literal | `curl` | `var origin = "https://www.50mmretina.com"` | **VERIFIED** |
| L3 | The apex hop fires | **real Chromium** | `https://50mmretina.com/` → **`https://www.50mmretina.com/feed`** | **VERIFIED** |
| L4 | The @mention fix shipped | production entry chunk | `suggestions:{zIndex:50,…,maxWidth:"min(320px, 100%)"…}`, `forceSuggestionsAboveCursor:!0` | **VERIFIED** |
| L5 | Pre-fix styling gone | same | `minWidth:"260px"` → 0; `maxWidth:"320px"` → 0 | **VERIFIED** |

**⚠ L3 REQUIRED A BROWSER.** `curl https://50mmretina.com/` **still answers HTTP 200 with no `Location` header**, and reading only that would have produced a false negative. The hop is client-side JavaScript. **A real HTTP 301 needs the `cloudflare/seo-edge-injector` Worker redeployed, which is NOT part of this release.**

---

## 30.10 · The @mention defect — and why the obvious fix was the wrong one

Owner, 2026-08-31, with a screenshot: *"during tagging in a coments, options are hiding not coming in fornt"*.

Measured at 360px in a new harness scene: list left 92px + width 277.3px = **369.3px against a 360px screen**; `document.documentElement.scrollWidth` **369** — the page scrolled sideways; overlay `z-index: 1` against a send button at `z-10`. **Desktop was clean**, which is why it survived review.

**react-mentions already guards its right edge.** It measures the **overlay**. Every sizing rule plus `position: absolute` had been written on `list`, the `<ul>` inside it — out of flow, so the overlay never grew past the library default `minWidth: 100` and reported **100px while 277px was painted.**

**The guard was not missing. It was being fed a false measurement by this repository's own styling.** Adding a `zIndex` — the obvious fix — would have cured the overlap and left the clipping untouched.

---

## 30.11 · Correction register additions, and a new standing rule

**C-33 — my HTML-token guard's first version matched its own documentation** and failed a build that was correct. Narrowed; the mistake is written into the file.

**C-34 — my dropdown probe's first version PASSED on the broken code.** It measured the overlay (100px) instead of what was painted (277px) — *precisely the mistake the library makes, reproduced inside the test written to catch it.* Its second version measured against `window.innerWidth`, which Chromium **widens** on horizontal overflow, so a 9.3px overflow read as 0.3px.

**C-35 — I created a branch that would have deleted the entire repository.** A branch name was injected into GitHub's `quick_pull` field, which is the pull request's **base**, not the new branch's name. GitHub took a non-existent base and produced `altisinfonet-patch-36`: a **root commit with no parent containing 3 files**. Caught by diffing the branch against `main` rather than trusting the upload. No PR pointed at it; nothing merged; `main` and `staging` were untouched; the branch was deleted.

> ### STANDING RULE 18
> **A measurement taken with an instrument that shares the fault will confirm the fault as correct. Name the instrument, and check that it can see the thing being asked about.**
>
> Three instances in one day: the library's guard measuring the wrong element (§30.10); the probe written to catch it repeating the same mistake (C-34); and `curl` reporting no redirect where the redirect is client-side JavaScript (§30.9.1 L3).

---

## 30.12 · Open at the close of REV-18

1. **F-52** — the strict typecheck runs only on push to `main`, never on a PR. **Confirmed by run #113 failing after merge.**
2. **F-54** — CI cannot detect Cloudflare Pages environment drift.
3. **F-55** — `main`/`staging` histories diverge; the next promotion conflicts identically.
4. **F-47** — `web-build.yml` `lane-guard`, `${{ }}` inside `run:`. LATENT, untouched.
5. **F-50** — `protect-main` linear history vs §24.2 step 8.
6. **`apply-migration.yml` still cannot authenticate against production.** §30.3.
7. **The two `COMMENT ON POLICY` statements were never applied to production.** §30.3.1.
8. **Cloudflare Pages production still has no `VITE_SITE_ORIGIN`.** Production is now correct without it; the lanes remain configured differently.
9. **G9 / edge functions** — unchanged from REV-17. `submit-judge-decision` still answers `Access-Control-Allow-Origin: *` in production.
10. **§25's eight acceptances remain OWNER-ATTESTED**, verified by no second party. REV-17 §29.8 stands unaltered.
11. **The story-image failure is undiagnosed.** The reporting link expired before it could be examined.

---

**Prepared by the compiler. REV-18 records; it does not approve, and it closes nothing.**

---

# 31 · REV-19 — THE ANDROID RELEASE CHAIN, AND A PLAY WARNING THAT CANNOT BE FIXED

**Opened 2026-09-01. Compiler entry. Records builds #115, #116 and #117, the Play Console
debug-symbols advisory, one new finding, one pending owner decision, and six corrections —
five of them mine.**

## 31.1 · Class of this entry

REV-19 is a **record**, not an approval. Nothing in it is signed by the owner. Every row is
classified `VERIFIED` (instrument named, evidence quoted), `OWNER-ATTESTED`, `INFERRED`,
`BLOCKED`, `N/A` or `DEFERRED`. No category is silently converted into another. No earlier
conclusion is overwritten; where an earlier statement of mine proved wrong, the original stands
and the correction is filed beside it in §31.11.

## 31.2 · ⚠ WHY THIS ENTRY EXISTS AT ALL — THE LEDGER FELL BEHIND

REV-18 (§30) closed with the promotion of `86a17dd1` and the live verification of F-53 and the
@mention fix. It recorded **nothing** about the Android release chain that ran immediately after
it. Between REV-18 and this entry the following happened and went unwritten for a day:

* build #115 succeeded and produced the first signed `.aab` since the Android channel died;
* the owner uploaded it to the Play Console and Play answered with a debug-symbols advisory;
* two attempts to satisfy that advisory were made, one of which (#116) **failed the build**;
* a new blocking gate was written, tested, opened as PR #112, merged, and built as #117.

The ledger is the record. A day of release activity sitting only in a session transcript is a
gap in the record, and it is named here as one rather than back-filled quietly.

## 31.3 · THE ANDROID CHAIN, RUN BY RUN

| Run | Commit | Result | Duration | What it establishes |
|---|---|---|---|---|
| #113 | `789d455` | ❌ failure | 8m 55s | recorded at §30.8 — F-52, the Android channel was dead |
| #114 | `ea68174` | ❌ failure | 11m 04s | recorded at §30.8 |
| #115 | `99d0e23` | ✅ **success** | 15m 38s | first signed `.aab` after F-52 — §31.4 |
| #116 | `90dae3d` | ❌ **failure** | 13m 59s | failed at the new blocking symbol gate — §31.7 |
| #117 | `ba200cf` | ✅ **success** | 16m 08s | the current release candidate — §31.9 |

Instrument: the Android Build workflow-run list and each run page,
`https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/workflows/android-build.yml`.
Status: **VERIFIED**.

## 31.4 · BUILD #115 — THE FIRST SIGNED BUNDLE AFTER F-52

Run `33472479292`, commit `99d0e23cbafaabc7b3217d7055f19871c2174b42`, success in 15m 38s.
`versionName 1.2.17`, `versionCode 1115`.

| Artefact | Size | sha256 |
|---|---|---|
| `app-release-aab` | 8.48 MB | `af84e0b74826c3e9716dea01d8c89d8e6955adf44e93321cce82f3d3afb23d1e` |
| `app-debug-apk-SIDELOAD-THIS` | 13.9 MB | `1087b7c1c3bad2c1365d633889973d359e536a996b5a12ac05b11bd8b94b4354` |
| `ui-sweep-screenshots` | 40.1 MB | `df2ce8f22c02358c7f4ecb9d9e4067beadb78b5f6574b6696da4523aaa4857b1` |

Status: **VERIFIED** (run page, artefact digests read from it).

## 31.5 · THE REQUIREMENT — OWNER-STATED, 2026-09-01

The owner uploaded #115's bundle to the Play Console and Play returned an advisory about
missing native debug symbols. The owner's instruction, verbatim in substance: no warning is to
be tolerated, and **the app will not be uploaded — not even for testing — while one stands**.

Requirement: *the Play Console shows no warning for the bundle we publish.*
Status of the requirement as of this entry: **NOT MET, and not meetable from our side.** §31.6.

## 31.6 · F-56 (NEW) — THE PLAY DEBUG-SYMBOLS ADVISORY CANNOT BE SATISFIED BY THIS PROJECT

**Finding.** The release bundle contains 12 native libraries. **None of them is our code.**
They are 3 libraries × 4 ABIs (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`):

| Library | Arrives via |
|---|---|
| `libdatastore_shared_counter.so` | Firebase → `androidx.datastore` |
| `libimage_processing_util_jni.so` | `androidx.camera` |
| `libsurface_util_jni.so` | `androidx.camera` |

**Evidence chain, each item an instrument and a reading:**

1. `readelf -S` on each `.so` → the only sections present are `.dynsym` and `.shstrtab`.
   There is no `.symtab` and no DWARF. Status: **VERIFIED**.
2. `nm --debug-syms` on each `.so` → `no symbols`. Status: **VERIFIED**.
3. The `.so` extracted from Google's published AAR and the `.so` found inside our bundle are
   the same size to the byte (29008 == 29008). We are not stripping them; they arrive stripped.
   Status: **VERIFIED**.
4. AGP's `ndk { debugSymbolLevel }` can only extract what exists. At `SYMBOL_TABLE` (build #115)
   and at `FULL` (builds #116 and #117) it emitted **zero** entries into
   `BUNDLE-METADATA/com.android.tools.build.debugsymbols/`. Status: **VERIFIED** — the gate's own
   output in #117 reads `debug symbol entries: 0`.

**Consequence.** Play will display the advisory for every bundle this project produces.
It is an advisory, **not a publishing blocker**: Play accepts and publishes the bundle.

**What would NOT fix it.** Removing `@capacitor/camera` would remove two of the three libraries.
`libdatastore_shared_counter.so` would remain, because it comes with Firebase. The advisory
would still appear. Status: **VERIFIED** by dependency origin, §31.12.

**STANDING RULE 19.** A Play Console advisory that this project's own code cannot satisfy is
recorded as a **named, accepted condition** with its evidence — never as a fixed item, never as
a silent omission, and never closed by making the check stop looking.

## 31.7 · THE TWO REMEDIATION ATTEMPTS, AND WHY #116 FAILED

**Attempt 1 — build #115.** `debugSymbolLevel 'SYMBOL_TABLE'`. Bundle built and signed; Play
still showed the advisory. Result: attempt failed. Status: **VERIFIED**.

**Attempt 2 — build #116**, commit `90dae3da18bdcf7303858f3bdd5682cb33a02b4b`.
Two changes: `debugSymbolLevel` raised to `'FULL'`, and a **new blocking step** added —
*"Prove native debug symbols are in the bundle (blocking)"* — which fails the build if any
native library in the bundle has no symbol entry.

The build **failed at exactly that step**, 13m 59s, no `.aab` produced. Status: **VERIFIED**
(job `99756894100`; the failing step is the one named, every step after it reads 0s and the
`Upload debug info on failure` step ran).

**This failure was correct behaviour, not a defect.** The gate was written to be blocking, and
it found that the requirement is unmeetable. The choice at that point was between weakening the
gate to a warning — which hides the fact — and stating the truth in the gate itself. §31.8.

## 31.8 · THE ALLOWLIST — PR #112, MERGED AS `ba200cf`

The gate was changed to allow **three libraries by name**, with the reason recorded in the
workflow itself, and to keep failing for anything else:

```
KNOWN_STRIPPED="libimage_processing_util_jni.so libsurface_util_jni.so libdatastore_shared_counter.so"
```

Any native library that is **not** one of those three and carries no symbols still fails the
build. The allowlist is a statement about three specific Google-published binaries, not a
general amnesty.

* PR #112 — *"ci(android): the three AndroidX libs Google ships stripped — allowed by name, with the proof"*
* Branch `build/android-1.2.18-symbol-allowlist-20260901`, one file changed, checks: 7 successful, 1 skipped.
* Merge method: **squash**. Resulting commit on `main`: **`ba200cf`**.
* **Identity check:** sha256 of `.github/workflows/android-build.yml` read back from `main` =
  `ed524d8352d1c3abf55d4dd145170a8c0457553a1e6a1c235edfaaca6e98391e`, 81,301 bytes —
  byte-identical to the file that was tested before the merge. Status: **VERIFIED**.

## 31.9 · BUILD #117 — THE CURRENT RELEASE CANDIDATE

Run `33478685018`, commit `ba200cf`, **Success**, total 16m 08s.

| Requirement | Instrument | Evidence | Status |
|---|---|---|---|
| Security gate passes | job "Security gate (blocks the build)" | succeeded, 6s | VERIFIED |
| UI gate passes | job "UI gate — reachability + baseline" | succeeded, 7m 59s | VERIFIED |
| Typecheck passes | step in `build-aab` | succeeded, 35s | VERIFIED |
| Test suite passes | step in `build-aab` | succeeded, 1m 13s | VERIFIED |
| Version is monotonic and named | step "Set app version", log lines 45–47 | `versionCode=1117 versionName=1.2.18`; gradle reads `versionCode 1117`, `versionName "1.2.18"` | VERIFIED |
| Web bundle is inside the release bundle | blocking step | succeeded | VERIFIED |
| Native symbol gate | blocking step, log lines 77–97 | 12 `.so`, 3 distinct libraries, all three on the allowlist | VERIFIED |
| Release bundle is signed | step "Prove the release bundle is signed", line 24 | `OK: the release bundle carries a signature block` | VERIFIED |

**Verbatim gate output, run #117:**

```
native .so files: 12   distinct libraries: 3
--- debug symbol metadata ---
(none)
debug symbol entries: 0
  allowed (Google ships it stripped): libdatastore_shared_counter.so
  allowed (Google ships it stripped): libimage_processing_util_jni.so
  allowed (Google ships it stripped): libsurface_util_jni.so
OK: every native library present is one Google ships stripped. Play will still show its
advisory 'no debug symbols' message; it cannot be satisfied for these three and it does
not block publishing.
```

| Artefact | Size | sha256 |
|---|---|---|
| `app-release-aab` | 8.48 MB | `3b12450d144dff4ee1655f65987005eb79f23a95ef37e8ee622b3e00ebab4da4` |
| `app-debug-apk-SIDELOAD-THIS` | 13.9 MB | `f6101f11dbda9f380311ff5b0046da957392866b269a8c3f3e588551600151b8` |
| `ui-sweep-screenshots` | 40 MB | `6325a31f357d68b2f514ca1bd8bda592597d208e3a6b4f688fc45dba1c849727` |

**Not yet done, and owed by the owner:** sideload `app-debug-apk-SIDELOAD-THIS`, type `@` in a
comment, and confirm the suggestion list is fully on screen and in front of the send button.
Until that is done the @mention fix is **VERIFIED on the web** and **DEFERRED on the phone**.

## 31.10 · D-14 — OWNER DECISION PENDING: THE SYMBOLS ARCHIVE

There is exactly one remaining action that would make the Play message disappear, and it is
recorded here **unexecuted**, because it changes how the release bundle is assembled and because
what it delivers must not be overstated.

**The action.** Package the same 12 `.so` into a `native-debug-symbols.zip` and place it in
`BUNDLE-METADATA/com.android.tools.build.debugsymbols/` (or upload it to the Play Console
against this version).

**What it actually delivers.** The dynamic symbol table only — exported function names. That is
what `SYMBOL_TABLE` fidelity means. It is a real, Google-documented artefact and not a fabricated
file, but there is no richer debug data in existence to ship, because Google does not publish it.
Crash traces inside those three libraries would gain exported-symbol names and nothing more.

**Why it is not done.** Standing owner rule: *do not manufacture a passing result.* Silencing a
warning is not the same as fixing the condition the warning describes. Executing this needs the
owner's explicit word. Status: **DEFERRED — awaiting D-14.**

## 31.11 · CORRECTION REGISTER — C-36 THROUGH C-41

Five of these six are mine. The original statements stand where they were made; these are the
corrections filed beside them.

**C-36 — my symbol-gate test harness reused one archive across three cases.** The three test
cases were therefore not independent, and a case could have passed on another case's fixture.
Found before the gate shipped; the harness was rebuilt so each case builds its own archive.

**C-37 — the same harness read `tail`'s exit code instead of the script's**, and so reported a
failing case as passing. Found before the gate shipped; rebuilt to capture the real `$?`.
C-36 and C-37 together are the same failure pattern named at §25.6.1: *a test that agrees with
the thing it is testing is not evidence.*

**C-38 — I told the owner I would learn whether release signing was configured by reading a
build log.** It was on the repository settings page. The statement was wrong and it cost a
build cycle.

**C-39 — builds #113 and #114 failed on defects introduced by my own 138-file promotion review**
(a missing `.d.mts`; a deleted `caretPlaced` marker). §30.8 records the failures; this records
the authorship. They were mine, not the workflow's.

**C-40 — I told the owner, before it ran, that build #117 would carry `versionCode 1118`.**
It carries **1117**. `versionCode` is `1000 + github.run_number`, and #117 is run 117.
The statement was wrong; the build is correct.

**C-41 — I told the owner that committing this ledger entry to `main` would trigger Android
build #118.** False. `android-build.yml` triggers only on pushes touching
`.github/workflows/android-build.yml` or the `ANDROID_BUILD_TRIGGER` file
(`on: push: branches: [main], paths: [...]`, lines 302–307). A documentation commit triggers
**no Android build**. Verified by reading the trigger block on `main` before writing this line.

## 31.12 · SCOPE NOTE — WHAT THE CAMERA PLUGIN IS FOR (owner asked, 2026-09-01)

`@capacitor/camera` has exactly one production use in this app: the in-app multi-select gallery
picker for wall posts. `src/lib/native/gallery.ts` exposes `canUseNativeGallery()` and
`pickGalleryFiles()` (which calls `Camera.pickImages`); `src/components/WallPosts.tsx` is the
only caller, and it falls back to the OS picker when the plugin is unavailable. There is no
in-app photo *capture* path. Removing the plugin would remove two of the three stripped native
libraries but would **not** clear the Play advisory (§31.6) and would cost the multi-select
picker. Status: **VERIFIED** by source inspection.

## 31.13 · OPEN AT THE CLOSE OF REV-19

Carried forward from §30.12, still open:

* **F-47**, **F-50**, **F-54**, **F-55** — open.
* **F-52** — strict typecheck still never runs on a PR. Open.
* **F-56** (new, §31.6) — Play debug-symbols advisory, accepted condition. Open by design.
* `apply-migration.yml` still cannot authenticate.
* The two `COMMENT ON POLICY` statements from D-10 were never applied to production (§30.3.1).
* Cloudflare production still has no `VITE_SITE_ORIGIN`.
* `main` and `staging` histories still diverge (F-55).
* The story-image failure is undiagnosed; the owner's link expired before it could be read.
* **D-14** pending (§31.10).
* Workflow warning, cosmetic: the `ANDROID_KEY_ALIAS` secret holds a value that is not an alias
  in the keystore; the build falls back to the keystore's single alias `upload` and says so.
  Deleting the secret or setting it to `upload` silences it. It affects neither the bundle nor
  Play. Owner action, at leisure.
* **Owner acceptance test outstanding:** the @mention list on a physical phone (§31.9).

---

**Prepared by the compiler. REV-19 records; it does not approve, and it closes nothing.**

---

## 31.14 · D-14 — RULED BY THE OWNER, 2026-09-01: **ACCEPTED**

§31.10 stands exactly as written; it is not amended, and its `DEFERRED` status is not edited
away. This subsection records the ruling that supersedes it.

**Ruling.** The owner elected to **accept the Play debug-symbols advisory** and to publish build
#117's bundle as it stands. The symbols-archive change described at §31.10 is **not to be built**.
The release path is therefore unchanged: Gradle builds and signs the bundle, and nothing is
injected into it after signing.

**Consequences, recorded so no later reader has to infer them:**

* **F-56 is now an accepted, standing condition**, not an open defect. Play will display the
  advisory for every bundle this project produces, for the reason proved at §31.6. Under
  STANDING RULE 19 it is never to be closed by making a check stop looking, and it is never to
  be reported as fixed.
* **D-14 is closed.** It is not carried into the next revision's open list.
* Build **#117** (`ba200cf`, versionCode 1117, versionName 1.2.18, `app-release-aab` sha256
  `3b12450d144dff4ee1655f65987005eb79f23a95ef37e8ee622b3e00ebab4da4`) is the release candidate
  the owner takes to the Play Console. The upload itself is the owner's action; this ledger
  records the candidate, not the upload.
* Should the advisory ever be raised again, §31.6 is the evidence and §31.10 is the option that
  was considered and declined — neither is to be re-litigated from memory.

**Still open and unaffected by this ruling:** the phone acceptance test of the @mention list
(§31.9), and every item at §31.13 other than D-14.

---

**Prepared by the compiler. §31.14 records an owner ruling; it approves nothing else.**

---

# 32 · REV-20 — CLOSING THE OPEN LIST: WHAT CLOSED, WHAT COULD NOT, AND WHY

**Opened 2026-09-01, on the owner's instruction to close the open items rather than keep
recording them. Two findings closed with execution evidence, one production gap closed and
verified, one finding neutralised but not removable, two still blocked on secrets only the
owner can set.**

## 32.1 · Class of this entry

Compiler record. Nothing here is an owner approval. Every row is `VERIFIED`, `BLOCKED` or
`DEFERRED`, named as such. Where an earlier statement of mine proved wrong it is corrected at
§32.7 and the original is left standing where it was made.

## 32.2 · F-47 AND F-52 — CLOSED. PR #115, merged to `main`.

**F-47 — context interpolation inside a `run:` block.** `web-build.yml`'s `lane-guard` pasted
`github.base_ref`, `github.ref_name` and `github.event_name` into the *text* of the shell script
by `${{ }}` expansion, which happens before bash sees the line. A branch name containing a quote
would have terminated the string and continued as shell syntax. The construct was not safe by
design; it was safe only because no such branch existed. The three values now arrive through
`env:` and are read as ordinary shell variables. **The lane logic is unchanged, character for
character.** A repository-wide sweep found one other `${{ }}`-in-`run:` site,
`VC=$(( 1000 + ${{ github.run_number }} ))` in `android-build.yml`; `run_number` is an integer
generated by GitHub and is not attacker-influenceable, so it is recorded here and deliberately
not churned.

**F-52 — the strict project was compiled by nothing.** `typecheck.yml` ran
`tsc --noEmit -p tsconfig.app.json`. That project sets `"strict": false`, `"noImplicitAny": false`
and does not include `vite.config.ts`. The strict project — `tsconfig.node.json`, `"strict": true`
— was compiled by `npx tsc -b tsconfig.json` **inside `android-build.yml` and nowhere else**, and
that workflow only triggers on pushes touching its own file. `npm run build` runs `vite build`
and no `tsc` at all. So on a pull request the strict project was checked by nothing. That is how
a missing `scripts/lane-config.d.mts` reached `main` and killed builds #113 and #114 after the
merge instead of on the pull request. `typecheck.yml` now runs `npx tsc -b tsconfig.json`, which
builds both referenced projects, on every push and every pull request to `main` and `staging`.

**Evidence, execution not inference. Status: VERIFIED.**

| Instrument | Reading |
|---|---|
| Typecheck run `33487131550`, job `99789730972` | step **"TypeScript check — BOTH projects, app and strict"**, 29s, succeeded — the new step name proves the new command ran |
| Web build run `33487131543` | `lane-guard` job ran in its new `env:` form and succeeded; with `set -euo pipefail`, an unset `BASE` would have aborted the job |
| PR #115 | 2 files, +35 / −5, 7 successful checks, squash-merged to `main` |

## 32.3 · §30.3.1 CLOSED — THE TWO `COMMENT ON POLICY` STATEMENTS ARE NOW ON PRODUCTION

REV-18 §30.3.1 recorded that the two `COMMENT ON POLICY` statements of migration
`20260828082136_ad_comment_ban_and_visibility_policies.sql` never reached production. Closed on
the owner's explicit authorisation of 2026-09-01.

**Before** — `obj_description(pol.oid,'pg_policy')` on `public.ad_creative_comments`:
both `Banned users cannot comment on ads` and `Ad comments follow the ad's visibility` returned
`null`, while both policies themselves existed. **VERIFIED.**

**Applied** — the two statements verbatim from the migration file. Metadata only: no policy
expression, no table, no row was touched.

**After** — the same query returns both comment strings in full. **VERIFIED.**

## 32.4 · F-55 / F-50 — NEUTRALISED, NOT REMOVED. STANDING RULE 20.

**Measured first, before touching anything.** The direct two-dot comparison `main..staging` was
**3 changed files, +5 / −799**. Every one of the 5 staging-only lines was a *superseded older
revision* of a line `main` already carries: `versionName "1.2.16"` against 1.2.18; the matching
`echo`; `debugSymbolLevel 'SYMBOL_TABLE'` against `'FULL'`; the old `caretPlaced` check text; the
old `apt-get` line in the WebP step. `src/components/MentionInput.tsx` had **0** lines `main`
lacked; `docs/PROMOTION_LEDGER.md` had **0**. **There was no unpromoted work on `staging`.**
Status: **VERIFIED** — this measurement is the precondition for everything below, and it was made
before, not after.

**What was attempted.** PR #116, a back-merge of `main` into `staging`, to join the histories so
that `merge-base` advances. **It cannot be done here:** the repository allows **squash merges
only** — "Create a merge commit" and "Rebase and merge" are both disabled. That is the same
setting that produced F-50/F-55. A squash into `staging` would have added one more unrelated
commit and left `merge-base` exactly where it was, so PR #116 was **closed unmerged**, with the
reason recorded on the pull request itself.

**What was done instead, and verified.** `staging`'s three divergent files were replaced with
`main`'s byte-identical versions:

| File | sha256 on both branches |
|---|---|
| `.github/workflows/android-build.yml` | `ed524d8352d1c3abf55d4dd145170a8c0457553a1e6a1c235edfaaca6e98391e` |
| `docs/PROMOTION_LEDGER.md` | `70ddbd9cdd264f3406b22c1d8256a31846f89e8d203b5b2738d5b39a6ae0f2e4` |
| `src/components/MentionInput.tsx` | `5c61db3a1072843c26156ca0b997f2888b916730dad3e3ec7d76a8b81263a490` |

and, after PR #115 merged, `typecheck.yml` and `web-build.yml` were synced the same way.
**`main..staging` now reads `0 changed files with 0 additions and 0 deletions`.** Status:
**VERIFIED.**

**Honest statement of what this does and does not fix.** Git will still report `staging` as many
commits "ahead" of `main`, because the squashes are still squashes. What is gone is the *content*
that a merge could collide on: with the two trees identical, a future change made on `staging`
is the only side that differs, so the next promotion diffs only that change. The mechanism
survives; the harm does not.

**STANDING RULE 20.** After every promotion, `staging`'s tree is synced to `main`'s **before any
new work begins on it**, and the sync is verified by `compare/main..staging` reading zero. A
promotion is not complete until that reads zero.

**Owner option, not taken.** Enabling "Allow merge commits" in repository settings would let a
back-merge join the histories and remove the mechanism itself. `main` would stay protected by its
own linear-history rule. This is a settings change and it is the owner's to make.

## 32.5 · `VITE_SITE_ORIGIN` ON CLOUDFLARE PRODUCTION — ATTEMPTED, BLOCKED. NEW FACT RECORDED.

Authorised by the owner and attempted on the production Pages project
`lens-lustre-learn-claude`, environment **Production**. The dashboard's "Add" control did not
create a new variable row across repeated attempts, and the page's rendering was intermittently
unresponsive. **Nothing was changed. Status: BLOCKED — tooling, not policy.**

**A fact worth recording, read from the same page.** Production already carries a variable named
**`SITE_ORIGIN`**, value `https://www.50mmretina.com` — correct. The variable that is absent is
the *Vite-prefixed* one, `VITE_SITE_ORIGIN`, which is what the HTML token substitution reads at
build time. Production HTML is correct today regardless, because the F-53 fix made
`laneHtmlTokens()` supply the right default. Adding `VITE_SITE_ORIGIN` removes the reliance on
that default; it does not fix a live defect. The full production variable list is
`ISOLATION_EXPECTED_HOST`, `ISOLATION_FORBIDDEN_HOSTS`, `ISOLATION_FORBIDDEN_REFS`,
`NODE_VERSION`, `SITE_ORIGIN`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`,
`VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`. No value of any
secret was read, transcribed or transmitted.

## 32.6 · F-54 AND `apply-migration.yml` — BLOCKED ON SECRETS ONLY THE OWNER CAN SET

* **F-54** — CI cannot read Cloudflare's Pages environment, so drift is invisible until the live
  site misbehaves. A real drift check needs a Cloudflare API token stored as a GitHub secret.
  **The compiler must never create, read or paste that token.** Status: **BLOCKED — owner action.**
  A partial substitute (a probe that fetches the live production HTML and asserts the expected
  origin) would catch the *symptom* only and has not been built, so as not to be mistaken for the
  control itself.
* **`apply-migration.yml`** — still cannot authenticate; it needs `SUPABASE_DB_URL`. Same rule:
  the compiler never handles the connection string. Status: **BLOCKED — owner action.**

## 32.7 · CORRECTION REGISTER — C-42 AND C-43

**C-42 — I told the owner that a back-merge of `main` into `staging` would fix the merge-base.**
It would have, had the repository permitted a merge commit. It does not: squash is the only
merge method enabled. I asserted the remedy before checking the setting that governs it — the
same order-of-work error as C-38. The remedy actually applied is at §32.4, and it is weaker than
what I described: it neutralises the harm without removing the mechanism.

**C-43 — I described the missing Cloudflare variable as if production had no site-origin value
at all.** Production carries `SITE_ORIGIN` and it is correct. What is missing is
`VITE_SITE_ORIGIN`, the build-time variable. The earlier statement was imprecise, not false, and
§32.5 is the precise version.

## 32.8 · OPEN AT THE CLOSE OF REV-20

**Closed by this entry:** F-47, F-52, §30.3.1. **Neutralised, mechanism recorded:** F-55 / F-50.

**Still open:**

* **F-54** — blocked on a Cloudflare API token (owner).
* **`apply-migration.yml`** — blocked on `SUPABASE_DB_URL` (owner).
* **F-56** — accepted standing condition, by ruling D-14 (§31.14).
* `VITE_SITE_ORIGIN` on Cloudflare production — blocked by the dashboard UI (§32.5).
* The story-image failure — undiagnosed; the owner's link expired and no reproduction exists.
* **Owner acceptance test outstanding** — the @mention list on a physical phone, from build #117's
  `app-debug-apk-SIDELOAD-THIS` (§31.9). Still `DEFERRED`, not verified.
* Cosmetic: the `ANDROID_KEY_ALIAS` secret does not name a real alias; the build falls back to
  `upload` and says so.

---

**Prepared by the compiler. REV-20 records; it does not approve, and it closes nothing that the
evidence above does not close.**

---

# 33 · REV-21 — `apply-migration.yml` RAN. FOUR ATTEMPTS, FOUR DIFFERENT FAULTS, AND F-57.

**Opened 2026-09-01. On 2026-08-13 the owner asked the compiler to run a migration and it
could not. Today, run #10, it did — against production, with a file that changes nothing, on a
credential the compiler has never seen. This entry records the chain honestly, including the two
places where the compiler's own instructions were the fault.**

## 33.1 · Class of this entry

Compiler record. No owner approval is implied. Every claim below is `VERIFIED` against a named
GitHub Actions run whose log the owner can open. The two corrections at §33.6 are against the
compiler and are not softened.

## 33.2 · WHAT WAS ACTUALLY WRONG — AND IT WAS NOT "THE SECRET IS MISSING"

REV-20 §32.6 carried `apply-migration.yml` as **BLOCKED — owner action**, on the ground that
`SUPABASE_DB_URL` did not exist. **That was false.** Read from the repository settings page on
2026-09-01:

| Secret | Scope | Last updated before today |
|---|---|---|
| `SUPABASE_DB_URL` | **Environment `production`** | Aug 31, 2026 |
| `SUPABASE_DB_URL` | **Environment `staging`** | Aug 31, 2026 |

Both existed. The job declares `environment: ${{ inputs.target }}`, so it reads the
**environment** secret; a repository-level secret of the same name is shadowed and never read.
The finding should have said *the stored credential does not work*, which is a different problem
with a different owner action. Status: **VERIFIED**, and corrected at §33.6.

## 33.3 · THE FOUR RUNS, EACH A DIFFERENT FAULT, NONE OF THEM REACHING DATA

The workflow checks in this order: branch → credential present → credential's project ref matches
the target → file allowlisted → echo the SQL → install psql → **connect and run**. The password
is only ever exercised at the last step. That ordering is why each failure was further along than
the last, and why none of them touched a row.

| Run | Date | Died at | Verbatim | What it proved |
|---|---|---|---|---|
| **#7** | Aug 31 18:49 | **Run it** | `FATAL: password authentication failed for user "postgres"` | credential existed, shape was right, password wrong |
| **#8** | Sep 1 16:53 | **credential ref gate** | `Error: secret points at 'postgres', target is 'production' — refusing` | a DIRECT connection string had been pasted; the gate refused it before connecting |
| **#9** | Sep 1 ~17:1x | **Run it** | `FATAL: password authentication failed` at `aws-1-ap-northeast-2.pooler.supabase.com:5432` | pooler shape restored; password still wrong |
| **#10** | Sep 1 | **nothing — SUCCESS in 38s** | all 12 steps green, `Run it` 2s, `Confirm` | **the credential authenticates and SQL executed** |

Status: **VERIFIED** — runs `33396358959`, `33502273524`, `33504828791`, `33508525426`.

**The cause of #7 and #9 was the same and is worth naming so nobody loses another day to it:**
Supabase's Connect dialog does not display the database password. It prints the literal
placeholder `[YOUR-PASSWORD]`. A string copied as-is sends those characters as the password. The
real password is shown once, on the screen where it is reset.

## 33.4 · THE PROBE — HOW A CREDENTIAL IS TESTED FROM NOW ON

`supabase/migrations/PROBE_credential_connectivity_readonly.sql`, merged as PR #118 (1 file,
+45 / −0), synced to `staging` under STANDING RULE 20.

It is not a migration. `BEGIN`, four `SELECT`s asking the server its own database, user, version
and clock, `COMMIT`. No DDL, no DML, no grant, no policy. Idempotent by construction; the
database is byte-for-byte unchanged after any number of runs.

**A green run proves exactly three things and no more:** the stored credential authenticates; it
reaches the database the chosen target names; and the connection supports a multi-statement
transaction — which is the entire reason the SESSION pooler (5432) is required and the
TRANSACTION pooler (6543) refused. **It proves nothing about any schema.** Recorded here so no
later reader cites a green probe as evidence about a migration.

## 33.5 · F-57 (NEW, AND CLOSED IN THE SAME BREATH) — THE FILE'S OWN INSTRUCTIONS WERE WRONG

**Finding.** Two paragraphs in `apply-migration.yml`'s header described a system that did not
exist, and both misdirections were acted on.

1. The setup block told the reader to store the **DIRECT** connection string,
   `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres`. The step *"The
   credential must point at the target database"*, 100 lines below in the same file, parses the
   project ref out of the username and **refuses** anything it cannot read a ref from. A direct
   string has a bare `postgres` username. **A credential built by following this file could never
   work.** Run #8 is that sentence executing.
2. The second block said the `environment:` line was commented out and that binding it was
   "RECOMMENDED, NOT REQUIRED". The line is live and has been. That wording is what sent the
   compiler — and through it, the owner — to create a repository-level secret that an
   environment-scoped job shadows and never reads.

**Closed by PR #119, merged to `main`.** **Comments only**, and proved so: with comment lines
stripped, the file is byte-identical to its predecessor; the YAML parses; the job still declares
`environment: ${{ inputs.target }}`; all 9 steps unchanged. The corrected header now states the
session-pooler shape, ties each of its three conditions to the gate that enforces it, names the
`[YOUR-PASSWORD]` placeholder trap, states that the secret is environment-scoped and shadows any
repository one, and points at the probe as the way to test a credential without applying
anything. Synced to `staging`; `compare/main..staging` reads **0 changed files, 0 additions,
0 deletions**. Status: **VERIFIED**.

**STANDING RULE 21.** A comment that instructs is a control. When a comment and the code it
describes disagree, that is a defect of the same class as a broken gate — it is filed as a
finding, fixed in the file, and recorded here. Documentation drift is not cosmetic; it is how an
hour becomes a day.

## 33.6 · CORRECTION REGISTER — C-44 AND C-45

**C-44 — the compiler told the owner `SUPABASE_DB_URL` did not exist and asked him to create it.**
It had existed on both Environments since Aug 31. The claim came from REV-20's own open list,
repeated without opening the settings page. The owner's paste created a third, repository-level
copy that the workflow can never read. Wasted owner action, caused by the compiler restating a
record instead of checking the system.

**C-45 — the compiler told the owner the `environment:` line was commented out.** It is live. The
claim came from the file's own stale header (§33.5) and was not checked against the file's code.

Both are the failure pattern already named at §25.6.1 and repeated at C-38 and C-42: **asserting
from a document instead of from the system.** Three occurrences is not three accidents. The
mitigation adopted, and the reason F-57 was fixed rather than merely noted, is that the misleading
document has been corrected at source so the same assertion cannot be made again.

## 33.7 · OPEN AT THE CLOSE OF REV-21

* **`apply-migration.yml` — no longer blocked. VERIFIED by execution, run #10.**
* **Staging's credential is UNTESTED.** Its environment secret still dates from Aug 31 and may
  carry the same fault. One dispatch settles it: branch `staging`, target `staging`, the probe
  path. **DEFERRED** — the compiler cannot open the Run-workflow panel through its browser
  access; this is a tooling limit, recorded as such and not as a choice.
* **The duplicate repository-level `SUPABASE_DB_URL` should be deleted**, so there is exactly one
  credential per lane and no shadowing to reason about. Owner action.
* **Production Environment has no required reviewer**, and "Allow administrators to bypass
  configured protection rules" is ticked. The workflow's header recommends a reviewer so every
  dispatch waits for a human. Owner decision, recorded not urged.
* **F-54** — blocked on a Cloudflare API token (owner). Unchanged.
* **F-56** — accepted standing condition by ruling D-14. Unchanged.
* `VITE_SITE_ORIGIN` on Cloudflare production — blocked by the dashboard UI (§32.5). Unchanged.
* The story-image failure — undiagnosed, no reproduction. Unchanged.
* **Owner acceptance test outstanding** — the @mention list on a physical phone, build #117's
  debug APK (§31.9). Still `DEFERRED`.

---

**Prepared by the compiler. REV-21 records; it does not approve. What it closes, it closes because
a run log says so.**


---

# 34 · REV-22 — PHASE 0 OPENED. THE FIVE STANDING HOLDS. H-4 TESTED AND FAILING.

**Opened 2026-09-02. This is the first entry written under the Addendum A execution master, by the
role it names the Auditor — the same author the earlier entries call "the compiler". This entry
records what Phase 0 imposed, what it found, and every place the Auditor's own hands were on
something they should not have been.**

## 34.1 · Class of this entry

Auditor record. No owner approval is implied. Every negative statement carries the UTC time it was
observed. Corrections at §34.6 are against the Auditor and are not softened.

## 34.2 · What now exists, and where

| Artefact | Where | Evidence |
|---|---|---|
| Four role skills — `50mm-code-auditor`, `50mm-security-reviewer`, `50mm-developer-1-db-runtime`, `50mm-developer-2-client-delivery` | the Owner's account, all sessions | saved 2026-09-02; account-scoped, not chat-scoped |
| `docs/gates/GATE_REGISTER.md` — 35 rows, gate sentences verbatim | `main` via **PR #124** (06:59:58Z), synced to `staging` | sha256 as committed `bd252eb9…c16d6` |
| `docs/gates/phase-0-kickoff.md` | same PR | `f83d12b0…aafe0` |
| Gate Register **Revision 2** | `main` via **PR #125**, synced to `staging` | `dd60a65a…383fe`, identical on both lanes |
| Phase-wise Development Plan (Owner-supplied) | Project, text rendering | the per-task plan all three sessions read |

`compare/main..staging` read **0 changed files, 0 additions, 0 deletions** after each of the three
syncs. Standing Rule 20 held throughout, with one gap of roughly forty minutes between PR #125
merging and the staging sync, during which it did not, and which is recorded here rather than
smoothed over.

## 34.3 · THE FIVE STANDING HOLDS — IMPOSED, BY WHOM, RELEASED BY WHAT

The register states each hold. This is the file that records when it was imposed and what it costs.
A hold that lives only in the register can be relaxed later with nothing to point at; that is how
C-2 became four numbers.

| # | Hold | Imposed | Effect | Released only by |
|---|---|---|---|---|
| **H-1** | C-2 — unused-index counts unreconciled: 79 / 78 / 298-of-which-125 / 188 | Auditor, 2026-09-02, register rev 1 | **No index is dropped by anyone.** A PR that drops one is closed unreviewed. | The Phase 4 reconciliation unit, naming one method **with its schema scope in the same sentence**, and accounting for the 79. D1's 2026-09-02 candidate (five methods, 188/78/298/125/594) is `EVIDENCE FILED` and does not release it. |
| **H-2** | X1 / X2 — 384 duplicate permissive policies across 82 tables, 29 per-row `auth.uid()` | Auditor, same | **P34 cannot close.** | X1 and X2 landing before Phase 4. D1 reproduced both counts exactly on 2026-09-02. |
| **H-3** | D-002 — `post-images` bucket public, storage SELECT policy carries no privacy condition | carried forward from REV-18 | **`PrivacyGapNotice` stays shipped, its test stays green.** | Authorized delivery live. |
| **H-4** | Staging `SUPABASE_DB_URL` untested since 2026-08-31 | Auditor, same | Phase 1 cannot open. | A green probe run against `staging`. **See §34.4 — it ran, and it is not green.** |
| **H-5** | No required reviewer on the `production` Environment; administrator bypass ticked | Auditor, same | Phase 1 cannot open. | Owner sets the reviewer. Auditor reads the page in a real browser and records VERIFIED. |

## 34.4 · H-4 EXECUTED — TWO RUNS, TWO FINDINGS, ZERO ROWS TOUCHED

The Owner could not dispatch. The Auditor did, with the read-only probe file
`supabase/migrations/PROBE_credential_connectivity_readonly.sql` (merged in PR #118; `BEGIN; SELECT
…; COMMIT;` — it changes nothing).

**Run #11, `33617017865`, branch `main`, target `staging`** — refused in 5 s before any step ran:

> `Branch "main" is not allowed to deploy to staging due to environment protection rules.`

**Finding N-4, new.** The `staging` GitHub Environment carries a deployment-branch rule admitting only
`staging`; `production` admits only `main`. Nobody had written that down. It is a second, independent
enforcement of lane separation, above the workflow's own ref gate. All ten previous runs of this
workflow were from `main` against `production`, which is why it had never surfaced.

**Run #12, `33617572635`, branch `staging`, target `staging`** — every gate passed, then the
database refused:

| Step | Result |
|---|---|
| The branch must match the target | ✓ |
| Refuse to start without the database credential | ✓ — the secret exists |
| The credential must point at the target database | ✓ — **ref `ztzutckwdhetphwghuzj`, correct** |
| Validate the requested file | ✓ |
| Install psql | ✓ |
| Run it | ✗ `psql: error: connection to server at "aws-0-ap-northeast-2.pooler.supabase.com" (15.165.245.138), port 5432 failed: FATAL:  password authentication failed for user "postgres"` |

**Right project, wrong password.** H-4 moves from *untested* to **tested and failing**. Found by a
read-only probe that touched no row, instead of during Phase 1's A-1 apply where it would have cost
a day. **Owner action, and only the Owner's: replace the `staging` environment secret.** The Auditor
never sees or handles a credential.

## 34.5 · PHASE 0 PROGRESS AT THE CLOSE OF THIS ENTRY

| Task | Status | Basis |
|---|---|---|
| 0-AU-01 register + kickoff | **DONE** | PRs #124, #125 |
| 0-AU-02 holds in register and ledger | **DONE** with this entry | §34.3 |
| 0-D1-01/02/03 | **EVIDENCE FILED**, not on origin | Built twice — once in a session with no push authority, once as a rebuild in the Auditor's session (§34.6, D-18). Baseline artefact **exists**: 228 lines, 18 probes, every line stamped, transport named. Seeder guard proven refusing in five hazard cases; seeded run **BLOCKED** on H-4, no row count simulated. |
| 0-D2-01/02 | **IN PROGRESS** | PR #126 against `staging`. Reviewed by a separate D2 session: three defects, each confirmed by the Auditor against the PR bytes — wrong unit numbers baked into emitted records (F-1), a harness that goes green with zero measurements (F-2), provenance lost in any worktree (F-3). **CHANGES REQUIRED.** |
| 0-D2-03 client inventory | **EVIDENCE FILED**, not on origin | 223 raw `<img>` at `ef5d4a37`, against the Addendum's 158. Disagreement recorded, not resolved. See C-49. |
| 0-OW-01 | **DONE, FAILING** | §34.4 |
| 0-OW-02, 0-OW-03 | **OPEN** | Owner |

## 34.6 · DEVIATIONS AND CORRECTIONS — ALL AGAINST THE AUDITOR

**D-18 — D2 executed as a subagent of the Auditor's session, and the Auditor uploaded its bytes.**
The Owner could not open a second session at the time and no push credential existed on the
developer side. The Auditor did not write the code. Independence is nonetheless weaker than ruling
D-15 specifies. Recorded in PR #126's body and here. Partly redeemed the same day: a separate D2
session then reviewed #126 blind and found three defects the subagent's fourteen passing tests did
not — which is exactly what D-15 exists to buy.

**D-19 — PR #126's branch is `altisinfonet-patch-36`, not `d2/P00-…`.** GitHub's upload form ignored
a branch name that was set and read back before submitting. Recorded rather than silently accepted.

**C-46 — the Auditor issued both developer kickoff commands instructing each session to read
`docs/gates/` first, while that directory existed on no ref.** D1's session ran 06:38Z–06:57Z; the
register reached `main` at 06:59:58Z. D1's absence report was correct as measured, scanned every ref
rather than two branches, and is superseded, not withdrawn.

**C-47 — Register Revision 2 misattributes P9's 26.7-second statement.** D1 pinned the fingerprint:
the actual P9 vault statement (`4292500501219224675`) means **3.00 ms** over 432,877 calls. The
26.7 s belongs to a different statement in the same grouping. The finding stands; the attribution
was the Auditor's and was wrong.

**C-48 — Revision 2 recorded 329→332 definer functions and 149→157 triggers as figures that
moved. They did not.** 329 and 149 are `public`-schema counts; 332 and 157 are all-schema. Nothing
changed but the scope. **Third time this shape has produced a phantom** — H-1 is the same failure.
Rule adopted from D1, binding from this entry: *a count of database objects is not a measurement
unless its schema scope is in the same sentence.*

**C-49 — the register's P11 note carries "158 raw `<img>` tags" with no method recorded.** D2
measured **223** at `ef5d4a37` with every one of 65 false matches listed by file, line and reason,
and could not reconstruct 158 by any method. The Auditor transcribed the Addendum's number into a
note without its instrument. Both numbers now stand side by side; neither is "fixed".

**C-50 — PR #126 bundles two deliverables (0.4 and 0.5).** The Auditor sent D1 back for exactly
this an hour earlier, then did it himself as courier. Split required before merge.

## 34.7 · NEW FINDINGS ROUTED, NOT ACTED ON

* **F-58** — `.github/workflows/typecheck.yml` pins `node-version: 20`; `.node-version` reads
  `22.22.2` and `package.json` requires `>=22.12.0`. `security.yml` and `health.yml` also pin 20.
  Found independently by two D2 passes at `ef5d4a37`; verified by the Auditor on `main`. Typechecking
  on a different major than the one that builds the site is F-52's shape again. D2's file, its own PR.
* **F-59** — `enqueue_post_created_job` is unconditional (`pg_proc`, 11:26Z): every post INSERT
  enqueues a job and `process-post-jobs` runs every 5 s. **A one-million-row seed enqueues a million
  jobs.** The seeder refuses without `--ack-queue-load`. **Owner decision before the seed run.**
* **N-5** — staging is `x86_64`, production `aarch64` (`version()`, 11:06–11:07Z). N-1 recorded only
  the patch-level split. Latency proven on staging is proven on a different architecture; relevant to
  P20's budget.
* **`user_roles` has never been autovacuumed** — 29.22 % dead on 109 live rows, 54.86 % of scans
  sequential (11:18:28Z). P34's table.
* **20 of 21 client timers fail P10's gate today.** Only two files register `visibilitychange`, and
  one of them (`AdZone.tsx`) only re-bases a counter; the 200 ms interval keeps firing while hidden.
  The fastest timer in `src/**` is **30 ms** (`Index.tsx:191`), and P10's text does not mention it.
* **Nine `<img>` tags live in HTML strings, not JSX**, seven in product code. P11's lint rule over
  JSX cannot see them. Recorded so P11 does not declare victory over a surface it never covered.
* **P27's thirteen tables overlap P35's no-PK tables and P33's RLS-no-policy list.** The three units
  should be dispositioned together before any SQL.

## 34.8 · OPEN AT THE CLOSE OF REV-22

* **Staging password** — Owner. Nothing in Phase 1 moves until it is replaced.
* **H-5 reviewer** — Owner. The Auditor was blocked by the safety layer from scripting a change to a
  repository security setting and did not go around it.
* **D1's three deliverables** — landing as three separate PRs against `staging`, courier step
  recorded.
* **PR #126** — F-1/F-2/F-3 fixes and the split, from D2.
* **Register Revision 3** — C-47, C-48, C-49, N-4, N-5, F-58, F-59, the #126 review outcome.
* **F-59 acknowledgement** — Owner, before any seed run.
