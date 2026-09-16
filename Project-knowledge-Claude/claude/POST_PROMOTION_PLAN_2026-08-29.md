# AFTER THIS RELEASE — post-promotion plan

**The plan for what happens once PR #104 is signed, tagged and merged.**

| Field | Value |
|---|---|
| Prepared | 2026-08-29 |
| Owner | Neil Basu |
| Repository | `altisinfonet/lens-lustre-learn-Claude` |
| Application / code RC | `a42b209e4f70a6efed4f3dcdb654e0f994416594` |
| `main` at time of writing | `b671e1fb0c5bcf145d442076c229eca888afd674` — unchanged |
| Source of record | `docs/PROMOTION_LEDGER.md`, REV-16 (frozen under §28) |
| Status of this document | **PLAN.** It closes no ledger row and grants no approval. |

> **Read this first.** Nothing here is a prerequisite for the current release, and nothing here
> may be used to claim a §25 row is closed. Everything happens **after** the §11 signature, the
> tag and the merge. Items in Part A are already **ruled** by the owner — they are pending
> action, not open questions. **Part G lists what this plan does NOT solve — read it before
> treating the rest as complete.**

A Word version of this document was delivered to the owner on 2026-08-29
(`After_This_Release_Post_Promotion_Plan.docx`, 8 pages). This markdown copy is the durable one.

---

## 1 · Why this release cost what it did

Ten hours went into this promotion. That total is not one thing, and the three parts have
different futures. Separating them is what makes the rest of this plan worth doing.

| Cost driver | What it was | Future |
|---|---|---|
| **One-time setup debt** | First reconciliation of ledger, branch history, evidence rules and infrastructure state at once. Two tools built from scratch mid-release: ledger-guard (v1→v3) and the WS4 harness (rev 1→7). | Disappears once the tools exist and are installed. |
| **Structural defects** | Figures stated against a moving endpoint; the ledger auditing itself; provider access granted per release; one monolithic document. | **Recurs at every promotion unless fixed.** Part C. |
| **Real verification** | The §5.3 probe, the deployed-function comparison, the independent review, the owner signature. | Never goes away, and should not. |

**The measurement behind that middle row**

- Six of ledger-guard's eight findings against REV-16 are **one** defect: figures labelled
  `main…staging`. `staging` moves every time the ledger is saved, so a count is right when
  written and stale one commit later. Three different line totals and four different commit
  counts, all honest snapshots of a moving target.
- **Five ledger revisions were committed on 2026-08-29 and none to either blocker.** Each
  revision moved the head, re-fired 17 CI checks, and invalidated the head every prior audit
  round had measured against.
- Four audit rounds returned repository-only findings because the auditor held repository-only
  access until ruling **D-13 at 11:56Z — on release day**.

---

## PART A · Immediate post-merge actions

*Already ruled. Pending execution, not decisions. Source: ledger §24.3 and §23.5.*

### A1 · Apply migration M2 to production — owner only

File `20260828082136_ad_comment_ban_and_visibility_policies.sql`, via `apply-migration.yml`,
`target=production`, from `main`. Ruling **D-10** (AF-17).

- Until this runs, **both production RLS gaps stay open** even though the file is on `main`.
  Merging does not apply it.
- Verification: `pg_policies` on `ad_creative_comments` must return **9 rows**.
- This is a production database write. **Owner-only.** Not delegated to the compiler.

### A2 · N2 cross-lane test — and the N1 trap

- Meaningful only **after** the merge installs the gate on `main` (§12 row 12).
- Execute **N2 only**: staging URL against a production target.
- **DO NOT execute N1 as written.** It places a production credential in a staging Environment,
  and a gate failure would reach production live member data.
- Safe N1 substitute: dispatch `target=staging` from `main`, which trips gate 1 before any
  credential is read.

### A3 · G9 edge-function deployment — four binding preconditions

Merging deploys nothing. `submit-judge-decision` keeps answering
`Access-Control-Allow-Origin: *` until this step runs. B13 attaches four conditions, and they
are binding:

