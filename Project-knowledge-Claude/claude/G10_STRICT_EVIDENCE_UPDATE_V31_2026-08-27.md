# G10 — STRICT EVIDENCE UPDATE v3.1

**Revision v3.1, 2026-08-27T11:34:00Z — minimal edits to v3, no rewrite.** Three changes only: B-7.11
status corrected to VERIFIED; an owner-side closure addendum for former B-1.2 (and, consequentially,
B-1.5); counts recomputed. Every other row, instrument, timestamp and artifact reference is unchanged
from v3.

**Report generated (UTC):** 2026-08-27T11:19:13Z
**Measurement window (UTC):** 2026-08-27T11:05:00Z → 2026-08-27T11:19:13Z
**Measurement identity:** this session, read-only auditor mode, against local clone `/home/claude/repo`
synchronised to `origin` at 2026-08-27T11:19:12Z.
**Executed:** zero pushes · zero workflow dispatches · zero signatures · zero tags · zero merges committed
· zero production writes · zero secret material read.
**Candidate:** `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`

---

## 0 · VOCABULARY — STATUS AND OUTCOME ARE SEPARATE FIELDS

**Status** answers *"what is the epistemic state of this claim?"* and is one of exactly five values:
`VERIFIED` · `BLOCKED` · `NOT YET VERIFIED` · `OWNER-ATTESTED` · `NOT APPLICABLE`.

**Outcome** answers *"does the requirement hold?"* and is one of exactly four values:

| Outcome | Meaning |
|---|---|
| `SATISFIED` | the requirement holds |
| `REQUIREMENT NOT MET` | the requirement was **measured** and **fails** |
| `NOT ESTABLISHED` | the requirement was not measured; it is neither shown to hold nor shown to fail |
| `NOT APPLICABLE` | the requirement does not apply, with a stated reason |

The two never blend. `Status: VERIFIED · Outcome: REQUIREMENT NOT MET` is a coherent and common pair: it
means *the measurement was sound and it showed a failure*. A status string never contains the words
"not met", and an outcome never contains the word "verified".

**Basis** codes: `EXT-n` (supplied external fact *n*) · `SI+C` (session instrument **with** a control) ·
`SI−C` (instrument **without** a control — **can never support VERIFIED**) · `OWNER` · `NONE`.

**Timestamps.** Every row carries a UTC value or the literal `NOT RECORDED`. **No dash placeholders are
used in any time field, and no time is inferred.**

---

## 1 · INSTRUMENT LIMITATION — SCOPED CORRECTLY

**The GitHub REST API is unavailable to this session.**
`GET /repos/altisinfonet/lens-lustre-learn-Claude` → **HTTP 403**, message: *"GitHub access to this
repository is not enabled for this session."* Measured 2026-08-27T11:07Z.

**This is a session-level instrument limitation. It is not a property of the repository, and it is not
evidence about the repository's state.** Two facts establish the scope precisely:

- Git-protocol access to the same repository **succeeds** from this session: `ls-remote`, `fetch`,
  `rev-list`, `ls-tree` and `show` all returned data this pass.
- `https://api.github.com/` unauthenticated returns **HTTP 200** from this container, so the API host is
  reachable; the 403 is an authorisation scope applied to this session, not a network block.

**Consequence, stated exactly:** everything derivable from git objects is measurable this pass. **Workflow
run metadata and PR review metadata are not.** Rows depending on the latter are `BLOCKED` — the attempt
was made and refused — and are never reported as `NOT YET VERIFIED`, which would misrepresent an
exercised-and-refused instrument as an unexercised one. **An owner or auditor with normal repository
access is not subject to this limitation and can close those rows in one request each.**

---

# PART A · ACCEPTED FACTS FROM EXTERNAL VERIFICATION

All eight supplied facts were independently re-derived from the git object store. **Zero divergence.**

| ID | Claim | Status | Outcome | Basis | Instrument | UTC |
|---|---|---|---|---|---|---|
| A-1 | `main` = `b671e1fb0c5bcf145d442076c229eca888afd674`, tree `db8df5679ab812be4f0ba9a3284df7dc2f02c3e1` | **VERIFIED** | SATISFIED | EXT-1 + SI+C | `git rev-parse origin/main`, `origin/main^{tree}` | 2026-08-27T11:19:12Z |
| A-2 | staging = `b8535fe7c9f2c7f604347ba849ac579bf4946d23`, tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` | **VERIFIED** | SATISFIED | EXT-2 + SI+C | `git rev-parse`; control = `git ls-remote origin refs/heads/staging` returning the identical SHA, excluding a stale local ref | 2026-08-27T11:19:12Z |
| A-3 | merge base = `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` | **VERIFIED** | SATISFIED | EXT-3 + SI+C | `git merge-base origin/main origin/staging` | 2026-08-27T11:19:12Z |
| A-4 | `rev-list --left-right --count main...staging` = **2 / 25** | **VERIFIED** | SATISFIED | EXT-4 + SI+C | `git rev-list --left-right --count` | 2026-08-27T11:19:12Z |
| A-5 | three-dot changed paths = **123** | **VERIFIED** | SATISFIED | EXT-5 + SI+C | `git diff --name-only main...staging \| wc -l` | 2026-08-27T11:19:12Z |
| A-6 | total tag count = **0**; approved tag count = **0** | **VERIFIED** | SATISFIED | EXT-6 + SI+C | `git fetch --tags` then `git tag \| wc -l`; the fetch is the control against a locally-empty, remotely-populated tag namespace | 2026-08-27T11:19:12Z |
| A-7 | PR 101 merged = true; PR 102 merged = true | **VERIFIED** | SATISFIED | EXT-7 | supplied external fact | NOT RECORDED |
| A-8 | Run **32950030302** exists · name `G10 secret isolation probe` · branch `scratch/g10-53-secret-isolation-20260826` · conclusion **success** | **VERIFIED** | SATISFIED | EXT-8 | supplied external fact | NOT RECORDED |
| A-9 | Candidate tree `e2e05fbb…` **≠** current `main` tree `db8df567…`; §17-11 requires equality **after** promotion | **VERIFIED** | SATISFIED | EXT-1 + EXT-2 | derivation from A-1, A-2 | 2026-08-27T11:19:12Z |
| A-10 | **No tag of any kind resolves to `e2e05fbb…`**, therefore no §11 approval artifact exists in the repository | **VERIFIED** | SATISFIED | EXT-6 | derivation from A-6 | 2026-08-27T11:19:12Z |
| A-11 | **Two-dot** diff `main..staging` = **107 paths** — distinct from fact 5's 123 three-dot paths. 123 answers *"what changed since the merge base, either side"*; **107 answers *"what must change for `main`'s tree to equal the candidate's"*** — the §17-11 quantity | **VERIFIED** | SATISFIED | SI+C | `git diff --name-only origin/main origin/staging \| wc -l` | 2026-08-27T11:19:12Z |

---

# PART B · CLAIMS REQUIRING ADDITIONAL PROOF

## B-1 · The §5.3 secret-isolation probe

### B-1.0 · Container

**Status: VERIFIED · Outcome: SATISFIED · Basis: EXT-8**
Run `32950030302` exists, ran on `scratch/g10-53-secret-isolation-20260826`, concluded `success`.
**Instrument:** supplied external fact. **UTC of run execution: NOT RECORDED** (absent from the fact set).
**Artifact:** `https://github.com/altisinfonet/lens-lustre-learn-Claude/actions/runs/32950030302`

