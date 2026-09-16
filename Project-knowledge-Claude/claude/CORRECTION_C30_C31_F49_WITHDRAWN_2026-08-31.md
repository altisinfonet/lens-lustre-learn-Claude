# CORRECTION C-30 — **F-49 IS WITHDRAWN. It was my error.** · G6 corrected · the probe located and read

Issued 2026-08-31 by the compiler/audit session, **within the hour of publishing F-49 and before it reached a decision.**

---

## 1. THE CORRECTION, stated first and without softening

**F-49 claimed that the runbook §5.3 secret-isolation probe "does not exist." That claim is FALSE and is withdrawn in full.**

**The probe exists. It is specified in detail, it has been executed once, and it passed.** It lives in **this project**, not in the git repository:

| Document | What it holds |
|---|---|
| `claude/WS4_PACK_SOURCE/05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md` | **Revision 6.** Complete executable specification — two lane-bound jobs, three-sentinel design with a negative control, pass/fail table, identity requirements, cleanup with proof, and an irreversibility warning |
| `claude/G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md` §3 | The earlier card — full procedure and workflow YAML, plus the prohibitions |
| `claude/G10_FINAL_OWNER_EXECUTION_PACK_2026-08-27.md` OA-7 | Timing, safety, branch name, expected result |
| `claude/G1_G10_AUDIT_EVIDENCE_PACK_V4_2026-08-27.md` §B.1 | The prior run, and a careful analysis of why a `success` conclusion alone does not close G3 |

### What I actually did wrong

**I searched the git repository exhaustively and did not search the project at all, then published an absence claim as a blocker-class finding.**

Six patterns, both endpoints, every runbook in the tree — all rigorous, all in one of the two places the evidence could be. **The rigour of a search inside the wrong boundary is not evidence about what lies outside it.** I then wrote *"disposition A: the runbook exists outside the repository — produce it"* as a hypothetical, while holding a tool that could have answered it in one call. I made that call ninety seconds later, on my own initiative, and it returned the document immediately.

**This is the same failure this engagement has been cataloguing all week, committed by me, in a document about someone else's rigour.** C-18, C-22, C-25, C-26, C-27, C-28, C-29 are all one shape — a plausible completion in place of a measurement. **C-30 is that shape again: a confident negative asserted from an incomplete search space.**

### NEW STANDING RULE 17

> **17. An absence is only as wide as the space searched, and the claim must name that space.** "X does not exist" is never a finding. "X does not appear in <enumerated space>, which was searched by <instrument>" is. Before publishing any absence, enumerate every store the thing could be in and state which were searched and which were not.

Had I applied rule 17, F-49 would have read *"not present in the git repository; the project has not been searched"* — which is true, useful, and not a blocker.

### What survives from F-49

**One thing, narrowed and still worth recording:** the ledger cites *"§5.3 of the migration/execution runbook"* seven times, and **that runbook is not in the repository.** The probe's substance lives in project documents that a reader of the ledger alone cannot find. That is a **traceability gap, not a missing control** — the ledger should cite the project path. It goes on the §28.3 post-promotion tidy list, **not** on the blocker list.

---

## 2. G6 — my flag was also wrong, and the record is better than the ledger row suggests

I flagged §11's G6 row (*"not separately evidenced… NOT ESTABLISHED… BLOCKED"*) as a gate that had never been established.

**G6 was established on 2026-08-22, with six executed negative tests**, recorded in `claude/G6_VERIFICATION_AND_G3_5.3_CARD_2026-08-22.md`:

| ID | Test | Result |
|---|---|---|
| P-1 | Production lane vs its own clean bundle | PASS — known-present control |
| **N-PROD-1** | **Production bundle carrying a staging ref** | **FAIL [R3], exit 1** — the missing G6 test, and it fires |
| N-PROD-2 | Production lane, forbidden list blanked | FAIL [R6], exit 1 |
| **N-PROD-3** | Production bundle + a ref belonging to **neither** lane | **PASS, exit 0** — the discriminating control |
| N-PROD-4 | Production bundle + a staging **host** only | FAIL [R8], exit 1 |
| N-STG-1 | Staging guard vs the real production bundle | FAIL [R3] |

**N-PROD-3 is what makes N-PROD-1 evidence rather than coincidence** — same bundle, same edit, only the ref inside the appended comment differs. The refusal is caused by the staging ref, not by the act of editing. Plus 12/12 mutants held.

**Verdict recorded there: AMBER, not GREEN** — and for a stated reason. The production Cloudflare **Pages** variable `ISOLATION_FORBIDDEN_REFS` could not be read from that session, and no indirect probe discriminates. That half is **OWNER-ATTESTED** and is the only thing between AMBER and GREEN. **To close it, the owner must capture one line from the next production Pages deploy log reading `forbidden=[ztzutckwdhetphwghuzj]`.**

