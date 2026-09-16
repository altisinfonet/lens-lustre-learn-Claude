# A-3 — owner authorisation recorded, and the execution order

Date: 2026-08-30
Role: auditor. This document records an owner authorisation and sets the conditions under which the resulting work will be accepted. I execute nothing.

---

## 1. The authorisation, verbatim

> **"I authorise cutting the replacement RC branch off `staging` and applying the corrected Option 2 patches to it. No merge, no tag, no deploy."**
> — Neil Basu (owner), 2026-08-30

**This is the first write operation authorised in this engagement.** Everything before it has been measurement. It is worth marking, and it is worth doing slowly.

**What it authorises:** creating one branch and applying three patches to it.
**What it does not authorise, and no reading of it may extend to:** merge, tag, deploy, migration, any provider write, any push to `staging` or `main`, any force-push, any pull request, any ledger commit. All standing constraints remain in force without exception.

---

## 2. The base commit — this is the one detail the authorisation does not settle, and it must not be guessed

The owner said "off `staging`". `staging` has two candidate points:

| Candidate | What it is | Consequence |
|---|---|---|
| **`a42b209e`** | the frozen RC | the patches were **verified to apply against this commit**, and this is the reviewed scope |
| `9ac4524d` | staging tip | ten commits ahead, **all of them `docs/PROMOTION_LEDGER.md` alone** |

**Ruling: cut at `a42b209e`.** Two reasons, both measured, neither inferred:

1. The corrected patches were verified `APPLIES CLEANLY` against `a42b209e` and against nothing else. Rule 8 — a patch is only known to apply where it has been shown to apply.
2. The ten intervening commits are ledger-only, and **§28 declares a documentation freeze**: no ledger-only revision may be committed before promotion. Building the replacement RC on top of ten ledger commits would carry frozen-document revisions into a code candidate for no benefit.

The base sha must be **reported, not assumed**, in the return.

---

## 3. Conditions of acceptance — the return is rejected if any is missing

### 3a. Provenance of the patches applied

The **defective originals are still in the pack** alongside `patches_fixed/`. A patch set that fails silently by being the wrong file is precisely today's failure mode repeated.

**Report the sha256 of each of the three patch files actually applied**, and state that they are the `16_LANES_ABC/patches_fixed/` set. Not the directory name — the hashes.

### 3b. Trigger enumeration BEFORE any push

Enumerate the `on:` block of **every** workflow present on the new branch and report which, if any, fire on a **branch push**.

- If **none** fires on a branch push: push the branch, and say so.
- If **any** fires: **do not push.** Build locally, report the enumeration, and stop. The branch can wait; an unexpected workflow run cannot be recalled.

`apply-migration.yml` is understood to be `workflow_dispatch` with no branch filter, which does not fire on push — **that is the expectation, not the finding.** Enumerate all of them and report the actual result.

### 3c. Measurements required in the return

| Item | Requirement |
|---|---|
| Base sha | reported, full |
| New head sha | reported, full |
| Branch name | must not be confusable with the RC or with `staging`/`main` |
| `git diff --name-status a42b209e <head>` | **exactly three paths**, listed |
| Line delta | expected `+36 / −7` — confirm or report the difference |
| Files vs `main` | expected **138 — unchanged**. Verify by **per-item comparison**, not by the count matching. Rule 5 applies here more than anywhere: a 138 that matches by coincidence is the exact trap A16 documented |
| Lines vs `main` | expected `+9,096 / −1,300` |
| Commits vs `main` | A-4 projected `40 · 38` as **INFERRED**. It is now measurable. Report the measured value and reclassify |
| `staging` and `main` | confirm both unmoved, with their shas |

### 3d. Verify the patched result, do not assume it

Applying a patch cleanly is not evidence the defect is fixed. **Show the construct is gone**: quote the unescaped construct as it stands at `a42b209e`, and quote the same lines on the new branch. Both, side by side, per file.

Rule 1's family, applied to a fix rather than a test: **a fix never shown to remove the defect is not a fix.**

### 3e. What the auditor receives

Per C-25, the replacement RC costs the auditor a three-file, 43-line delta, not a re-review. **Produce that delta as a standalone artefact with its own hash**, so it can be sent without the pack.

---

## 4. What this does not change

**The merge remains blocked, and for the same reason as this morning.** The patches close the injection construct. They do not touch the environment configuration, and the environment configuration is the other half:

after a merge, a `workflow_dispatch` on `main` with `target=production` reaches `SUPABASE_DB_URL` — **required reviewers off, wait timer off, administrator bypass on** — and that control lives in the GitHub UI, outside the 138 files (F-36).

**A clean patch set does not make the release ready. It closes one of nine gates partway.**

---

## 5. Completion

Unchanged at **2.65 / 9 ≈ 29%** until the return is measured. G1 moves 0.5 → 0.75 when the branch exists, the three-file delta is confirmed per item, and the construct is shown removed on both files.

Still blocked, and on whom:
- **the drift join** — Developer 2, once Developer 1 publishes the TSV to an exact project path
- **the 138-file review, the four §25.3 rows, the A15 decision** — the independent auditor, and the 138-file review has not started on any side
- **`ANDROID_*` secret scoping** — owner, post-promotion list
- **§5.3 probe, §11 signature, tag, merge** — last, in that order