### B-1.1 · Workflow design logic — EXACT SCOPE OF THE VERIFICATION

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**

> **Scope statement, stated exactly as required.**
> **What is VERIFIED:** the **design logic of the workflow definition** `.github/workflows/g10-secret-probe.yml`
> as it exists at probe-branch tip `9478cf768c47ba91cece3cddae02548e5f3ce8c2` — specifically, that on
> **this definition** a `success` conclusion is reachable only via the code path that prints the literal
> `EMPTY`.
> **What is NOT verified by this row:** that run `32950030302` executed this definition. That is the
> run-to-workflow binding. **In v3 that was BLOCKED; in v3.1 it is closed as OWNER-ATTESTED — see B-1.2.**
> **This row alone does not close G3.**

**Instrument:** `git show refs/probe/g10-53:.github/workflows/g10-secret-probe.yml`
**UTC:** 2026-08-27T11:09Z
**Artifact:** `.github/workflows/g10-secret-probe.yml` @ `9478cf7` (commit dated 2026-08-26T08:52:42Z,
*"G10 §5.3: secret-isolation negative test, fresh for this RC"*)

| Property read from the definition | Consequence |
|---|---|
| The job declares **no `environment:` key**; the file states in-line that the absence **is** the test, and that adding one would hand the job the grant it exists to prove is withheld | A success cannot be an environment-granted false pass |
| Exactly **one step**; no `if:` condition; no `continue-on-error`; `set -euo pipefail` | The assertion cannot be skipped while the job still exits 0. A skipped job reports `skipped`, not `success` |
| The non-empty branch prints `NON-EMPTY` then **`exit 1`** | A resolving secret **fails** the run. `success` is reachable only through the `-z` branch |
| Nothing derived from the secret is emitted — not value, not length, not hash, not prefix; output is one literal word | There is no mask to misread. Consistent with §5.3: a masked value is not proof of absence |
| Trigger is `push` restricted to `scratch/g10-53-secret-isolation-*`, never `main` or `staging` | On a lane branch the secret is *supposed* to resolve, so a pass there would mean the opposite; the branch restriction is the control |

### B-1.2 · Run-to-workflow binding — CLOSED BY OWNER-SIDE ADDENDUM (v3.1)

**Status: OWNER-ATTESTED · Outcome: SATISFIED · Basis: OWNER + SI+C corroboration**

**v3 recorded this row as BLOCKED** because `head_sha` could not be read from this session. **The owner has
now supplied the Actions-API fields.** They are recorded as owner-side evidence and the class is stated
rather than upgraded: this session did not read the API, so under §3.1 the weakest link governs and the row
is **OWNER-ATTESTED, not VERIFIED**.

| Field | Owner-supplied value |
|---|---|
| `head_sha` | `9478cf768c47ba91cece3cddae02548e5f3ce8c2` |
| `run_started_at` | `2026-08-26T08:52:46Z` |
| branch | `scratch/g10-53-secret-isolation-20260826` |
| conclusion | `success` |

**Resolution:** the supplied `head_sha` is **identical** to the probe-branch tip whose workflow definition
was verified in B-1.1. **Run `32950030302` therefore executed the definition verified in B-1.1**, and
B-1.1's scope transfers to that run. The fail condition named in v3 — *"a `head_sha` other than
`9478cf768c47ba91cece3cddae02548e5f3ce8c2`"* — **did not occur**.

**Consequence, stated exactly:** run `32950030302` printed the literal `EMPTY`, because on this definition
`success` is reachable only through that branch. **This does not close G3.** B-1.3 (§5.3.6 timing) and
B-1.4 (branch deletion) are unchanged and both remain open.

### B-1.6 · Independent corroboration of the owner-supplied metadata (v3.1)

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Claim:** the supplied `run_started_at` is consistent with a push-triggered run on the supplied
`head_sha`, rather than a run on some other commit.
**Instrument:** `git log -1 --format=%cI 9478cf768c47ba91cece3cddae02548e5f3ce8c2` compared to the supplied
`run_started_at`. Control = the workflow's trigger is `push` restricted to
`scratch/g10-53-secret-isolation-*` (read in B-1.1), so a push-triggered start must follow its commit by a
short positive interval; a negative or large interval would fail this check.
**UTC:** 2026-08-27T11:33Z

```
probe branch tip commit : 9478cf768c47ba91cece3cddae02548e5f3ce8c2
commit date (git)       : 2026-08-26T08:52:42Z
run_started_at (owner)  : 2026-08-26T08:52:46Z
interval run - commit   : +4 seconds
consistent with a push-triggered run on this commit: YES
```

