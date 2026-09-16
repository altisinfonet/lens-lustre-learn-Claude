# Work Order WO-13 — Developer 2

Issued 2026-08-31 by the compiler/audit session.
Repository state: `main` `b671e1fb0c5bcf145d442076c229eca888afd674` · candidate `a42b209e4f70a6efed4f3dcdb654e0f994416594` · ledger `f00f612a…5943`. No commit, tag, push, merge, deployment, migration or provider write has occurred.

**Standing constraints, unchanged and absolute.** Do not expose secrets, tokens, cookies or credentials. Do not perform unsafe production writes. Do not execute financial transactions. Do not create a branch, commit, push, merge, tag, deploy or migrate. Do not modify any existing file. Do not edit `docs/PROMOTION_LEDGER.md`. **All database access is read-only.** Report names, counts, versions and configuration only — never a credential value.

---

## Why these three, and why you

The independent auditor has ruled that §26 blocker 9 does **not** close on the eight §25.3 rows alone: the **138-file review** and the **independent test-suite re-run** are required and are not waivable as residual risks.

Two of the three tasks below have **never been performed by anyone**. The third is half the critical path. Developer 1 holds the workflows, the replacement RC branch and the pack; you hold an independently built clone and your own toolchain. **§25.7.2 item 3 says the suite must be re-run *independently* — that word is why this is yours and not Developer 1's.**

---

## TASK 1 — the independent test-suite re-run. **Highest priority.**

§25.7.2 item 3: *"The test suite, re-run independently — no party has re-run it."*

### 1a. Prove the checkout before running anything

There is a recorded prior defect here: an earlier report stated the suite ran at `a42b209e` when it had actually run at `9ac4524d`. **Identity is proved, not asserted.**

Report, before any test output:

```
git rev-parse HEAD
git status --porcelain          # must be empty
git rev-parse --abbrev-ref HEAD
sha256sum package-lock.json     # or the lockfile in use
node --version ; npm --version
```

**Run at `a42b209e`** — the frozen candidate. The replacement RC branch is local to Developer 1's container and unpushed, so you cannot reach it. **State plainly in your report that this run is bound to `a42b209e` and that a re-run is required if the replacement RC is adopted.** Do not imply it covers a head you did not test.

### 1b. Full transcript, not a summary

Exact command · full dependency-install output · **per-test output, not the totals line** · exit code. A two-line "2,475 passed" is the thing the auditor explicitly rejected.

### 1c. Enumerate every skipped test — this is the trap

A known defect: `src/test/judging-invariants.test.ts` requires a live service-role client and **self-skips into a green summary**. A pass total that includes silent skips hides an unverified invariant.

**Report the explicit list of every skipped, pending or conditionally-excluded test**, with the reason each one skipped. If your runner does not surface skips by default, make it. **A green run with unenumerated skips is not evidence.**

### 1d. Prove the suite can fail — rule 1, applied to the suite itself

*A suite never shown to detect a planted defect is not evidence about that class.*

**2,475 passing tests prove nothing until the suite is shown to fail when the code is wrong.** Plant at least **three** defects, in copies, in three different areas the suite claims to cover. Show for each: the defect, the test that caught it, and the failure output. Then restore and re-run clean.

State plainly what class of defect this suite would **not** catch.

**Do not report a result until 1d is done.** The green run and the planted-defect proof ship together or not at all.

---

## TASK 2 — §25.3 rows 1, 2 and 3. **Never captured by anyone. Read-only.**

§25.4 defines exactly what each needs. Measure first, report the measured value, and only then compare it to the ledger's claim — stated below so the auditor can see both.

| Row | What to measure | The ledger's claim |
|---|---|---|
| **1** | `pg_policies` on `ad_creative_comments`, **production** lane | **7** rows pre-migration |
| **2** | the same query, **staging** lane | **9** |
| **3** | `submit-judge-decision` — deployed **version** and the **ACAO value** it actually serves | v23, serving `Access-Control-Allow-Origin: *` |

**Read-only.** No migration, no policy change, no function deploy, no write of any kind. Report the exact query, the connection identity (project ref, role class — **not the credential**), the raw result, and the as-of time in UTC.

**Closure note, so nothing is over-claimed:** §25.4 accepts either *(a)* a check by an auditor holding read-only access, or *(b)* **an export the auditor can independently validate.** Your capture is route (b) **only if it is a validatable artefact** — a CI job whose logs the auditor reads, or a signed/timestamped export. **A value pasted into a chat is explicitly not an export.** Produce it as a file with its own sha256, and say which route you are claiming.

---

## TASK 3 — the `src/` half of the 138-file claims document

Developer 1 is building the claims document the auditor asked for. **138 files is too much for one session and it is the critical path.**

**Split by risk class, not by count:**

- **Developer 1:** the 44 files under `supabase/functions/`, the workflow files, config, and the three patched paths — the security-bearing set.
- **You:** the **29 files under `src/components/`** and the remaining `src/` and non-security files.

**Adopt Developer 1's schema exactly.** Do not invent your own columns. Ask them for the header row and the three specimen rows before you write a single line; if the two halves do not join cleanly the auditor gets two documents instead of one, which is worse than one half-finished.

Every row asserts something **checkable against source** — not a description. Each row states which half produced it. **Mark every row as a claim, never as a finding**; the auditor verifies against source, and a claims document that pre-judges the verification is worthless to them.

---

## Reporting

One report per task, delivered as each finishes — do not batch. Every row: `Requirement → Instrument → Evidence → Result → Status`, classified **VERIFIED / OWNER-ATTESTED / INFERRED / BLOCKED / N/A / DEFERRED**. Anything not personally run is **RELAYED**.

**Stamp every negative with its as-of time** (rule 13). "No skipped tests", "no policy differences", "0 remote refs" without a timestamp is not a measurement.

If something blocks you, mark it **BLOCKED**, state exactly what access you lack, and continue with the rest. Do not stop the order on one blocker.

---

## Priority

**1 → 2 → 3.** Task 1 is a required deliverable the auditor is waiting on. Task 2 unblocks three of the eight §25.3 rows that no party has touched. Task 3 halves the critical path but only helps once Developer 1's schema exists — so start it only after asking for that schema.
