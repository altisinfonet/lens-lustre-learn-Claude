# Cover letter to the independent auditor — send today

Produced by: the compiler/audit session (Claude), 2026-08-30.
Status of this document: **produced by me, therefore not audited by me.** The auditor is asked to treat it as a claim, not a finding.
Owner: send this with `HANDOVER_PACK_2026-08-30_rev6.tar.gz` attached.

---

## Send this text

---

**Subject: rev6 pack — please begin closure work now; do not wait for rev7**

Thank you for the rev6 review. It was accepted in full. It found two things we had both missed, and one of our statements was wrong. Details below.

We are proceeding on the **full normal close** — every gate closed before the merge, no deviation, clean ledger entry. We are running the work in parallel rather than shortening it. **You are the critical path, so we are starting your work today rather than after ours finishes.**

### 1. What we accepted from your review

- **The four DRIFT records.** Upheld. `auth-email-hook`, `preview-transactional-email`, `process-email-queue`, `send-transactional-email` were classified while the closure returned a problem status. They are now **BLOCKED**. `UNKNOWN=0` has been corrected everywhere to mean *"no record was left unclassified"* and **not** *"all 71 closures were clean."*
- **`detect-orphan-files` is read-only.** Conceded — our error. It lists and reports; it deletes nothing. Our repeated phrase "two destructive-path functions" was wrong and has been corrected throughout, with the original wording preserved beside the correction. `purge-s3-orphans` is the destructive one; `detect-orphan-files` is a safety-critical **input** to it.
- **121 = 71 `raw/` + 50 `raw_full/`.** Confirmed exactly. Function inventory remains 71.
- **Credential-scrub proof.** Accepted as lacking run conditions. Reclassified **INFERRED**; being re-run with full transcript.
- **Post-promotion plan absent from the pack, and "Track R not started" stale.** Both accepted; both corrected in rev7.

### 2. What we found after your review — and it affects your numbers

Our closure instrument has a **lexer defect**: apostrophes are treated as string delimiters. Line 23 of the flagged file is `<Preview>It's been a month — here's what you've missed.</Preview>` — three apostrophes, an odd count, so the parse fails and the tool exits 3.

**The four failures are only the loud part.** A file with an **even** apostrophe count does not error — the tool silently treats the text between two apostrophes as a string literal, parses "successfully", exits 0, and **never sees what was inside.**

We are measuring the blast radius, repairing the tokenizer, proving the repair against a planted defect, and re-running the closure across all 71.

### 3. Three questions — the first one is urgent

**Q1 (please answer first).** When you recomputed the drift totals (19/21/31, 19/22/30 strict; 21/21/29, 21/22/28 import-map-excluded) and the CORS census (27/39/2/3), did you use **your own instrument, or the one shipped in our pack?**

Your corroboration is independent only if the instrument is independent. If you used ours, your agreement inherits our defect and both sets of numbers are **INFERRED**, not VERIFIED. This is not a criticism of your review — it is the one thing your review could not have known.

**Q2.** Four §25.3 rows — **1.4, 1.5, 1.6b, 1.6c** — have been BLOCKED for some time. Please state, for each, what specifically you require in order to close it. We have never had that list, and we have been unable to plan around it.

**Q3.** Under B13 condition 2, no edge function is deployed in this release. Do you agree that the merge therefore leaves every deployed function byte-identical? We are **not** asking you to treat any evidence as waived — the owner has chosen the full normal close and every gate will be met. We ask only so the ledger records the correct reason for each gate, rather than an assumed one.

### 4. What you can start today, from rev6

**Ready now:**
- **The 138-file review.** Our fix touches at most 4 files (`apply-migration.yml`, `verify-schema-dependencies.yml`, `functions/_seo.ts`, and `cloudflare/seo-edge-injector/worker.js` if it proves to be in scope). The other **134–136 files are final**. Please review those now; we will send a small delta for the changed ones.
- **The eight §25.3 infrastructure rows.** Infrastructure, not RC-dependent — unaffected by anything above.

**Please hold until we send it:**
- **The independent test-suite run** — awaiting the re-run with full run conditions.
- **The 71-function re-measurement** — tainted by the lexer defect until the repair and re-run land. Please do not close this row on the current numbers.

### 5. What is changing in the release candidate

A **minimal replacement RC**, cut from `staging`, fixing an unescaped shell construct in `apply-migration.yml` and `verify-schema-dependencies.yml`. Those two workflows are inside the 138, and their lane gate requires them to be on `main` before a production dispatch is possible — so merging the current RC is what would arm the injection, in a job holding the production database URL. Plus an escape fix in `functions/_seo.ts`, and possibly `worker.js`.

Nothing else changes. No merge, tag, deploy or migration has occurred, and none will before your closures and the §11 signature.

### 6. One item we are raising separately, outside the release

`assertStorageLane` appears in **zero of 71 deployed production bundles**. Production has no storage-lane guard at all, today, including in `purge-s3-orphans`. This is unaffected by the promotion and is not being held behind it — we are opening it as its own item and mention it only so it is on your record too.

### 7. Attached

`HANDOVER_PACK_2026-08-30_rev6.tar.gz` — sha256 `1378f5da5917fe1cf252616b51f38e4579009d816670dd211bb5f718fdb8f716`, 1,188,069 bytes, 111 members. Reproducible only under the stated construction: GNU tar 1.35, gzip 1.12, fixed file set, unchanged member mtimes, stable walk order.

Please send Q1 back as soon as you have it, even ahead of the rest — it sizes the remaining work on our side.

---

## Note for the owner

Send Q1 even if you send nothing else today. It is one sentence and it decides whether the drift and CORS censuses need re-running from scratch or not at all.