**This is corroboration, not substitution.** It raises confidence in the owner-supplied fields; it does not
convert them to INDEPENDENTLY-VERIFIED, because the API field itself was still not read by this session.

### B-1.3 · §5.3.6 timing

**Status: NOT YET VERIFIED · Outcome: NOT ESTABLISHED · Basis: NONE**
**Claim:** the probe satisfies §5.3.6's *"immediately before promotion"* requirement.
**Instrument:** none available pre-promotion. **UTC: NOT RECORDED.**
**Note that survives B-1.1 and B-1.2 entirely:** §19 states the probe *"must be re-taken rather than
inherited"* at G10 step 7. **A fully-read, fully-passing log dated 2026-08-26 does not satisfy a clause
that constrains *when* the measurement is taken. The re-run is mandatory irrespective of every other row
in B-1.**

### B-1.4 · Probe branch deletion

**Status: VERIFIED · Outcome: REQUIREMENT NOT MET · Basis: SI+C**
**Instrument:** `git ls-remote origin 'refs/heads/scratch/g10-53*'`; control = the same pattern returns
zero refs for a deleted branch.
**UTC:** 2026-08-27T11:19:12Z
**Raw output:** `9478cf768c47ba91cece3cddae02548e5f3ce8c2  refs/heads/scratch/g10-53-secret-isolation-20260826`
— **1 ref still present on the remote.** §5.3 requires deletion after the run.

### B-1.5 · RECONCILIATION-01 — CLOSED (v3.1), and the prior record was wrong

**Status: OWNER-ATTESTED · Outcome: SATISFIED · Basis: OWNER + SI+C arithmetic**

v3 recorded this BLOCKED pending `run_started_at`. **That field is now supplied and the conflict resolves
determinately.**

| Quantity | Value |
|---|---|
| `run_started_at` (owner-supplied) | 2026-08-26T08:52:46Z |
| `claude/G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27.md` created | 2026-08-27T07:21:24Z |
| **Run predates the pack by** | **22.48 hours** |

**Finding:** the pack's statement *"The G10 one has **zero runs**"* was **incorrect at the time it was
written** — the run already existed 22 hours earlier. This was **not** a run post-dating a stale
observation. **The error was mine; it is recorded rather than absorbed, and it is why v3.1 continues to
treat no prior session record as evidence.**
**Instrument:** date arithmetic on the two timestamps above. **UTC:** 2026-08-27T11:33Z

## B-2 · The two `main`-only commits

### B-2.1 · Identification

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Instrument:** `git rev-list --left-only --oneline origin/main...origin/staging`, then
`git show --name-only --format=''` per commit. **UTC:** 2026-08-27T11:06Z