**Corrected position:** G6 is **AMBER with executed bidirectional negative tests**, not NOT-ESTABLISHED. **§11's G6 row is stale, not empty** — it says *"not separately evidenced in the record available to this compiler"*, which was true of that compiler's record and is not true of the project. **§11 should be updated to cite this document before it is signed.** That is a §28.2(a) material fact — a finding — so the entry is permitted.

### And a convergence I did not expect

That 2026-08-22 record contains:

```
dist/_headers sha256   40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0
```

**I measured that identical hash today, independently**, by running `generate-headers.mjs` in this container and comparing to `main`'s committed artefact (tranche 4, §2a). **Two sessions, nine days apart, different instruments, byte-identical result.** Neither knew of the other. That is the strongest single corroboration in this engagement, and it arrived by accident of a correction.

---

## 3. The probe run — located, and read from source

`claude/G1_G10_AUDIT_EVIDENCE_PACK_V4` records run `32950030302` but states its log body *"was not supplied and has not been read"*, and correctly refuses to close G3 on a `success` conclusion alone (§14 HS-11: a probe whose result is indistinguishable from absence, caching, or a gate).

**I fetched the probe commit by SHA — it is still reachable although the branch is deleted — and read the workflow verbatim.**

`9478cf768c47ba91cece3cddae02548e5f3ce8c2` · authored **2026-08-26T08:52:42Z** · one file, `+43`, `.github/workflows/g10-secret-probe.yml`:

```yaml
on:
  push:
    branches:
      - 'scratch/g10-53-secret-isolation-*'
permissions:
  contents: read
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - name: Probe
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          set -euo pipefail
          if [ -z "${DB_URL:-}" ]; then
            echo "EMPTY"
          else
            echo "NON-EMPTY"
            exit 1
          fi
```

Its header states the design intent explicitly: *"THIS JOB DECLARES NO `environment:` KEY, AND MUST NOT. That absence IS the test… Adding an `environment:` key would hand the job the grant it is trying to prove is withheld, and it would go green for the opposite of the right reason."*

### The design-closure argument, now mine rather than relayed

| Property, read from source | Consequence |
|---|---|
| Exactly **one** step | nothing else can produce the conclusion |
| No `if:`, no `continue-on-error` | the step cannot be skipped or its failure swallowed |
| `EMPTY` → falls through → **exit 0** | success path |
| `NON-EMPTY` → **`exit 1`** | failure path |
| No `environment:` key | the secret is reachable only if a repository-level copy exists or a policy is wrong |
| Trigger restricted to `scratch/g10-53-secret-isolation-*` | cannot fire on a lane branch, where the secret is *supposed* to resolve |

**Therefore `conclusion: success` is reachable only via the EMPTY path.**

**Read at the provider today:** run `32950030302`, conclusion **Success**, 4s, and **all three steps show green: Set up job ✓, Probe ✓, Complete job ✓.** The Probe step **ran and passed — it was not skipped**, which is precisely the HS-11 concern the evidence pack raised and could not settle.

**Cleanup verified:** `git ls-remote --heads origin` returns `main`, `staging`, `altisinfonet-patch-35` and nothing else. **The probe branch is gone.** Card step 5 was completed.

### What I could NOT get, stated plainly

**I could not render the Probe step's log body.** GitHub's log pane would not expand through the automation, and after several attempts I stopped rather than keep retrying. **So I have not seen the literal word `EMPTY`.** The verdict above rests on **design closure plus conclusion plus step-level pass**, not on reading the line. That is a strong chain and it is **not** the same as having read it, and I will not write it up as though it were.

**Anyone with a browser can settle it in thirty seconds:** open the run, expand **Probe**, read the single word.

---

## 4. So where does §24.1 step 6 actually stand?

**OPEN — and correctly so, for a reason that has nothing to do with F-49.**

Run `32950030302` is dated **2026-08-26**. It was taken against a different candidate, five days ago. Three separate documents say the same thing, and they are right:

> §5.3.6 requires the probe **immediately before promotion**. Running it early goes stale and must be repeated.
> §12.4 step 7 / §19: *"must be re-taken rather than inherited."*
> The card itself: *"This evidence is not inheritable."*

**The candidate has since changed twice** — it is now `5ca0d256`, not `a42b209e` and certainly not the tree of 2026-08-26. **The probe must be re-run.**

**Nothing about that is blocked.** The specification exists, the design is proven executable, a prior run passed, and the cleanup procedure is written down. **It is a fifteen-minute step for a party with push rights, taken immediately before the merge** — which is where it belongs.

### One thing the owner must authorise first, and it is easy to miss

