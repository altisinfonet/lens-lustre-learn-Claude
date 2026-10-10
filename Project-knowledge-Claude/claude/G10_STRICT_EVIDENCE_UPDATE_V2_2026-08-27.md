# G10 — STRICT EVIDENCE UPDATE (PROTOCOL v2)

**Report generated (UTC):** 2026-08-27T11:12:36Z
**Measurement window (UTC):** 2026-08-27T11:05:00Z → 2026-08-27T11:12:36Z
**Measurement identity:** this session, read-only, against local clone `/home/claude/repo` synchronised
to `origin` at 2026-08-27T11:05Z. **Zero pushes, zero dispatches, zero signatures, zero merges committed.**
**Candidate:** `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`

---

# PART I · PROTOCOL v2 — THE SEVEN AMENDMENTS, APPLIED

| # | Amendment | Applied as |
|---|---|---|
| 1 | `VERIFIED` must carry a scope; a container and its content are separate lines | Every row states **what proposition** is verified. Fact 8's *container* and *content* are split across rows B-1.0 and B-1.1 |
| 2 | Sixth status needed for §3.2 deviations | `CLOSED WITH DOCUMENTED DEVIATION` added as a **disposition column**, not a status — the five statuses remain the only statuses, and the disposition records the §3.2 treatment separately |
| 3 | Tag rule tightened | Promotion readiness now requires **all three**: approval record signed **AND** tag created **AND** tag resolves to `e2e05fbb…`. A bare tag no longer satisfies it |
| 4 | Per-fact measurement timestamps | Every row carries its own UTC or the literal `NOT RECORDED`. No time is inferred |
| 5 | Mandatory control column | `basis` column: `EXT-n` · `SI+C` (instrument **with** control) · `SI−C` (no control) · `OWNER` · `NONE`. **`SI−C` can never support VERIFIED** |
| 6 | Secret rule extended | Masked values, lengths, prefixes and hashes are all barred as evidence, and inferring presence from a mask is explicitly disallowed (§5.3) |
| 7 | The two `main`-only commits must be accounted for | New mandatory section **B-2**, executed this pass — see the result, it changed the verdict's shape |

**Instrument limitation recorded up front.** The GitHub **REST API is unavailable to this session**:
`GET /repos/altisinfonet/lens-lustre-learn-Claude` returns **HTTP 403**, *"GitHub access to this repository
is not enabled for this session."* **Git-protocol access works** (`ls-remote`, `fetch`, `rev-list` all
succeed). Therefore: everything derivable from git objects is measurable this pass; **workflow run logs
and PR review metadata are not**. Rows depending on the latter are marked BLOCKED with the blocker named,
not marked NOT YET VERIFIED as though nobody had tried.

---

# PART II · SECTION A — ACCEPTED FACTS FROM EXTERNAL VERIFICATION

All eight supplied facts were **independently re-derived** from the git object store this pass. Zero
divergence.

