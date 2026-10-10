# G10 COMPLETION RUNBOOK — REVISION 2.1 (2026-08-26)

Supersedes Revision 1. Delivered as `G10_COMPLETION_RUNBOOK_REV2_2026-08-26.docx` (25 pages).
Governed by `50mm_Master_Execution_Plan_v3.docx` (Rev 3.0). Where this and Rev 3.0 disagree, **Rev 3.0 wins**.

Revision 2 exists because a reviewer proposed ten additions. Seven were accepted as **mandatory
controls**, three were merged into existing material, and one reviewer claim was corrected back.
Revision 2.1 resolves a merge-wording ambiguity the reviewer caught on the final read.

---

## RULE ZERO — NO EVIDENCE BY INFERENCE

> If a required assertion cannot be directly evidenced, its status remains NEED EVIDENCE or
> BLOCKED. "Probably true", "consistent with", "inferred from timestamps", "the same pattern
> held elsewhere" and "the owner says so" are **never** converted into a pass unless Rev 3.0
> explicitly permits that evidence class for that line.

Seven places in this programme where inference would have manufactured a false green:
G7 robots body · G8 R2 bidirectionality · G9 production functions · G5a mutant count ·
G6 production refusal · G1 Zero Trust · G3 environment scoping.

---

## THE SEVEN MANDATORY CONTROLS

| | Control | What it forbids |
|---|---|---|
| **C1** | Candidate tree freeze — final and immutable | After the candidate tree is declared: no merge, rebase, cherry-pick, amend or force-push. All §15/§17/QA/RC evidence references that exact tree. Any code change **INVALIDATES** the candidate and the whole candidate-specific verification set re-runs from Phase 3. |
| **C2** | The equality chain — commit → tree → tag → main → deployment | Promotion is valid only if the production artefact is demonstrably derived from the exact approved tree named in §10/§11. **A branch name is never evidence.** Every link recorded and compared; any mismatch fails promotion. |
| **C3** | No changes after RC | Once the RC exists: no merge, cherry-pick, rebase, amend, force-push, manual production code deployment, direct edge-function deployment, or Pages production deployment other than the approved promotion. On failure the RC is **INVALID** → return to candidate-building. Never patch an RC. |
| **C4** | G9 / CORS scope is decided, not deferred | Production CORS hardening is **IN** this RC or **explicitly EXCLUDED** by written owner decision recorded *before* RC creation. If in scope, evidence must show the **deployed** functions carry the hardened implementation — that `main` contains the file is not evidence that production runs it. |
| **C5** | HS-10 is a rotation proof, not a yes/no | Must record: whether rotation occurred; secret class affected; rotation completion timestamp; confirmation the **old credential is invalid/revoked**; confirmation no replacement value appears in repo, logs, CI output, screenshots or release artefacts. The value itself is never recorded. |
| **C6** | Abort criteria are standing permission to stop | Any executing session has authority **and obligation** to abort. It does **not** have authority to repair. |
| **C7** | One immutable release evidence bundle | The release is proven by a single assembled bundle with a hash manifest — not evidence scattered across sessions and chats. §15 has never existed as a single release artefact in this programme. |

---

## THE ONE CORRECTION BACK TO THE REVIEWER

C2 as proposed said the production artefact must be *"demonstrably derived"* from the approved
tree. Cloudflare Pages builds from a commit and serves a **build output**. Byte-equality between
tree and served assets is **not provable** without a reproducible build, which this project does
not have. Asserting it would itself be an inference — the exact thing rule zero forbids.

C2 is therefore asserted as four facts, not one inference:

1. the deployment's source commit equals the approved tag's commit;
2. that commit's tree equals the approved tree;
3. the Pages build command and all 10 environment variables are unchanged from the Phase 0 baseline;
4. the deployment succeeded.

### The C2 chain table (step 8.7)

| # | Link | Value to record | Must equal |
|---|---|---|---|
| 1 | Candidate commit | staging head at freeze (3.2) | — origin of the chain |
| 2 | Candidate tree T | tree of link 1 (3.3) | the tree named in §10 RC and §11 approval |
| 3 | Approved tag | `approved/<date>-<n>` → commit and tree (8.4) | tag's tree = link 2 |
| 4 | main after promotion merge | main head commit and tree (8.5) | main's tree = link 3's tree |
| 5 | Pages deployment source | deployment's source commit + that commit's tree | commit = link 4's commit; tree = link 2 |
| 6 | Pages build inputs | build command + all 10 env vars at deploy time | identical to Phase 0 baseline (0.1) |

---

## WHAT CHANGED FROM REVISION 1

| Area | Revision 1 | Revision 2 |
|---|---|---|
| Freeze | Phase 3 existed | C1 wording is **declared verbatim** in the freeze notice, with the invalidation cost written down (3.4, 3.5) |
| Equality | HS-7 tree check at promotion only | Full six-link chain, incl. deployment source commit captured in **Phase 0** (8.7) |
| Post-RC | "don't merge" | Full RC LOCK + the never-patch rule (6.9, 6.10) |
| Baselines | 5 fingerprint steps | 10-surface **production surface inventory** + 4 new baselines (0.0, 0.6–0.9) |
| G9 | "written §14 ruling" | Binary (A)/(B) decision before RC + deployed-function evidence required (1.3) |
| Edge functions | noted as inferred | **71-row deployment inventory**, six columns, no inferred rows (4.11, 9.6) |
| HS-10 | confirm or accept | **Five mandatory fields** incl. old-credential-invalid (1.1) |
| Abort | stop conditions HS-1…12 | Separate **abort criteria** page — 9 triggers + what abort means procedurally |
| Bundle | — | **Phase 11**, 18 mandatory items, sha256 manifest, manifest hash recorded twice |
| Reconciliation | §18 rows | "Expected changes: N. Unexpected changes: 0." against the 0.0 inventory (9.5) |