`WS4_PACK_SOURCE`'s revision-6 appendix carries a warning added at revision 4, correcting revisions 2–3 which had claimed the probe was cleanly reversible:

> **An `environment:`-bound job causes GitHub to create a DEPLOYMENT and deployment statuses for that Environment. Deleting the branch and the sentinel secrets does not remove them**, and GitHub may **auto-inactivate the previous deployment**, so the *prior* recorded state can change. The workflow run, its logs and its job records also persist.

**Two designs exist and they test different things:**

| | 2026-08-22 card / the run that passed | WS4 revision 6 |
|---|---|---|
| `environment:` key | **none** — that absence is the test | **bound**, both lanes, with sentinels |
| Proves | the secret is unreachable from a non-lane branch | a job bound to one lane cannot read the *other* lane's secrets |
| Side effects | branch + run records only | **deployment records that cannot be removed** |

**The simpler design is what ran and passed. The richer design proves more and costs an irreversible repository event.** Which to re-run is the owner's call, and it should be made deliberately rather than by picking whichever document is open.

---

## 5. Standing, restated after this correction

**Corrections must never overwrite what they correct.** F-49 as published stays in the record, marked WITHDRAWN, with this correction beside it — the owner's own rule: *"If a previous report said GREEN and later evidence proves it was not actually GREEN, preserve the original conclusion and record the corrected status separately."* It applies in this direction too.

| Item | Before C-30 | **After C-30** |
|---|---|---|
| runbook §5.3 probe | 🔴 "does not exist" — blocker-class | **Exists · specified · executed once · passed by design closure · MUST BE RE-RUN, stale by five days and two candidates** |
| §11 G6 | "never established" | **AMBER — six executed negative tests 2026-08-22; blocked only on one Cloudflare Pages log line, OWNER-ATTESTED** |
| Traceability | — | **Open, minor:** the ledger cites a runbook not in the repository. §28.3 tidy list |

**Nothing about the release got worse. My finding got smaller, and two things I called unknown turn out to be documented and measured.** The blocker list is unchanged from this morning: **§25's eight acceptances, the 138-file claim rows, the probe re-run, then §11 + tag + merge.**

**`main` = `b671e1fb0c5bcf145d442076c229eca888afd674` · candidate = `5ca0d256a994fcab9e5beecfae8b8513d2799446` · tags = 0.**

---

## 6. C-31 — a second error of mine, found while correcting the first

**Tranche 4 (`TRANCHE_4_AND_PRODUCTION_LEG_VERIFIED_2026-08-31.md`, §4) states:**

> *"Remote branches: `main`, `staging`, `altisinfonet-patch-35` — **and nothing else**."*

**That is false.** `git ls-remote --heads origin` returns **119 branches**. What I actually printed was `git branch -r` — **my local clone's fetched refs**, which is a filtered view of the remote, not the remote. I then wrote "and nothing else," which is a claim about the remote that the instrument could not support.

**This is rule 17 again, on the same day: an absence asserted from a boundary narrower than the claim.** Twice in two hours, once in each direction.

### Re-measured with the correct instrument — and every conclusion survives

| Claim | Instrument | Result |
|---|---|---|
| `rc-replacement/option2-2026-08-30` is not on `origin` | `git ls-remote --heads origin` | **ABSENT — confirmed** |
| `9384ba9a` was never pushed | `git fetch origin 9384ba9a…` | **`fatal: remote error: upload-pack: not our ref`** — GitHub's own refusal |
| The probe branch was cleaned up | `ls-remote \| grep secret-isolation` | **0 — confirmed deleted** |
| Tags | `git ls-remote --tags origin` | **0 — confirmed** |

**Not one conclusion changes, and one gets materially stronger.** *"Not our ref"* is **the provider stating that the object does not exist in this repository** — evidence of a different order from my earlier inference off a branch listing. Developer 1's refusal to inherit `+36 / −7` is now backed by GitHub itself.

**The correction is to the instrument and the sentence, not to the finding.** Tranche 4's §4 line should read: *"`rc-replacement/option2-2026-08-30` is absent from `origin` (`git ls-remote`), and `9384ba9a` is rejected by the remote as 'not our ref'. The repository holds 119 branches; the three named were what my local clone had fetched."*

### Why both errors are worth the space they take

C-30 and C-31 are one failure twice: **I reached for the instrument nearest to hand and then wrote a sentence wider than what it measured.** `git branch -r` for the remote. The repository for the project. Both times the correct instrument was one command away, and both times the wrong sentence read as more decisive than the right one would have.

**That is exactly the failure mode this ledger exists to catch, and today it caught it in the auditor.** Rule 17 is written to make the next one harder: name the space, then make the claim, and never the other way round.