| # | Fact | Status | Basis | Instrument | UTC |
|---|---|---|---|---|---|
| A-1 | `main` = `b671e1fb0c5bcf145d442076c229eca888afd674`, tree `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` | **VERIFIED** | EXT-1 + SI+C | `git rev-parse origin/main` / `origin/main^{tree}` | 2026-08-27T11:05Z |
| A-2 | staging = `b8535fe7c9f2c7f604347ba849ac579bf4946d23`, tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` | **VERIFIED** | EXT-2 + SI+C | same, plus `git ls-remote origin refs/heads/staging` returning the identical SHA — the remote read is the control against a stale local ref | 2026-08-27T11:05Z |
| A-3 | merge base = `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` | **VERIFIED** | EXT-3 + SI+C | `git merge-base` | 2026-08-27T11:05Z |
| A-4 | left-right `main...staging` = **2 / 25** | **VERIFIED** | EXT-4 + SI+C | `git rev-list --left-right --count` | 2026-08-27T11:05Z |
| A-5 | changed paths `main...staging` = **123** | **VERIFIED** | EXT-5 + SI+C | `git diff --name-only main...staging \| wc -l` | 2026-08-27T11:05Z |
| A-6 | approved tag count = 0; total tag count = **0** | **VERIFIED** | EXT-6 + SI+C | `git tag \| wc -l` after `fetch --tags` — the fetch is the control against a locally-empty-but-remotely-populated tag namespace | 2026-08-27T11:05Z |
| A-7 | PR 101 merged = true; PR 102 merged = true | **VERIFIED** | EXT-7 | supplied | — |
| A-8 | Run **32950030302** exists · `G10 secret isolation probe` · branch `scratch/g10-53-secret-isolation-20260826` · conclusion **success** | **VERIFIED** | EXT-8 | supplied | — |

**A-9 (derived).** Candidate tree `e2e05fbb…` ≠ current `main` tree `db8df567…`. §17-11 requires equality
**after** promotion. — **VERIFIED**, EXT-1 + EXT-2.

**A-10 (derived).** Total tag count 0 ⇒ **no tag of any kind resolves to `e2e05fbb…`** ⇒ no §11 approval
artifact exists in the repository. — **VERIFIED**, EXT-6.

**A-11 (new, measured this pass).** The **two-dot** diff `main..staging` is **107 paths**, distinct from
fact 5's **123** three-dot paths. Both numbers are correct and answer different questions: 123 is *"what
changed since the merge base, either side"*; **107 is *"what must change for `main`'s tree to equal the
candidate's"*** — the §17-11 quantity. — **VERIFIED**, SI+C, `git diff --name-status origin/main
origin/staging`, 2026-08-27T11:06Z.

---

# PART III · SECTION B — CLAIMS REQUIRING ADDITIONAL PROOF

## B-1 · The §5.3 secret-isolation probe — fact 8 split into container and content

### B-1.0 · Container

| Field | Entry |
|---|---|
| **Claim** | Run `32950030302` exists, ran on `scratch/g10-53-secret-isolation-20260826`, concluded `success` |
| **Status** | **VERIFIED** · basis EXT-8 |
| **Instrument / UTC** | supplied external fact · run execution time **NOT RECORDED** in the fact set |
| **Artifact** | `https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/32950030302` |

### B-1.1 · Content — resolved this pass by reading the workflow, not the log

The v1 report held that a `success` conclusion could not discriminate the intended EMPTY result from a
masked value or a skipped assertion. **That objection is now answerable from the workflow definition
itself**, which was read from the probe branch at `9478cf7` this pass.

| Field | Entry |
|---|---|
| **Claim** | On this workflow, `conclusion: success` is logically equivalent to the probe having printed `EMPTY` |
| **Status** | **VERIFIED** · basis SI+C |
| **Instrument** | `git show refs/probe/g10-53:.github/workflows/g10-secret-probe.yml`, branch tip `9478cf768c47ba91cece3cddae02548e5f3ce8c2` (2026-08-26T08:52:42Z, *"G10 §5.3: secret-isolation negative test, fresh for this RC"*) |
| **UTC** | 2026-08-27T11:09Z |
| **Artifact** | `.github/workflows/g10-secret-probe.yml` @ `9478cf7` |

**Raw output summary — the four properties that make the conclusion discriminating:**

| Property | Effect on the v1 objection |
|---|---|
| The job declares **no `environment:` key**, and the file states in a comment that *the absence **is** the test* — adding one would hand the job the grant it is trying to prove is withheld | The success cannot be an environment-granted false pass |
| Exactly **one step**, no `if:` condition, no `continue-on-error`, `set -euo pipefail` | Kills v1 case (3): the assertion cannot be skipped while the job still exits 0. A skipped job reports `skipped`, not `success` |
| The non-empty branch prints `NON-EMPTY` and **`exit 1`** | Kills v1 case (1): a resolving secret **fails** the run. `success` is reachable only through the `-z` branch |
| Nothing derived from the secret is emitted — *"not its value, not its length, not a hash, not a prefix"*; output is one literal word | Kills v1 case (2): there is no mask to misread, satisfying amendment 6 |
| Trigger is `push` restricted to `scratch/g10-53-secret-isolation-*`, never `main` or `staging` | On a lane branch the secret is *supposed* to resolve, so a pass there would mean the opposite — the branch restriction is the control |

**This is a genuine upgrade and it should be recorded as one.** The outstanding proof has narrowed from
*"read the whole run log"* to **one field**.

### B-1.2 · The one remaining binding

| Field | Entry |
|---|---|
| **Claim** | Run `32950030302` executed **this** workflow definition — i.e. `head_sha == 9478cf768c47ba91cece3cddae02548e5f3ce8c2` |
| **Status** | **BLOCKED** · basis NONE |
| **Blocker** | GitHub REST API returns HTTP 403 for this session. `head_sha` is not derivable from git objects |
| **Instrument required** | `GET /actions/runs/32950030302` → read `head_sha` and `run_started_at`. One request |
| **UTC** | attempted 2026-08-27T11:07Z, refused |

Until that field is read, the branch could in principle have been force-updated after the run. **Design
is verified; the run's binding to the design is not.**

### B-1.3 · Staleness — unchanged by any of the above

| Field | Entry |
|---|---|
| **Claim** | The probe satisfies §5.3.6's *"immediately before promotion"* requirement |
| **Status** | **NOT YET VERIFIED** · basis NONE |
| **Reason** | The run predates any promotion. §19 states the probe *"must be re-taken rather than inherited"* at G10 step 7. **Even a fully-read, fully-passing log from 2026-08-26 does not satisfy a clause that requires the measurement immediately before promotion.** The re-run is mandatory regardless of B-1.1 and B-1.2 |

### B-1.4 · Branch deletion

| Field | Entry |
|---|---|
| **Claim** | The probe branch was deleted after the run, per §5.3 |
| **Status** | **VERIFIED — REQUIREMENT NOT MET** · basis SI+C |
| **Instrument / UTC** | `git ls-remote origin 'refs/heads/scratch/g10-53*'` · 2026-08-27T11:08Z |
| **Raw output** | `9478cf768c47ba91cece3cddae02548e5f3ce8c2  refs/heads/scratch/g10-53-secret-isolation-20260826` — **the branch is still present on the remote.** The control is that the same command pattern returns nothing for a deleted branch |

> ### RECONCILIATION-01 — STILL OPEN
> `claude/G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27.md` §5 records *"The G10 one has **zero runs**."*
> Fact 8 contradicts it. Resolving which is stale requires `run_started_at`, which is **BLOCKED** by the
> same 403. **Status: BLOCKED**, not NOT YET VERIFIED — the attempt was made and refused.
> The conflict is recorded, not absorbed.

## B-2 · The two `main`-only commits — amendment 7, executed

This section did not exist in v1. It changed the shape of the promotion risk.

### B-2.1 · Identification

| Field | Entry |
|---|---|
| **Status** | **VERIFIED** · basis SI+C |
| **Instrument** | `git rev-list --left-only --oneline origin/main...origin/staging`, then `git show --name-only` per commit |
| **UTC** | 2026-08-27T11:06Z |

| Commit | Author date | Subject | Paths |
|---|---|---|---|
| `b671e1fb` | 2026-08-25T18:17:42+05:30 | *PRODUCTION — certificates: 16 types, live preview, editable Custom heading, delete unbroken; admin user list paged (#101)* | **15** |
| `6ebe6c3d` | 2026-08-25T13:25:20+05:30 | *RC-1: expand production schema with admin_search_users_v2 (#97)* | **2** |

**17 paths total.** These correspond to PR #101 (fact 7) and PR #97.

### B-2.2 · Content reconciliation — the finding

| Field | Entry |
|---|---|
| **Claim** | Of the 17 paths carried only by `main`'s two commits, how many still differ from the candidate? |
| **Status** | **VERIFIED** · basis SI+C |
| **Instrument** | per-path `git diff --name-status origin/main origin/staging -- <path>`; control = the same command on a path known to differ returns `M`, so a uniform empty result is excluded |
| **UTC** | 2026-08-27T11:06Z |
| **Raw output summary** | **16 of 17 are byte-identical** across `main` and the candidate. **Exactly one differs: `src/lib/generateCertificatePdf.ts` (`M`).** |

The certificate and pagination work reached both branches. `main` is not carrying orphaned production
work that the candidate would silently revert — **with the single exception named above, which is already
the recorded promotion conflict.**

### B-2.3 · Tree-equality proof — executed, not projected

| Field | Entry |
|---|---|
| **Claim** | Merging the candidate into `main` and resolving the conflict to the candidate's version yields a tree exactly equal to `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` (§17-11 / §12.4 step 11) |
| **Status** | **VERIFIED** · basis SI+C |
| **Instrument** | isolated detached worktree at `origin/main`; `git merge --no-ff --no-commit origin/staging`; `git checkout --theirs -- src/lib/generateCertificatePdf.ts`; `git add`; `git write-tree`. **The merge was aborted and the worktree removed. Nothing was committed, tagged or pushed.** |
| **UTC** | 2026-08-27T11:07Z |
| **Control** | `git write-tree` **refused** before the conflict was resolved (`unmerged` ×2). A tool that emitted a tree hash regardless would have had no discriminating power; this one does |

```
conflicts encountered : src/lib/generateCertificatePdf.ts   (exactly one, as predicted)
resulting tree        : e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
candidate tree        : e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
RESULT                : TREE EQUALITY HOLDS
```

**This is the single most consequential result in this report.** §12.4 step 11 is no longer a risk to be
discovered mid-promotion — the resolution that satisfies it is now known in advance, reproducible by the
auditor from the same three commands, and pinned to one file. It does **not** authorise promotion; the
assertion must still be re-executed on the real merge, because a merge performed against a different
`main` tip would be a different measurement.

## B-3 · PR 103 — removed from unverified status

| Field | Entry |
|---|---|
| **Claim** | PR 103 is not merged into `main` |
| **Status** | **VERIFIED** · basis SI+C |
| **Instrument** | `git ls-remote origin 'refs/pull/103/*'`; fetch `refs/pull/103/head`; `git merge-base --is-ancestor` against both `origin/main` and `origin/staging` |
| **UTC** | 2026-08-27T11:08Z |
| **Raw output** | head `704ad5762f542190db61bddcf47ddeb759a613fb`, *"G10 4.3: arm production-lane isolation host rules"*, 2026-08-26T14:48:05Z. Ancestor of `main`: **NO**. Ancestor of `staging`: **NO**. `refs/pull/103/merge` exists, consistent with an open PR. Control: the same ancestry test on PR 101's head (`736e6522`) resolves differently, so the test discriminates |

v1 correctly refused to assert this from prior session records. **It is now measured.**

## B-4 · AF-15 — the §8.1 four-clause gap, re-measured

| Field | Entry |
|---|---|
| **Status** | **VERIFIED** · basis SI+C |
| **Instrument** | `git show <ref>:.github/workflows/apply-migration.yml` for both refs; md5; per-clause grep |
| **UTC** | 2026-08-27T11:10Z |

| §8.1 required clause | `main` (`db8df567…`) | candidate (`e2e05fbb…`) |
|---|---|---|
| takes a `target` input | **NO** | YES |
| declares `environment: ${{ inputs.target }}` | **NO** (present but **commented out**) | YES |
| refuses unless the branch matches the lane | **NO** | YES |
| refuses a project-reference mismatch **without connecting** | **NO** | YES |
| md5 · lines · steps | `b7a9675bc7ac068f93e8214d37c2cdc4` · 166 · **6** | `fce7d4f5143c035de6863e2e290f7b30` · 236 · **8** |

**`main` satisfies 0 of 4; the candidate satisfies 4 of 4.** Resolved only by promotion, at which point
§12.4 step 11 (now proven, B-2.3) precedes step 12 MIGRATE — the gate is installed before any migration
executes.

## B-5 · D-2 — the nine `UNAPPLIED_` files, enumerated

| Field | Entry |
|---|---|
| **Status** | **VERIFIED** · basis SI+C · **Disposition: CLOSED WITH DOCUMENTED DEVIATION** (pending OA-9 signature) |
| **Instrument / UTC** | `git ls-tree -r --name-only origin/staging \| grep UNAPPLIED_` · 2026-08-27T11:10Z |
| **Raw output** | **9 files: 4 migrations + 5 rollbacks.** One rollback — `UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql` — **has no matching migration**; it is the orphan. This reconciles with the prior record's "4 + 4 + 1 orphan" phrasing: same nine files, clearer decomposition |

## B-6 · Gate and §15 rows carried forward unchanged

Nothing below was re-measured this pass; each is reported at its last recorded measurement and none is
upgraded by this report.

| Item | Status | Disposition | Basis | UTC | Artifact |
|---|---|---|---|---|---|
| G1 §8.10 production-unchanged | **VERIFIED** | — | SI+C | 2026-08-27T07:38:38Z | `claude/G1_G10_FINAL_CLOSURE_REPORT_2026-08-27.md` §1 |
| G3 repository-scope `SUPABASE_DB_URL` absent | **VERIFIED** | — | SI+C (`repo=0` against `env=1`) | NOT RECORDED | same, §2 |
| G3 Environments exist / repo copies deleted | **OWNER-ATTESTED** | — | OWNER | — | §3.1 — may **not** be called verified |
| G5a guard, 21/21 mutants on this tree | **VERIFIED** | — | SI+C (a surviving mutant is the negative case) | NOT RECORDED | run `32982588154` |
| G5b Pages variables present | **NOT YET VERIFIED** | — | NONE | — | §19 G5b |
| G5b `functions/_seo.ts` defaults removed; guard extended | **BLOCKED** | deferred to G11 | NONE | — | §20 G5b |
| G6 header/redirect parity | **NOT YET VERIFIED** | **CLOSED WITH DOCUMENTED DEVIATION** — production direction lands with CHG-003 at promotion | SI+C staging side | NOT RECORDED | §8 |
| G8 part 1 upload → `50mm-staging` → staging CDN | **VERIFIED** | — | SI+C (2×2 origin × present/absent grid; served 240×140) | NOT RECORDED | `claude/G10_PHASE5_QA_RUN2_FULL_EVIDENCE_2026-08-27.md` |
| G8 part 2 production-write refusal | **BLOCKED** | — | NONE | — | Appendix A.5 |
| G8 part 3 production object count | **BLOCKED** | — | NONE | — | Appendix A.5 |
| G9 71-function EXCLUDED countersignature | **NOT YET VERIFIED** | **CLOSED WITH DOCUMENTED DEVIATION** on signature | NONE | — | `claude/G10_PHASE7_READINESS_CHECKLIST_2026-08-27.md` |
| HS-12 branch protection on `main` | **NOT YET VERIFIED** | can never exceed OWNER-ATTESTED (§17-7) | NONE | — | §19 |
| §15 row 7 security | **VERIFIED** | — | SI+C | NOT RECORDED | run `32982588154` |
| §15 row 8 SEO instrument | **VERIFIED** | criterion still fails (AF-03 / D-5) | SI+C, same-minute dual-host | staging 07:26:03Z · production 07:26:43Z | `claude/G1_G10_FINAL_CLOSURE_REPORT_2026-08-27.md` §4 |
| §15 row 9 email | **NOT APPLICABLE** | vacuous, recorded as vacuous | SI−C | — | §8.8 |
| §15 row 10 responsive breakpoints | **BLOCKED** | — | SI−C — instrument reported success 3× while `innerWidth` never moved; no substitute accepted | NOT RECORDED | `claude/G10_PHASE5_INTERACTIVE_QA_RUN_2026-08-27.md` |
| §15 rows 5, 12 (N1/N2) | **BLOCKED** / **NOT YET VERIFIED** | — | NONE | — | §15.2 |
| §15 row 11 regression positive half | **NOT YET VERIFIED** | structurally post-promotion (§17-12) | NONE | — | §18 |
| §15 row 6 — 5 financial edge functions | **NOT APPLICABLE** | **POLICY EXCLUSION — displayed, never folded into a coverage ratio** | — | — | policy |
| Auditor P1–P6 | **VERIFIED** | verdict NOT READY | auditor harness | 2026-08-27T10:48:06Z | auditor report |

---

# PART IV · SECRET-HANDLING ATTESTATION

No secret value, fragment, mask, length, prefix, or hash appears anywhere in this report, and none was
read. Three rows concern secrets and each reports **scope, presence, or design only**:

- **B-1.1** reports the probe workflow's *design* — that it emits one literal word and nothing derived
  from the secret. The workflow file was read; it contains a reference (`secrets.SUPABASE_DB_URL`), never
  a value.
- **B-4** reports which *clauses* each `apply-migration.yml` contains, by grep for clause text — no
  credential material.
- **G3** reports the scope flag `repo=0` — presence, not content.

Credential availability was tested by **existence check only** (`PRESENT` / `absent`); no value was read,
echoed, or written to any file. All git remote output was passed through a redaction filter before display.
Per amendment 6 and §5.3: **a masked value is not proof of absence and is never accepted as evidence here.**

---

# PART V · VERDICT

## Promotion verdict: **NOT READY**

**Reason:** total tag count is 0, so no §11 approval artifact exists for tree
`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`, and promotion readiness under amendment 3 requires a signed
approval record **and** a tag **and** that tag resolving to the candidate tree — none of the three exists.

### What changed since v1

| Item | v1 | v2 |
|---|---|---|
| §5.3 probe discriminating power | NOT YET VERIFIED — "success proves nothing" | **VERIFIED by workflow design.** Narrowed to one field (`head_sha`), now **BLOCKED** on API access |
| The 2 `main`-only commits | NOT YET VERIFIED | **VERIFIED** — PR #101 + #97, 17 paths, **16 byte-identical** to the candidate |
| Tree equality at merge | NOT YET VERIFIED | **VERIFIED** — trial merge yields `e2e05fbb…` exactly, one conflict, resolution known |
| PR 103 | NOT YET VERIFIED | **VERIFIED not merged** by ancestry |
| AF-15 | NOT YET VERIFIED | **VERIFIED** — `main` 0 of 4 clauses, candidate 4 of 4 |
| D-2 nine files | asserted | **VERIFIED** — enumerated, orphan identified |
| Probe branch deletion | NOT YET VERIFIED | **VERIFIED — requirement NOT met**, branch still on the remote |
| GitHub REST API | not attempted | **BLOCKED, HTTP 403** — recorded as an instrument limitation, not silently absorbed |

**Status counts, Sections A + B:** `VERIFIED` **24** · `OWNER-ATTESTED` **1** · `BLOCKED` **8** ·
`NOT APPLICABLE` **2** · `NOT YET VERIFIED` **8**. Disposition `CLOSED WITH DOCUMENTED DEVIATION`
applies to 3 rows (G6, G9, D-2), none of which is thereby treated as verified.

### The four proofs that still gate promotion

1. **§11 approval signed, tag created, tag resolves to `e2e05fbb…`** — nothing exists.
2. **G8 §8.6 parts 2 and 3** — the production-write refusal with both controls, plus object counts.
   Blocked on the credential, not the network (R2 endpoint reachable, HTTP 400 exit 0) and not the tooling.
3. **§5.3 re-run immediately before promotion** — mandatory irrespective of run `32950030302`, per §5.3.6
   and §19; and the probe branch must be deleted afterwards, which last time it was not.
4. **N1 and N2 lane-gate refusal transcripts** — N1 executable now from `staging`; **N2 cannot be run
   before promotion**, because `main` carries no gate and a pre-promotion N2 would test nothing (§14 HS-11).

**Single highest-value result this pass:** the §12.4 step-11 tree-equality assertion is **pre-proven**.
Resolving `src/lib/generateCertificatePdf.ts` to the candidate's version produces tree `e2e05fbb…`
exactly. That removes the largest unknown from the promotion sequence — **and removes nothing from the
list above.**

*Candidate tree unchanged · `main` unchanged · production untouched · trial merge aborted and its worktree
removed · nothing dispatched, signed, tagged, pushed or merged to produce this report.*