| # | Condition |
|---|---|
| 15a | Capture **and hash** all 71 production function bundles first. A snapshot without hashes does not satisfy B13 condition 4. |
| 15b | **Re-measure the drift.** The `21/21/29/0` split is as of 2026-08-26 @ `702e5ce` and is stale. The review may not be done against the old numbers. *(This is what the WS4 harness is for.)* |
| 15c | Complete and record a **per-function review of the 29 drifted functions**. **Three must be resolved in the OPPOSITE direction** — production holds the newer version and must not be overwritten by staging. |
| 15d | **A blanket staging→production deploy is expressly prohibited.** `submit-judge-decision` is the highest-priority single item. |

### A4 · Remaining §24.3 items

- §18 regression suite — post-promotion by construction.
- Android build from `main` — separate release, its own versionCode; AF-13 unresolved.

---

## PART B · Install the tooling — separate PRs, after the tag

**Why it could not be installed before promotion.** The frozen application/code RC is
`a42b209e4f70a6efed4f3dcdb654e0f994416594`. Every commit on `staging` after it touches
`docs/PROMOTION_LEDGER.md` **only** — that is what makes the code RC frozen (§3.5 clause 2).
Committing `tools/` or `.github/workflows/` before promotion would place non-`docs/` paths after
`a42b209e`: a new code RC, invalidating §3 identity, §3.2 and §5.0 counts, the §25 evidence
rows, the PR #104 description and the §11 signature. So each install is its own PR, opened
after the tag exists.

| PR | Contents | Acceptance |
|---|---|---|
| **B1 — ledger-guard** | `tools/ledger_guard.py`, `tools/test_ledger_guard.sh`, `tools/test_ci_propagation.sh`, `.github/workflows/ledger-guard.yml` | **LG-05-DEF-1 must be FIXED FIRST — see below.** Then: 66/66 self-test, 14/14 CI-propagation, the new endpoint-attribution fixtures green, and a `--repo` run against REV-16 yielding **FAIL=5**, not 8 |
| **B2 — WS4 harness** | The revision-7 external pack: reference implementation, 51-assertion self-test, mutation control, rc-root mode test, exact-fixture generator, manifest | Pack verifier 28/28; mutation control 12 detected / 0 undetected / 0 false equivalence claims |
| **B3 — scheduled runs** | Guard against `staging` on a schedule, plus the repository test suite and read-only infrastructure checks | A stale figure fails loudly on the day it goes stale, not on release morning |

### B1 blocker · LG-05-DEF-1 — the guard must not be installed until this is fixed

Found 2026-08-30. LG-05 resolves a row's scope endpoint by scanning **every cell in the row,
including the instrument citation**. The ledger's §3.2(b) row is headed `main…fe63e944` but cites
`compare/main...staging.patch` as its instrument; the guard matched that citation and judged a
correctly-labelled row against an endpoint it never claimed. Section headings — where §3.2 declares
its endpoints — are never consulted, and an endpoint absent from the fact source cannot win.

**Consequence: 3 of the guard's 8 FAIL findings against REV-16 were FALSE POSITIVES.** The claim
"zero false positives" is withdrawn. Corrected: **5 REAL, 3 FALSE POSITIVE.**

**Required fix, before install.** Endpoint precedence, never guessed: (1) the row's **label cell**;
(2) the nearest enclosing **section heading**; (3) an endpoint declared **earlier in the same
table**; (4) otherwise **WARN — endpoint undeclared, not checked**. The **instrument cell is
excluded from endpoint matching entirely.** An endpoint named in a row but absent from the fact
source must WARN, never fall through to a different endpoint. A mandatory fixture must reproduce
the §3.2(b) shape — a row whose instrument cites one endpoint while its heading declares another —
silent under the fixed rule, FAIL under today's code; plus fixtures proving findings 4–8 stay live.

**Why the 66-assertion suite did not catch it: no fixture covered endpoint attribution at all.**
Both suites pass with the defect present. That is this plan's own D+ rule — a suite not shown to
detect a planted defect is not evidence — failing on the instrument written to enforce it.

**Exit code 3 means BLOCKED, not failed.** The guard returns `0` clean, `1` for findings, `2`
for a usage or environment error, and **`3` when a check could not be performed at all** — an
unreachable remote, an ambiguous SHA. Treat `3` as "restore the missing input and re-run",
never as a pass and never as an ordinary failure.

