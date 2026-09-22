# Audit of the independent auditor's rev6 review, and consolidated Work Order WO-9

Date: 2026-08-30
Role of this document: compiler/auditor response to the owner's independent auditor.
Repository state at time of writing: `main` `b671e1fb0c5bcf145d442076c229eca888afd674`; ledger sha256 `f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943` (REV-16). No commits, tags, pushes, merges, deployments, migrations or provider writes have occurred.

---

## Part 1 — Is the auditor's review real?

**Yes.** Assessment of the review itself, item by item, against what I can check.

| Auditor statement | My check | Verdict |
|---|---|---|
| Archive sha256 `1378F5DA…FDB8F716`, 1,188,069 bytes | Matches the developer's twice-measured value and the value I hold | CONSISTENT |
| 111 members = 84 files + 27 directories; no traversal, no absolute paths, no duplicates, no links | Structural facts only obtainable by opening the archive; consistent with the manifest count of 83 files + the root manifest itself = 84 | CONSISTENT — and evidence the auditor actually opened the archive |
| Root manifest 83/83; WO1 nested 37/37; WS4 nested 25/25 | Matches the pack construction as built | CONSISTENT |
| Drift totals 19/21/31 and 19/22/30 strict; 21/21/29 and 21/22/28 import-map-excluded | Independently recomputed by the auditor and agrees with the developer | CORROBORATED |
| CORS census 27/39/2/3 vs 28/38/2/3, single disagreement on `submit-judge-decision` | The single disagreement is the one function promotion changes — expected, and the direction is explainable | CORROBORATED |
| RLS states production 7 / staging 9; inventories 71/74; R2 buckets | Agrees | CORROBORATED |
| Conclusion: pack supports "evidence ~90% advanced", **not** "release ~40% complete" or "ready to promote"; release nearer 20% | Matches the number I have been reporting since it was re-based on the 9 release gates | AGREED |

**Two things make this review credible rather than agreeable.** First, it recomputed the drift and CORS numbers rather than restating them, and it published one disagreement instead of a clean match — a review that agrees with everything has not measured anything. Second, it produced findings the developer and I both missed. Those are below.

**Nothing in the review is wrong.** I found no defect in it. That is not a compliment I have been able to pay any previous artefact in this engagement, including my own.

---

## Part 2 — The auditor's new findings, and my rulings

### R1 — Four DRIFT records whose closure returned a problem status — **UPHELD, and this is the serious one**

`auth-email-hook`, `preview-transactional-email`, `process-email-queue`, `send-transactional-email` were classified DRIFT while the RC closure step returned a problem status. A closure that failed cannot support a classification derived from it.

Consequence, stated plainly: **`UNKNOWN=0` must not be read as "all 71 closures were clean."** It means "no record was left in the UNKNOWN bucket." Four records reached a definite bucket by a path that did not complete. The drift totals are therefore corroborated as *counts* but four of the rows behind them are not yet evidence.

This is a new defect class, not a restatement of an old one: it is a **status derived from a failed instrument**, which is the same family as LG-05-DEF-1 (a judgement taken from the wrong field) and the same family as the parent rule — *compression is where scope falls off*. "UNKNOWN=0" is the compressed form; the four problem statuses are what fell off it.

Classification: the four records move to **BLOCKED** until re-closed. The 19/21/31 totals stay published with an explicit note that four constituent rows are BLOCKED.

### R2 — `detect-orphan-files` is read-only — **CONCEDED, my error**

The auditor is right. `detect-orphan-files` lists and reports; it performs no deletion. My repeated wording **"two destructive-path functions"** is wrong and appears in several of my documents. Correct description: `purge-s3-orphans` is the destructive function; `detect-orphan-files` is a **safety-critical input** to it — wrong output there causes wrong deletions downstream, which is why it belongs in the same track, but it is not itself destructive.

**C-14-L is unaffected in substance**: `assertStorageLane` appears in **zero of 71 deployed bundles**. The lane guard is absent everywhere, including both of these. Only my adjective was wrong, not the measurement.

### R3 — Production's 121 raw JSON files = 71 originals + 50 re-fetches — **UPHELD**

121 is a file count, not a function count. Any figure quoting 121 must carry its basis. Function inventory remains **71**.

### R4 — `WO3_test_credential_scrub_proof.txt` lacks run conditions — **UPHELD**

It corroborates totals but does not prove the command, exit code, checkout identity, dependency state, or per-test outcome. It is therefore **INFERRED**, not VERIFIED, until re-run with a full transcript.

### R5 — The corrected post-promotion plan is cited but not present in the pack — **UPHELD**

`claude/POST_PROMOTION_PLAN_2026-08-29.md` is unverifiable from the pack alone. It must be a member of the next pack.

### R6 — The pack says "Track R not started" — **UPHELD, stale**

The Track R reconciliation has since been performed. The pack statement is now false and must be replaced with the reconciliation result.

---

## Part 3 — The standing release position (unchanged by this review)

Merging `staging` into `main` today is **not indicated**, on one decisive ground:

`apply-migration.yml` and `verify-schema-dependencies.yml` are inside the 138-file application scope and carry a shell-injection construct. Their lane gate requires the workflow to be **on `main`** before a production dispatch is possible. **The merge is what arms the injection**, in a job that holds the production database URL.