| Commit | Author date | Subject | Paths |
|---|---|---|---|
| `b671e1fb` | 2026-08-25T18:17:42+05:30 | *PRODUCTION — certificates: 16 types, live preview, editable Custom heading, delete unbroken; admin user list paged (#101)* | 15 |
| `6ebe6c3d` | 2026-08-25T13:25:20+05:30 | *RC-1: expand production schema with admin_search_users_v2 (#97)* | 2 |

**17 paths total**, corresponding to PR #101 (fact 7) and PR #97.

### B-2.2 · Content reconciliation

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Instrument:** per-path `git diff --name-status origin/main origin/staging -- <path>`; control = the same
command on a path known to differ returns `M`, excluding a uniformly-empty result. **UTC:** 2026-08-27T11:06Z
**Raw output:** **16 of 17 byte-identical.** Exactly one differs: `src/lib/generateCertificatePdf.ts` (`M`).
**`main` is not carrying orphaned production work that the candidate would silently revert**, with that
single exception — which is already the recorded promotion conflict.

### B-2.3 · Tree-equality proof

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Instrument:** isolated detached worktree at `origin/main`; `git merge --no-ff --no-commit origin/staging`;
`git checkout --theirs -- src/lib/generateCertificatePdf.ts`; `git add`; `git write-tree`.
**The merge was aborted and the worktree removed. Nothing was committed, tagged or pushed.**
**Control:** `git write-tree` **refused** before the conflict was resolved (`unmerged` ×2) — a tool that
emitted a tree hash regardless would have had no discriminating power.
**UTC:** 2026-08-27T11:07Z

```
conflicts encountered : src/lib/generateCertificatePdf.ts   (exactly one, as predicted)
resulting tree        : e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
candidate tree        : e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
RESULT                : TREE EQUALITY HOLDS
```

§12.4 step 11 is pre-proven and auditor-reproducible from those commands. **It does not authorise
promotion**, and the assertion must be re-executed on the real merge, because a merge against a different
`main` tip is a different measurement.

## B-3 · PR 103

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Claim:** PR 103 is not merged into `main`.
**Instrument:** `git ls-remote origin 'refs/pull/103/*'`; fetch `refs/pull/103/head`;
`git merge-base --is-ancestor` against `origin/main` and `origin/staging`. Control = the same ancestry
test on PR 101's head (`736e6522`) resolves differently, so the test discriminates.
**UTC:** 2026-08-27T11:19:12Z
**Raw output:** head `704ad5762f542190db61bddcf47ddeb759a613fb`, *"G10 4.3: arm production-lane isolation
host rules"*, 2026-08-26T14:48:05Z. Ancestor of `main`: **NO**. Ancestor of `staging`: **NO**.
`refs/pull/103/merge` exists, consistent with an open PR.

## B-4 · AF-15 — §8.1 four-clause gap

**Status: VERIFIED · Outcome: REQUIREMENT NOT MET (on `main`) · Basis: SI+C**
**Instrument:** `git show <ref>:.github/workflows/apply-migration.yml` for both refs; md5; per-clause grep.
Control = the candidate ref returns YES on all four clauses, so a uniform NO is excluded.
**UTC:** 2026-08-27T11:10Z

| §8.1 required clause | `main` (`db8df567…`) | candidate (`e2e05fbb…`) |
|---|---|---|
| takes a `target` input | **NO** | YES |
| declares `environment: ${{ inputs.target }}` | **NO** — present but commented out | YES |
| refuses unless the branch matches the lane | **NO** | YES |
| refuses a project-reference mismatch **without connecting** | **NO** | YES |
| md5 · lines · steps | `b7a9675bc7ac068f93e8214d37c2cdc4` · 166 · **6** | `fce7d4f5143c035de6863e2e290f7b30` · 236 · **8** |

**`main` satisfies 0 of 4; the candidate satisfies 4 of 4.** Resolved by promotion, at which point §12.4
step 11 (pre-proven, B-2.3) precedes step 12 MIGRATE — the gate is installed before any migration executes.

## B-5 · D-2 — the nine `UNAPPLIED_` files

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Instrument:** `git ls-tree -r --name-only origin/staging | grep UNAPPLIED_`. **UTC:** 2026-08-27T11:10Z
**Raw output:** **9 files — 4 migrations + 5 rollbacks.** One rollback,
`UNAPPLIED_20260820140000_classF_repoint_originals_ROLLBACK.sql`, **has no matching migration**: the orphan.
This reconciles with the prior "4 + 4 + 1 orphan" phrasing — same nine files, clearer decomposition.
**Disposition:** accepted for this RC as a documented deviation under §3.2, pending the OA-9 signature;
rename deferred to G11. The disposition does not alter the status or the outcome above.

## B-6 · G5b — MEASURED THIS PASS, AND THE PRIOR RECORD IS WRONG

> ### RECONCILIATION-02 — a prior record conflicts with the candidate tree
> `claude/G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27.md` §4 and `claude/NEXT_DEVELOPMENT_PLAN_2026-08-27.md`
> Track B both state that the **G5b code half is outstanding and requires a new candidate**. That is
> **incorrect for tree `e2e05fbb…`.** Both halves of the code work are **already present in the candidate**,
> measured below. **The prior documents overstated the remaining work and must be corrected; they are not
> silently amended here.**

### B-6.1 · Production defaults removed from `functions/_seo.ts`

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Instrument:** `git show origin/staging:functions/_seo.ts`, plus a scan of **every** file under
`functions/` for `jtdtehuqtinjxropkkcn` and `50mmretina.com`. Control = the same scan pattern returns hits
elsewhere in the tree, so a zero result is not an artefact of the pattern.
**UTC:** 2026-08-27T11:13Z
**Raw output:** **zero production literals anywhere under `functions/`.** `laneValue()` **throws** on an
absent or empty variable, with the in-file rationale: *there is deliberately no default; an absent variable
is a misconfigured lane, and guessing production is precisely the bug this function exists to prevent.*

### B-6.2 · Guard extended to scan `functions/`

**Status: VERIFIED · Outcome: SATISFIED · Basis: SI+C**
**Instrument:** `git show origin/staging:scripts/verify-bundle-isolation.mjs`. **UTC:** 2026-08-27T11:13Z
**Raw output:** `SOURCE_ROOTS = ["functions", "supabase/functions"]`, scanned **alongside `dist` and ON BY
DEFAULT** when the directory exists. Rule **R11** fails the run if a `functions` directory exists but is
not among the scanned roots. The file's own header records the change: *"FUNCTIONS SCANNING, added
2026-08-23 (G5b)… Until G5b the guard was blind to them, and `functions/_seo.ts` carried three production
literals that would have shipped into any lane."*

### B-6.3 · Production Pages variables — AND A PROMOTION PREREQUISITE THIS REPORT IS RAISING

**Status: NOT YET VERIFIED · Outcome: NOT ESTABLISHED · Basis: NONE**
**Instrument required:** Cloudflare dashboard → Workers & Pages → `lens-lustre-learn` → Settings →
Variables and Secrets → **Production**. Owner-only; not readable by this session.
**UTC: NOT RECORDED.**

> ### ⚠ CONSEQUENCE OF B-6.1 — READ BEFORE SCHEDULING PROMOTION
> Because `laneValue()` **throws** rather than defaulting, deploying this candidate to a Pages project
> whose environment lacks these variables makes **every SSR SEO route throw at request time**.
> **Measured:** the affected routes are `/competitions/[id]`, `/courses/[slug]`,
> `/featured-artist/[slug]`, `/journal/[slug]`, `/page/[slug]` — the five function files importing `_seo`
> (instrument: import scan across `functions/`, UTC 2026-08-27T11:15Z).
> **Therefore OA-6 is not a parallel gate item. It is a blocking prerequisite of §12.4 step 13 DEPLOY.**
>
> **Second correction to the prior pack:** OA-6 as written names **two** variables. The candidate requires
> **three** — `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, **and `SITE_ORIGIN`** — each routed through
> `laneValue()` and each throwing when absent (instrument: `git show origin/staging:functions/_seo.ts`
> lines 24–64, UTC 2026-08-27T11:15Z). **Setting only two still throws.**

## B-7 · Rows carried forward — not re-measured this pass, and not upgraded by this report

| ID | Item | Status | Outcome | Basis | UTC | Artifact |
|---|---|---|---|---|---|---|
| B-7.01 | G1 §8.10 production unchanged | **VERIFIED** | SATISFIED | SI+C | 2026-08-27T07:38:38Z | `claude/G1_G10_FINAL_CLOSURE_REPORT_2026-08-27.md` §1 |
| B-7.02 | G3 repository-scope `SUPABASE_DB_URL` absent | **VERIFIED** | SATISFIED | SI+C (`repo=0` against `env=1`) | NOT RECORDED | same, §2 |
| B-7.03 | G3 Environments exist / repository copies deleted | **OWNER-ATTESTED** | SATISFIED | OWNER | NOT RECORDED | §3.1 — may **not** be described as verified |
| B-7.04 | G5a guard, 21/21 mutants on this tree | **VERIFIED** | SATISFIED | SI+C — a surviving mutant is the negative case | NOT RECORDED | run `32982588154` |
| B-7.05 | G6 header/redirect parity, production direction | **NOT YET VERIFIED** | NOT ESTABLISHED | NONE | NOT RECORDED | lands with CHG-003 at promotion |
| B-7.06 | G8 part 1 — upload → `50mm-staging` → staging CDN | **VERIFIED** | SATISFIED | SI+C — 2×2 origin × present/absent grid; served 240×140 | NOT RECORDED | `claude/G10_PHASE5_QA_RUN2_FULL_EVIDENCE_2026-08-27.md` |
| B-7.07 | G8 part 2 — production-write refusal | **BLOCKED** | NOT ESTABLISHED | NONE | NOT RECORDED | Appendix A.5 |
| B-7.08 | G8 part 3 — production object count | **BLOCKED** | NOT ESTABLISHED | NONE | NOT RECORDED | Appendix A.5 |
| B-7.09 | G9 71-function EXCLUDED countersignature | **NOT YET VERIFIED** | NOT ESTABLISHED | NONE | NOT RECORDED | `claude/G10_PHASE7_READINESS_CHECKLIST_2026-08-27.md` |
| B-7.10 | HS-12 branch protection on `main` | **NOT YET VERIFIED** | NOT ESTABLISHED | NONE | NOT RECORDED | §17-7 — can never exceed OWNER-ATTESTED |
| B-7.11 **[v3.1]** | §15 row 1 UI asset host | **VERIFIED** | REQUIREMENT NOT MET | SI+C | NOT RECORDED | AF-03 / D-5 — assets resolve to `cdn.50mmretina.com` on 29 routes. **Corrected in v3.1:** the criterion was measured with a control and the measurement is sound; what fails is the requirement, not the verification. `NOT YET VERIFIED` beside a measured failure was self-contradictory |
| B-7.12 | §15 row 2 flows | **NOT YET VERIFIED** | NOT ESTABLISHED | SI+C for 7 of 10 | NOT RECORDED | `claude/G10_PHASE5_CONSOLIDATED_QA_CLOSURE_2026-08-27.md` |
| B-7.13 | §15 row 3 auth | **NOT YET VERIFIED** | NOT ESTABLISHED | SI+C partial | NOT RECORDED | same |
| B-7.14 | §15 row 4 database lane-gate transcripts | **NOT YET VERIFIED** | NOT ESTABLISHED | SI+C for RLS (18 assertions, 4 controls) | NOT RECORDED | same |
| B-7.15 | §15 row 5 storage negative half | **BLOCKED** | NOT ESTABLISHED | NONE | NOT RECORDED | same blocker as B-7.07 |
| B-7.16 | §15 row 6 edge-function scope ruling | **NOT YET VERIFIED** | NOT ESTABLISHED | SI+C — 5/74 invoked, all staging, 0 production calls, 347/347 request IDs | NOT RECORDED | same |
| B-7.17 | §15 row 6 — five financial functions | **NOT APPLICABLE** | NOT APPLICABLE | policy | NOT RECORDED | **POLICY EXCLUSION — displayed, never folded into a coverage ratio** |
| B-7.18 | §15 row 7 security | **VERIFIED** | SATISFIED | SI+C | NOT RECORDED | run `32982588154` |
| B-7.19 | §15 row 8 SEO instrument | **VERIFIED** | REQUIREMENT NOT MET (criterion) | SI+C — same-minute dual-host, known-present and known-absent | staging 2026-08-27T07:26:03Z · production 2026-08-27T07:26:43Z | `claude/G1_G10_FINAL_CLOSURE_REPORT_2026-08-27.md` §4 |
| B-7.20 | §15 row 9 email | **NOT APPLICABLE** | NOT APPLICABLE | SI−C | NOT RECORDED | §8.8 Option 1 — no send path; vacuous and recorded as vacuous |
| B-7.21 | §15 row 10 responsive breakpoints | **BLOCKED** | NOT ESTABLISHED | SI−C — instrument reported success 3× while `innerWidth` never moved | NOT RECORDED | `claude/G10_PHASE5_INTERACTIVE_QA_RUN_2026-08-27.md` |
| B-7.22 | §15 row 11 regression, positive half | **NOT YET VERIFIED** | NOT ESTABLISHED | NONE | NOT RECORDED | §18 — structurally post-promotion (§17-12) |
| B-7.23 | §15 row 12 — N1 and N2 | **NOT YET VERIFIED** | NOT ESTABLISHED | SI+C for N3–N8 | NOT RECORDED | §15.2 |
| B-7.24 | Auditor P1–P6 executed | **VERIFIED** | SATISFIED | auditor harness | 2026-08-27T10:48:06Z | 2 VERIFIED · 4 BLOCKED · 1 NOT YET VERIFIED; verdict NOT READY |

## B-8 · The promotion artifact chain

| ID | Claim | Status | Outcome | Basis | Instrument | UTC |
|---|---|---|---|---|---|---|
| B-8.1 | A §11 Release Approval Record exists with all eight fields signed | **BLOCKED** | NOT ESTABLISHED | NONE | owner document; absence not provable by this session | NOT RECORDED |
| B-8.2 | A tag exists | **VERIFIED** | REQUIREMENT NOT MET | SI+C | `git tag \| wc -l` = 0 after `fetch --tags` | 2026-08-27T11:19:12Z |
| B-8.3 | That tag resolves to `e2e05fbb…` | **VERIFIED** | REQUIREMENT NOT MET | SI+C | vacuously fails: no tag exists | 2026-08-27T11:19:12Z |

**Amendment-3 rule applied:** promotion readiness requires **all three** of a signed approval record, a
created tag, and that tag resolving to the candidate tree. **None of the three holds.** A bare tag does
not satisfy this rule.

---

# PART C · STATUS LEDGER AND RECOMPUTED COUNTS

**55 rows** (54 in v3, plus B-1.6). Counts recomputed mechanically from the ledger, not by hand.

| Status | v3 | **v3.1** | Δ |
|---|---|---|---|
| **VERIFIED** | 31 | **33** | +2 — B-7.11 corrected; B-1.6 added |
| **NOT YET VERIFIED** | 13 | **12** | −1 — B-7.11 moved to VERIFIED |
| **BLOCKED** | 7 | **5** | −2 — B-1.2 and B-1.5 closed by owner evidence |
| **OWNER-ATTESTED** | 1 | **3** | +2 — B-1.2, B-1.5 |
| **NOT APPLICABLE** | 2 | **2** | unchanged |
| **Total** | 54 | **55** | +1 |

| Outcome | v3 | **v3.1** | Δ |
|---|---|---|---|
| **SATISFIED** | 27 | **30** | +3 — B-1.2, B-1.5, B-1.6 |
| **NOT ESTABLISHED** | 19 | **17** | −2 — B-1.2, B-1.5 |
| **REQUIREMENT NOT MET** | 6 | **6** | unchanged — B-7.11 kept its outcome |
| **NOT APPLICABLE** | 2 | **2** | unchanged |
| **Total** | 54 | **55** | +1 |

**The five remaining `BLOCKED` rows, named:** B-7.07 G8 part 2 production-write refusal · B-7.08 G8 part 3
production object count · B-7.15 §15 row 5 storage negative half · B-7.21 §15 row 10 responsive
breakpoints · B-8.1 §11 approval record signed. **None is blocked by the API 403.**

**The three `OWNER-ATTESTED` rows, named:** B-1.2 run-to-workflow binding · B-1.5 RECONCILIATION-01 ·
B-7.03 G3 Environments and repository-copy deletion. **Under §3.1 none may be described as independently
verified.**

**The six `REQUIREMENT NOT MET` rows, named explicitly:** B-1.4 probe branch not deleted · B-4 `main`
lacks all four §8.1 clauses · B-7.11 §15 row 1 UI asset host · B-7.19 §15 row 8 SEO criterion ·
B-8.2 no tag exists · B-8.3 no tag resolves to the candidate tree.

**Consistency assertions checked before release of this report:**
no row carries two statuses · no status string contains an outcome phrase · every status is one of the
five permitted values · every outcome is one of the four permitted values · every row carries a basis and
an instrument · no `SI−C` row is reported VERIFIED · every time field is a UTC value or the literal
`NOT RECORDED` · no dash placeholder appears in any time field · no inferred timestamp appears anywhere ·
no masked value is treated as evidence.

---

# PART D · PATH TO ALL-GREEN

This report cannot mark G1–G10 GREEN, because 12 rows are NOT YET VERIFIED, 5 are BLOCKED, and 6
requirements are measured as failing. **What it can do is state exactly what turns each into GREEN, and
confirm that no remaining item requires abandoning the candidate.**

| Gate | Remaining distance to GREEN | Requires a new candidate? |
|---|---|---|
| G1, G2, G4, G5a, G7 | **none — already GREEN** | no |
| **G5b** | **Pages variables only** (three, not two). **The code half is already in the candidate** — B-6.1, B-6.2 | **NO — this changed in v3** |
| **G8** | one owner-run command set with both controls, plus object counts | no |
| **G3** | §5.3 re-run immediately before promotion + branch deletion; §8.1 clauses install at promotion | no |
| **G6** | production direction lands with CHG-003 at promotion | no |
| **G9** | one countersignature | no |
| **G10** | branch protection + signed §11 approval + tag + merge + §17-11 re-assert + §18 | no |
| **§15 rows 1 and 8** | AF-03's 46 `site_settings` references — an owner-approved database write, **not a code change** | no |

**Nothing on this list requires a new tree.** The ceiling stated in the closure declaration is revised
upward by this report: with the G5b code half already present, **G5b's only obstacle is owner
configuration**, so an end state of **all gates GREEN or CLOSED WITH DOCUMENTED DEVIATION under §3.2** is
reachable on this candidate. The two items that remain attested-by-construction — G3's Environments and
HS-12 branch protection — are OWNER-ATTESTED under §3.1 and **may never be described as independently
verified**, whatever else is completed.

---

# PART E · PROMOTION VERDICT

## **NOT READY**

**Reason:** total tag count is 0, so no signed approval record, no tag, and no tag resolving to
`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` exist.

**The four gating proofs, re-checked at v3.1:**

| # | Gating proof | v3.1 state |
|---|---|---|
| 1 | §11 approval chain — signed record **and** tag **and** tag resolving to the candidate tree | **BLOCKED** / **REQUIREMENT NOT MET** — none of the three exists (B-8.1, B-8.2, B-8.3) |
| 2 | G8 §8.6 parts 2 and 3 — production-write refusal with both controls, plus object counts | **BLOCKED** — credential, not network, not tooling (B-7.07, B-7.08) |
| 3 | §5.3 probe re-run **immediately before promotion**, branch deleted afterwards | **NOT YET VERIFIED** / **REQUIREMENT NOT MET** — B-1.3 and B-1.4 are **unchanged by the v3.1 addendum** |
| 4 | N1 lane-gate refusal transcript | **NOT YET VERIFIED** — not dispatched (B-7.23) |

**The v3.1 addendum closed the binding question for run `32950030302`. It did not satisfy any of the four
gating proofs.** Gating proof 3 is untouched in particular: establishing that the 2026-08-26 run printed
`EMPTY` does not satisfy a clause constraining *when* the measurement is taken (§5.3.6; §19 *"must be
re-taken rather than inherited"*), and the probe branch is still present on the remote.

*Candidate tree unchanged · `main` unchanged · production untouched · trial merge aborted and its worktree
removed · nothing dispatched, signed, tagged, pushed or merged to produce this report.*

---

# DELTA — WHAT CHANGED FROM v2

> **Reading note (v3.1).** The table below is the **v2 → v3** delta and is preserved as written. Two of its
> rows were superseded by v3.1: **former B-1.2 (run-to-workflow binding) and B-1.5 (RECONCILIATION-01) are
> now CLOSED as OWNER-ATTESTED**, not BLOCKED, on owner-supplied `head_sha` and `run_started_at`.
> **The v3 → v3.1 delta at the end of this section is authoritative for current state.**

| # | Item | v2 | v3 |
|---|---|---|---|
| 1 | **Status/outcome blending** | B-1.4 read `VERIFIED — REQUIREMENT NOT MET` as a single status string; B-4 similar | **Split into two fields everywhere.** Status is one of five values and never contains an outcome phrase. A four-value outcome vocabulary is defined, adding **`NOT ESTABLISHED`** to separate *"measured and fails"* from *"not measured"* — v2 conflated those two |
| 2 | **Time placeholders** | dashes used in time fields | **Every time field is a UTC value or the literal `NOT RECORDED`.** No dash placeholder, no inferred time |
| 3 | **B-1.1 scope** | stated as verified without an explicit boundary | **Boundary stated as its own block:** VERIFIED covers **workflow design logic only**, at tip `9478cf7`. Run-to-workflow binding was **BLOCKED** pending `head_sha`. The row says in terms that **it alone does not close G3**. **⟶ v3.1 note:** the owner has since supplied `head_sha` and `run_started_at`, and **B-1.2 and B-1.5 are now closed as OWNER-ATTESTED** (see the v3→v3.1 delta at the end). **This table describes the v2→v3 step and is left as written; read it together with that note.** |
| 4 | **The 403** | recorded as an instrument limitation | **Scoped explicitly as session-level, not repo-wide**, with two supporting measurements: git-protocol access to the same repository succeeds, and unauthenticated `api.github.com` returns 200. States that an owner or auditor is not subject to it |
| 5 | **G5b — new measurement, and a prior record corrected** | code half recorded as outstanding, requiring a new candidate, deferred to G11 | **RECONCILIATION-02.** Measured on the candidate: `functions/_seo.ts` carries **zero production literals** and `laneValue()` throws instead of defaulting; the guard **already scans `functions/`** with rule R11. **Both halves are in the candidate. G5b needs no new tree** |
| 6 | **New promotion prerequisite raised** | not identified | Because `laneValue()` throws, deploying without the Pages variables makes **five SSR SEO routes throw at request time**. **OA-6 is reclassified from parallel gate item to blocking prerequisite of §12.4 step 13.** And it requires **three** variables — `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, **`SITE_ORIGIN`** — where the prior pack named two. **Setting only two still throws** |
| 7 | **Counts** | 24 / 1 / 8 / 2 / 8 across 43 rows, hand-tallied | **v3: 54 rows. v3.1: 55 rows, recomputed** — VERIFIED 33 · NOT YET VERIFIED 12 · BLOCKED 5 · OWNER-ATTESTED 3 · NOT APPLICABLE 2. Outcomes: SATISFIED 30 · NOT ESTABLISHED 17 · REQUIREMENT NOT MET 6 · NOT APPLICABLE 2. Failing requirements, remaining blocked rows and owner-attested rows are each named individually |
| 8 | **Path to all-GREEN** | ceiling stated as *"never 11 GREEN"* | **Revised upward.** With the G5b code half already present, **no remaining item requires a new candidate.** G3's Environments and HS-12 remain OWNER-ATTESTED by construction and may never be called verified |
| 9 | **Verdict** | NOT READY | **NOT READY — unchanged.** No evidence satisfying the four gating proofs became available |

**Unchanged from v2 and re-confirmed at 2026-08-27T11:19:12Z:** all eight external facts, the trial-merge
tree-equality result, the 16-of-17 path reconciliation, PR 103 not merged, AF-15's 0-of-4 versus 4-of-4,
the nine `UNAPPLIED_` files, and the probe branch still present on the remote.

---

# OWNER ACTION CARD — THE NEXT FOUR ACTIONS

Ordered. Actions 1–3 run in parallel; action 4 requires all three complete.

## ACTION 1 · Set the three production Pages variables

**Who can execute:** **OWNER only.** Cloudflare Pages environment variables are owner-scoped (§16: HIGH
blast radius). Not the auditor, not any session.
**Do:** Cloudflare dashboard → Workers & Pages → `lens-lustre-learn` → Settings → Variables and Secrets →
**Production** → add all three:
`SUPABASE_PROJECT_REF` · `SUPABASE_ANON_KEY` · `SITE_ORIGIN`.
A redeploy is required before Pages Functions observe them.
**Required evidence artifact:** a screenshot or written confirmation listing **all three names** under
Production with values masked, **plus the Change Ledger entry ID** for the production configuration change.
**Pass condition:** all three names present under Production **and** a Change Ledger entry exists.
**Fail condition:** **any one** of the three absent or empty. `laneValue()` throws on absent *and* on
empty-string, so two-of-three is a failure, not partial progress.
**Why this is first:** it is a **blocking prerequisite of §12.4 step 13 DEPLOY**. Promoting without it
makes `/competitions/[id]`, `/courses/[slug]`, `/featured-artist/[slug]`, `/journal/[slug]` and
`/page/[slug]` throw at request time.

## ACTION 2 · Execute the G8 §8.6 R2 write-isolation negative test

**Who can execute:** **OWNER only**, on the owner's own machine, in a terminal. Not in any Claude session,
not in CI, not in a browser console. **No session may hold this credential — §14 HS-10.**
**Do:** export the staging R2 key id and secret in that shell only; run the four Appendix A.5 commands in
order — known-present control (`put-object` to `50mm-staging`, must succeed), the test (`put-object` to
`50mm`), known-absent control (`put-object` to a non-existent bucket), then delete the control object.
Capture the production bucket object count **before and after**. Close the shell afterwards.
**Required evidence artifact:** the four command outputs **with credentials redacted**, the two production
object counts, and UTC timestamps for each.
**Pass condition:** control 1 returns an `ETag`; the test returns **`AccessDenied` with no object
created**; control 3 returns **`NoSuchBucket`, not `AccessDenied`**; production object count identical
before and after.
**Fail condition:** the test **succeeds** → **STOP, §14 HS-1 and HS-9: the staging token is not scoped.**
Also a failure: control 3 returning `AccessDenied` — that would make the test's `AccessDenied`
non-discriminating, so the run proves nothing and must be rebuilt.
**Closes:** G8 parts 2 and 3 → **G8 GREEN**. This is the only gate that flips on a single action.

## ACTION 3 · Re-run the §5.3 probe, capture its metadata, delete the branch — and dispatch N1

**Who can execute:** **OWNER** for the dispatches and the Environment secret handling (§19: owner-only).
**AUDITOR** can read the run metadata if they hold repository API access.
**Do, in this order:**
**3a** — push the probe branch afresh **immediately before promotion**, not now: §5.3.6 constrains *when*
the measurement is taken, and an early run goes stale and must be repeated. Delete the branch after.
**3b** — read `head_sha` and `run_started_at` for **both** the new run **and** run `32950030302`
(`GET /actions/runs/<id>`). The second closes B-1.2 and RECONCILIATION-01.
**3c** — dispatch **N1** from branch `staging`, `target=staging`, with the staging Environment secret
temporarily set to the **production project ref and a deliberately invalid password**; restore the secret
in the same sitting. §8.1 refuses **without connecting**, so no real credential is placed anywhere, and
authentication failure is a second independent net.
**Required evidence artifact:** for 3a — run ID, the verbatim log line showing the reference resolving
**EMPTY**, and confirmation the branch was deleted. For 3b — the two `head_sha` values and the two
`run_started_at` values. For 3c — run ID, the verbatim `::error::` line, a statement that the *"Run it"*
step did not execute, and confirmation the staging secret was restored.
**Pass condition:** 3a's log contains the literal EMPTY line and `git ls-remote` returns **zero** refs
matching `refs/heads/scratch/g10-53*` afterwards; 3b returns `head_sha == 9478cf7…` for run
`32950030302`; 3c's gate refuses **before any SQL executes**.
**Fail condition:** 3a prints `NON-EMPTY` or the branch persists; 3b returns a `head_sha` **other than**
`9478cf768c47ba91cece3cddae02548e5f3ce8c2`, which would mean the run did not execute the workflow verified
in B-1.1 and that row's scope no longer transfers; 3c's *"Run it"* step executes.
**§14 HS-6 applies throughout:** if a lane gate refuses, that is the control working. **Fix the target,
never the gate.**

## ACTION 4 · Complete the promotion artifact chain

**Who can execute:** **OWNER only.** §11: *"Approval is a separate, explicit act. Reviewing evidence is
not approval; a green pipeline is not approval."*
**Prerequisite:** actions 1–3 complete, and the outstanding signatures and §15 rulings recorded (OA-9
through OA-16).
**Do, in this order, no reordering:** enable branch protection on `main` (§14 HS-12 — recorded as never
configured) → sign the §11 Release Approval Record, all eight fields, including the validity clause
*"This approval covers exactly the named tree; any further commit to staging voids it"* → **create the
tag before the merge** → merge, resolving `src/lib/generateCertificatePdf.ts` to the candidate's version →
**§12.4 step 11: assert `main` tree == `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` before committing** →
step 12 MIGRATE from the approved manifest only, expected no-op → step 13 DEPLOY with the guard's PASS
line → step 14 capture the deployment ID.
**Required evidence artifact:** branch-protection attestation with UTC; the signed eight-field approval
record; the tag name and the object it resolves to; the merge SHA; the **tree-equality assertion output**;
the migration step's no-op output; the guard PASS line; the deployment ID.
**Pass condition:** all three of amendment 3 hold — signed record **and** tag created **and**
`git rev-parse <tag>^{tree}` = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` — **and** the post-merge tree
assertion passes before the merge is committed.
**Fail condition:** the post-merge tree differs from `e2e05fbb…` → **STOP, do not deploy**; the merge was
performed against a different `main` tip than the one measured in B-2.3, and the conflict resolution must
be re-derived. Also a failure: a tag created without a signed approval record — that satisfies the letter
of a tag check while defeating its purpose.
**After promotion, immediately:** N2 from `main` (impossible earlier — `main` carries no gate, so a
pre-promotion N2 would test nothing, §14 HS-11) · §18 post-production checks · the auditor's P1–P6 re-run
with `base_ref=='main'` now satisfied.

---

## DELTA v3 → v3.1 — three minimal edits, no rewrite

| # | Edit | Effect |
|---|---|---|
| 1 | **B-7.11 status corrected** to `VERIFIED`, outcome `REQUIREMENT NOT MET` kept, basis `SI+C` kept | Removes a self-contradiction: v3 paired `NOT YET VERIFIED` with a measured failure. The measurement was sound with a control; what fails is the requirement, not the verification |
| 2 | **Owner-side closure addendum for B-1.2**, plus new **B-1.6** corroboration and consequential closure of **B-1.5** | `head_sha` matches the tip verified in B-1.1, so B-1.1's scope transfers to run `32950030302`. Recorded **OWNER-ATTESTED**, not VERIFIED — this session did not read the API. B-1.6 independently corroborates a **+4-second** commit→run interval. B-1.5 resolves: the run predates the prior pack by **22.48 hours**, so the pack's *"zero runs"* was **incorrect when written**, not stale |
| 3 | **Counts recomputed** and every consistency line re-checked | 55 rows. VERIFIED 33 · NOT YET VERIFIED 12 · BLOCKED 5 · OWNER-ATTESTED 3 · NOT APPLICABLE 2. Outcomes SATISFIED 30 · NOT ESTABLISHED 17 · REQUIREMENT NOT MET 6 · NOT APPLICABLE 2 |

**Unchanged:** every other row, instrument, timestamp and artifact reference · the Owner Action Card ·
**and the verdict.** Action 3b in the card is now partially discharged for run `32950030302`; **3a and 3c
stand in full**, because §5.3.6 constrains when the measurement is taken and the probe branch is still on
the remote.

**Verdict: NOT READY — unchanged.** None of the four promotion-gating proofs became fully evidenced.