---

## PART C · Fix the four defects that will otherwise recur

*Not on the auditor's institutionalisation list, and none fixed by automation alone. Each cost
hours this release and will cost them again.*

### C1 · State every figure against a frozen endpoint

Never label a count `main…staging` in a document that lives on `staging`. Use the frozen code RC
(`main…a42b209e`), or carry the head SHA the figure was measured at. Amend §3.5 rule 5 to say so
explicitly.

Without this, ledger-guard is red at the next promotion for reasons that are **not defects** —
and it will be ignored, which is worse than not having it.

### C2 · Keep the freeze standing

§28's documentation freeze was invented mid-release to stop the ledger generating its own next
audit round. Make it permanent policy: after the freeze point, prose and cosmetic findings go to
the tidy list. They are recorded and visible; they never reopen a release.

### C3 · Standing auditor access, not per-release grants

D-13 granted the independent auditor read-only access to both Supabase projects, edge functions,
Cloudflare R2 / API tokens / Zero Trust and GitHub repository settings — in each provider's
console, to the auditor's own account. **Keep it standing between releases.**

- No credential in any chat, ledger or file. The compiler never handles any of it (§14 HS-10).
- If access restarts each release, every release restarts at PARTIAL, and four rounds of
  repository-only findings happen again.

### C4 · Split the ledger

The document is roughly 180 KB and each revision entry has grown into a paragraph. Keep one live
promotion ledger, current-state only, and move history into a dated appendix that is never
edited. §28.3 items 4 and 6 already name this.

### C5 · A rule for whoever compiles the ledger — including me

Four of this release's corrections were the same act: **asserting from memory instead of opening
the document.** C-8 named a docs-only commit as the release candidate. C-10 stated a search
result the instrument could not support. On 2026-08-29 I said two workstreams remained when
§25.7.2 lists four.

No automation fixes this. §3.5 rule 5 does — *every figure carries its basis*. Rule 6 does —
*every search declares its scope*. LG-07 enforces rule 5 mechanically: a canonical figure row
with no basis fails.

---

## PART D · Institutionalise the process

*Adopted from the independent auditor's recommendation, with an owner and a cadence added to
each item so none of it stays aspirational.*

| Practice | Owner | Cadence / definition of done |
|---|---|---|
| Install ledger-guard after promotion, in its own PR | Owner + compiler | Once, immediately after the tag (Part B1) |
| Keep `staging` continuously promotable rather than auditing at the end | Owner | Standing policy |
| Record RC SHA, diff counts, test results and tags automatically in CI | CI | Every push to `staging` |
| Require every staging PR to update its evidence while the work is fresh | PR author | PR template checklist; enforced at review |
| Run the full test suite and read-only infrastructure checks on a schedule | CI | Nightly or weekly, failing loudly |
| Compare deployed edge functions continuously, not only before promotion | CI + auditor | Weekly, using the WS4 harness |
| Use a short fixed promotion checklist with named owners | Owner | One page, not a narrative |
| Reserve §5.3 as the only last-minute manual probe | Owner | Immediately before promotion, every time |
| Do not let corrections and history accumulate in one document | Compiler | Enforced by C4 |

### D+ · The addition that is not on that list: prove your gates discriminate

Both tools built this release **passed their own test suites and were still broken.** Guard v2
produced four false positives against the real ledger. The WS4 suite went green against an
implementation that had swapped SHA-256 for MD5, disabled the containment check, ignored exact
import-map keys and stopped sorting the manifest — **six of eleven planted defects undetected**.

**A suite that has not been shown to detect a planted defect is not evidence.** Before any future
gate is trusted: plant defects, require red, and record which mutations were detected. Equivalent
mutants must be declared and their equivalence tested in both directions.

---

## PART E · The tidy list

*Recorded debt. None urgent; none may generate a pre-promotion commit. Add to this list rather
than to the document.*

### E1 · From §28.3 of the ledger