- Option 1 (promote current RC as-is): **CLOSED**.
- Option 3 (broad rework): **not indicated** — jsonLd writers are admin/`content_editor`, service-role bypass measured at zero.
- **Option 2 — minimal replacement RC: INDICATED.** Two workflow files plus `functions/_seo.ts`; possibly four files if `cloudflare/seo-edge-injector/worker.js` carries the same construct (WO-8 item 1 answers this).

C-14-L (no lane assertion in any deployed function) is a live production issue **today**, independent of whether the release happens.

---

## Part 4 — Completion, with basis

| Figure | Value | Basis |
|---|---|---|
| Release completion, current RC | **~20%** | 9 release gates; 1.75 credited |
| Release completion, against a replacement RC | **~5%** | replacement RC not yet created; gates reset |
| Evidence work | **~90–95%** | corroborated independently by the owner's auditor |

---

## Part 5 — Work Order WO-9 (consolidated)

**Standing constraints — unchanged, all still in force.**
Do not expose secrets, tokens, cookies or credentials. Do not perform unsafe production writes. Do not execute financial transactions. Do not modify the frozen RC merely to manufacture a passing result. Do not run an unsafe N1/N2 configuration. Before any high-impact action, verify the actual workflow and branch being executed. Do not try to make the ledger look green — make it accurate. Do not overwrite previous conclusions; preserve the original and record the correction separately. Do not merge, tag, deploy, migrate, run the runbook §5.3 probe, or perform any production write. Do not install the ledger guard. **In this work order: prepare only — create no branch, no commit, no push.**

Evidence standard for every row: `Requirement → Instrument → Evidence → Result → Status`, classified VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED. Never silently convert one category into another.

### Group A — close the auditor's rev6 findings

**A1.** For each of `auth-email-hook`, `preview-transactional-email`, `process-email-queue`, `send-transactional-email`: report the exact closure command, its exit code, and its stderr. Then re-run the closure. If it succeeds, publish the new classification with the transcript. If it fails again, classify the record **BLOCKED** and state why. Do not leave any of the four as DRIFT on the strength of the failed run.

**A2.** Search every document in the pack and the project for the strings `UNKNOWN=0`, `UNKNOWN = 0`, and any sentence claiming all 71 closures were clean. Replace with: *"UNKNOWN=0 means no record was left unclassified; four closure records returned a problem status and are BLOCKED pending A1."* List every file changed.

**A3.** Search every document for `destructive-path`, `two destructive`, and `detect-orphan-files`. Correct to: *`purge-s3-orphans` is destructive; `detect-orphan-files` is read-only and is a safety-critical input to it.* Preserve the original wording in the correction register with the correction beside it. Do not delete the old text.

**A4.** Wherever 121 appears, add its basis: *121 raw JSON files = 71 function originals + 50 re-fetches. Function inventory is 71.*

**A5.** Re-run the credential-scrub test and produce a transcript containing: the exact command, the working directory, `git rev-parse HEAD`, the dependency install output, the full per-test output, and the exit code. Until that exists the result is **INFERRED**, and must be labelled so.

**A6.** Include `POST_PROMOTION_PLAN.md` as a file member of the next pack, with its sha256 in the manifest.

**A7.** Replace the "Track R not started" statement with the Track R reconciliation result, and include the reconciliation as a pack member.

### Group B — WO-8, still outstanding (unchanged text)

**B1.** Is `cloudflare/seo-edge-injector/worker.js` inside the 138-file application scope, and does it carry the same unescaped construct? Answer with the file's path, its presence/absence in the 138 list, and the exact lines.

**B2.** Is `stripHtml` actually an escape, or only a tag-stripper? Show the implementation and state which.

**B3.** Where do `purge-s3-orphans` and `detect-orphan-files` obtain bucket name, endpoint and public URL? **Use captured deployed source only. Read no secret value.** Report the resolution path, not the values.

**B4.** Is any `content_editor` role assigned to a non-staff account? Report counts and role assignment source, no personal data.

### Group C — prepare Option 2, do not execute it

**C1.** Produce the exact file list for a minimal replacement RC: `apply-migration.yml`, `verify-schema-dependencies.yml`, `functions/_seo.ts`, and `cloudflare/seo-edge-injector/worker.js` **if and only if B1 is positive**.

**C2.** For each file, produce the proposed diff **as a patch file in the evidence pack**. Do not apply it. Do not create a branch.

**C3.** State, for each file, what the change does not fix, so the owner sees the residue before ruling.

**C4.** State which of the 9 release gates the replacement RC resets, and which survive.

### Group D — pack hygiene

**D1.** Rebuild the pack as rev7 with a full-depth walk. Verify every file on disk appears in the manifest and every manifest line resolves to a file. Report both counts.

**D2.** Publish the archive sha256 **in full, never abbreviated**, plus the byte size and the member count.

**D3.** State the construction conditions verbatim: *reproducible only under the stated construction — GNU tar 1.35, gzip 1.12, fixed file set, unchanged member mtimes, stable walk order.*

**D4.** Because the project cannot hold the archive (766,858 B free vs 1,188,069 B measured), publish the pack's **contents as project documents** and the archive separately for the owner to download.

### Reporting rule

Return one report. Every row carries `Requirement → Instrument → Evidence → Result → Status`. Any row you did not personally run is **RELAYED**, not VERIFIED. If any item is blocked, say so and continue with the rest — do not stop the whole order on one blocker, and do not report the order complete while any item is unstarted.