---

## THE THREE ONE-WAY DOORS

1. **FREEZE** (3.3) — the candidate tree cannot change without invalidating the candidate.
2. **RC LOCK** (6.9) — nothing may be deployed or rewritten except the approved promotion.
3. **PROMOTION** (8.5) — the equality chain must close, or the release is not proven and rollback is the answer.

---

## ABORT CRITERIA (control C6)

Abort G10 immediately if: the candidate tree changes after declaration · any §17 line fails ·
any hard stop HS-1…HS-12 becomes LIVE · production/staging source-equality fails · an unexpected
production deployment occurs · the deployed tree cannot be proven equal to the approved tree ·
required evidence cannot be independently reproduced · a secret appears in any output · an
owner-only assertion is being substituted for required evidence.

> **Never repair a failed promotion check by modifying the candidate while the RC is active.**

The session has authority to ABORT. It does not have authority to REPAIR.

Abort procedure: stop at the failing step (do not finish the phase "for tidiness") → record in the
Change Ledger with instrument and raw output *before* discussing remedy → declare the RC invalid →
return to Phase 2 (code fix) or Phase 1 (owner decision) → re-run the whole candidate-specific
verification set. Phase 0 baselines and Phase 1 decisions survive; nothing after Phase 3 does.
If the abort is post-promotion, execute the §13 rollback to Cloudflare deployment
`9c0c1201-41b4-4abf-9b5f-18598b5189d7` **and both halves** of the procedure.

---

## RELEASE EVIDENCE BUNDLE — 18 MANDATORY ITEMS (Phase 11)

Candidate commit SHA · candidate tree SHA · freeze notice · approved tag (name/commit/tree) ·
§10 RC record (24 fields) · §11 approval · §15 QA matrix (12 rows, positive **and** negative) ·
§17 checklist executed on promotion day · closed Change Ledger · CI run IDs with job-level results ·
schema-guard full coverage block · isolation mutation count quoted from the log · N1–N8 transcripts
(all eight) · G8 bidirectional R2 refusal evidence · Pages baseline and post-release fingerprints ·
production deployment ID + full C2 chain · 71-row edge-function inventory · rollback target and
§18 results.

Sealed with a sha256 manifest; the manifest's own hash is recorded in the RC record **and** the
project record. No secret value, fragment, or hash of a secret may appear anywhere in the bundle.

---

## REVISION 2.1 — THE PROMOTION-MERGE DISAMBIGUATION

Revision 2 used the bare phrase "the merge" in Phase 7 and Phase 8. The runbook performs **two**
merges, and the bare phrase could be read as either:

- the **staging candidate merge** (step 2.1) — builds the candidate;
- the **production promotion merge** (step 8.5) — ships it.

Step 7.2 read *"Signed and dated BEFORE the merge, not after (§17-10)"*, which could be misread as
requiring approval before Phase 2 — impossible, since **T cannot be measured until the candidate
merge has already happened**. Corrected in six places:

| Location | Now reads |
|---|---|
| Phase 2 title | "Land every intended change (the **STAGING CANDIDATE** merge)" — with an explicit note that none of it is the promotion merge |
| Step 7.2 | "Signed and dated **BEFORE THE PRODUCTION PROMOTION MERGE at step 8.5**, not after (§17-10). This does NOT mean before Phase 2." |
| Phase 8 intro | *"the merge" in this phase always means the PRODUCTION PROMOTION MERGE at step 8.5 — never the staging candidate merge at step 2.1* |
| Step 8.4 | "Create the tag on T, **BEFORE the production promotion merge at step 8.5**" |
| Step 8.5 | "Perform the **PRODUCTION PROMOTION MERGE** of the tagged tree T into `main`" |
| Step 8.6 | "main's tree **AFTER the production promotion merge** MUST equal the tag's tree" |

### The five steps, stated unambiguously (now a Phase 8 note)

> approve T (7.2) → tag T (8.4) → merge the tagged T into main (8.5) →
> verify main's tree = T (8.6) → verify the Pages deployment's source commit and tree (8.7)

Nothing in that sequence refers to the staging merge in Phase 2.

---

## NOTE ON THE §11 APPROVAL ORDERING

A reviewer flagged "record §11 approval naming the approved tree, before the merge" as dangerous.
That wording is from **section 8 of the earlier gate-audit DOCX**, not the runbook. Every runbook
revision already runs: staging candidate merge (P2) → freeze (P3) → verify (P4) → QA (P5) →
RC (P6) → approval (P7) → tag + promotion merge (P8). **The gate-audit DOCX still carries the old
wording and should be reissued or marked superseded** — it is the last document in the set with
the ambiguous sequence.

---

*Revision 2.1 issued 2026-08-26. The DOCX is the authoritative copy.*