| # | Item |
|---|---|
| 1 | §25 subsections run 25.1 → 25.5 → 25.2 → 25.3 → 25.4 → 25.6; rounds were appended as they arrived and the numbering no longer reads in order |
| 2 | §5.1 / §5.3 / §5.4 headings carry dual counts — correct but wordy. One current table with a historical appendix would read better |
| 3 | §3.3's historical CI table repeats `25c0456` on eight rows; one column header would do |
| 4 | Revision-table entries have grown into paragraphs; REV-8 onward are far longer than REV-1…REV-7 |
| 5 | §17.1's correction note and §23.1.0's re-signature state overlapping facts; one could reference the other |
| 6 | The ledger is roughly 180 KB. §5's historical enumerations and §3.3's historical table are the obvious candidates for an appendix split |

### E2 · From ledger-guard's run against REV-16

`FATAL=0 FAIL=8 WARN=3 INFO=4`. **Zero false positives.** All eight are in ledger prose and
figures; none is in code.

| Finding | Disposition |
|---|---|
| Six figures labelled `main…staging` that no longer match that endpoint (lines 120, 122, 426, 428) | One structural defect, not six typos. Fixed by **C1** — restate against `main…a42b209e`. Do not re-measure against the moving endpoint again |
| `§16.4` cited at line 46 — no such subsection | Ordinary cross-reference rot. One-line edit, post-promotion |
| `§8.6` cited at line 790 — no such subsection | Same |

---

## PART F · What a healthy promotion looks like next time

1. CI validates the candidate and runs ledger-guard automatically.
2. The auditor reviews only the changes since the previous tag.
3. Provider evidence is refreshed with the established read-only scripts.
4. The owner runs the §5.3 secret-isolation probe, **last**.
5. Sign §11, create the tag against `git rev-parse staging`, merge.

### Realistic time

| Release shape | Expected |
|---|---|
| Normal release (tens of files) | **One to three hours**, dominated by the auditor's diff review |
| Large or high-risk release | Longer — but the work should be verification, not reconstructing history |
| This release (138 files, +9,060 lines) | Not a normal release. Roughly a quarter of work promoted at once |

### The one thing that decides whether this was the last painful promotion

The failure mode is not laziness about the automation. It is that **evidence staleness is
invisible until release day** — nobody sees a count rot.

So make it loud. Once the guard is installed, run it against `staging` on a schedule and let it
fail on the day a figure goes stale, not on the morning you want to ship. If the guard stays
external, evidence is allowed to age, and auditing starts only at release time, the same ten
hours come back in full.

---

## PART G · What this plan does NOT solve

*Added because the earlier draft read as though completing Parts A to F ends the problem. It does
not. Parts A, B and E are finite actions; C1 to C4 close the four defects that made this promotion
expensive. The five items below survive all of that.*

### G1 · Production edge functions are not in version control

**This is the largest standing risk in the programme, and the plan only touches it obliquely.**
Measured 2026-08-26, all 71 production functions against the candidate tree:

| Finding | Consequence |
|---|---|
| The repository does not match deployed state for **29 of 71** functions | The repo cannot serve as a restore source |
| In **three** of those, production is **AHEAD** of the repository (`send-gift-credit`, `detect-ai-image`, `analyze-gallery-image`) | A blanket redeploy would reintroduce a known defect into production |
| No prior-version restore is exposed, and no CI workflow deploys functions | There is no deployment pipeline to roll back |
| `_shared/imageDims.ts` is deployed in **three different versions** across three functions, none matching the repo | There is no single deployed source of truth for that shared module |

> **The consequence, as recorded on 2026-08-26.** The currently-deployed source is the **only**
> existing copy of production's actual function state. It exists nowhere in version control. Any
> redeploy is therefore **irreversible in practice** unless that state is captured first.
>
> Part A3 deploys the G9 fixes under B13's four conditions. It does **not** make the repository the
> source of truth for production functions — and until it is, this remains true after the release
> exactly as it was before.

#### G1.1 · The workstream that would close it

1. **Capture and HASH all 71 deployed function bundles, and commit that snapshot.** Until this
   exists, nothing else in this list is safe to attempt.
2. **Re-measure the drift** against the post-promotion `main` — the `21/21/29/0` split is as of
   `702e5ce` and is stale.
3. **Reconcile function by function, in both directions.** For the three where production is ahead,
   the repository is what changes.
4. **Add a deployment workflow**, so deploys are reviewable, repeatable and attributable rather
   than manual and credentialled.
5. **Only then is a function-level rollback meaningful**, because only then does a prior version
   exist somewhere other than production itself.

*This is its own release, not a tidy item. B13 accepted these risks for the duration of the current
release only.*

### G2 · The compiler's error class is only half covered

LG-07 enforces §3.5 rule 5 — *every figure carries its basis* — on **canonical figure rows in the
ledger**. It enforces nothing anywhere else. Of this release's errors of that class, **only some
were in the ledger**: the wrong release candidate and the stale counts were; the false search
claim, "only two workstreams remain" and the Windows expectation `DETECTED=12` were in prose, packs
and chat, where no gate looks.

- The rule covers the document. It does not cover the person writing it.
- **Demonstrated 2026-08-30.** One commit figure — 45/43, correct only for `main…fe63e944` — was
  copied into three places without its endpoint travelling with it: the guard's fact file (C-17),
  LG-05's runtime logic (LG-05-DEF-1), and, worst, the *remedy paragraph* of
  `REV16_FINDING_CLASSIFICATION_V3.md`, which instructed a reader to restate figures against
  `main…a42b209e` as "138 files, +9,060/−1,293, **45 commits (43 excluding merges)**". Anyone
  following that remedy would have written into the ledger the exact defect the guard had falsely
  accused it of. The ledger itself was never wrong.
- Partial mitigation: state a number only with the command that produced it — in evidence packs and
  hand-back notes too, not only in ledger tables.

### G3 · Almost nothing in Part D is enforced

Two items have teeth — the guard running in CI, and the scheduled runs. The rest are practices, and
practices decay quietly.

| Practice | What actually enforces it today |
|---|---|
| Require every staging PR to update its evidence | **Nothing.** A checklist in a PR template is not a gate — a required status check would be |
| Keep `staging` continuously promotable | **Nothing** |
| Short fixed promotion checklist with named owners | **Nothing** |
| Scheduled guard and infrastructure runs | CI — but a scheduled job can be muted, and a red result can be admin-merged past |

**If it matters, make it a required check.** Everything in Part D that stays a habit will be back
to a habit within two releases.

### G4 · Verification cost is irreducible, and scales with batch size

The one-to-three-hour figure in Part F assumes a normal release. It is dominated by the auditor's
diff review, which scales with the diff. Promote another 138 files and +9,060 lines in one go and
you get another long day with every tool installed — because the review is the cost, not the
tooling.

- The lever is **release size**, not automation. Smaller and more frequent is the only thing that
  shrinks this number.

### G5 · A stated limitation of the harness, carried forward

**B4:** symlink resolution is untested on every platform, by construction. `os.path.realpath()` and
`os.path.abspath()` differ only for symlinks and Windows junctions, and a symlink test is
platform-gated — so it cannot serve as proof. The property is recorded as untested rather than
counted as covered.

> **The honest summary.** After this release, promotions get substantially cheaper: the tools
> exist, the figures stop rotting, the auditor keeps access, and the ledger stops auditing itself.
>
> **One large risk does not move at all.** Until the 71 deployed functions are captured, committed
> and reconciled, production's actual state exists in exactly one place — production — and every
> deploy remains irreversible in practice.
>
> That is the next release to plan, and it should be planned before it is needed rather than during
> an incident.


---

*Sources: `docs/PROMOTION_LEDGER.md` REV-16 (§23.5, §24.3, §25.3, §25.4, §25.7.2, §26, §28.3);
ledger-guard v3 pack and its measured REV-16 report; WS4 harness revisions 7 and 8 and their
transcripts; the 2026-08-26 evidence-drift inventory and §14 G9 exclusion ruling (71-function
comparison, function-level rollback finding); the independent auditor's verdicts of 2026-08-29.*

*Prepared read-only. No production write, no secret handled, no merge, no tag, no deployment,
no migration dispatch.*
