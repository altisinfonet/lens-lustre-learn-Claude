# CHANGE LEDGER — RC-20260826-01 — **CLOSED**

**Closed 2026-08-27 on the owner's ruling. Candidate tree `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`.**

| ID | Change | Class | Terminal state |
|---|---|---|---|
| CHG-G10-001 | PR #102 → `staging`, 9 files | INTENDED | APPLIED & VERIFIED |
| CHG-G10-002 | Staging ACL remediation, 252 statements, 76 signatures | INTENDED | APPLIED & VERIFIED — fingerprint `ab26c06a…` identical on both lanes |
| CHG-G10-003 | PR #103 — arm production-lane isolation host rules, 3 files | INTENDED | **PREPARED — PENDING PROMOTION** (AF-14 Option B) |
| CHG-G10-004 | Flow 6 friendship row +1 (staging) | INTENDED | RETAINED as QA evidence |
| **CHG-G10-005** | **Story row +1 (staging)** | **RECLASSIFIED → TEST/HARNESS** | **WAIVED — see ruling below** |
| CHG-G10-006 | Flow 1 test post +1 (staging) | INTENDED | RETAINED as QA evidence |
| CHG-G10-007 | Flow 5 reaction +1 (staging) | INTENDED | RETAINED |
| CHG-G10-008 | Flow 4 comment +1 (staging) | INTENDED | RETAINED |
| CHG-G10-009 | Notification fan-out +513 (staging) | INTENDED consequence of CHG-006 | RETAINED |

**No production row was written at any point.** All RLS write tests ran inside rolled-back transactions
and left zero residue. Production verified unchanged by its own §8.10 instrument at 07:38:38Z and again
at 12:02Z — all seven must-never-move fingerprints identical, zero drift in the drift counters.

---

## RULING ON CHG-G10-005 — owner, 2026-08-27

> **§9.4 defines UNINTENDED as "any difference between `main` and the RC."** The Story row is a staging
> database artefact created during QA. It is **not** a difference between `main` and the release
> candidate — it is not in the tree, not in any commit, and not in production. It therefore does not meet
> §9.4's definition of UNINTENDED.
>
> **CHG-G10-005 is reclassified TEST/HARNESS and waived.** The row remains in the staging database.
>
> This is a definitional correction, not a waiver of substance. The entry is **not** deleted from the
> ledger, and the circumstances of its creation remain recorded in full.

**Disclosure retained, verbatim:** the row was created when a QA file-upload test landed in the page's
Story input rather than the intended composer input — the composer's file input is the *second* one on
that page. It was detected from the "Story added!" toast, confirmed in the database, and disclosed
immediately rather than hidden. `stories` rows = 1 · `expires_at` = 2026-08-28T05:19:25Z · expiry function
in `public` = 0 · cron jobs referencing `stories` = 0. **`expires_at` governs display filtering only;
there is no reaper, so the row persists until deleted.**

**Carried to G11:** the duplicate-file-input hazard on that page, which allowed a test upload to reach the
Story composer without the operator intending it.

---

## §11 PREREQUISITE 2 — SATISFIED

> *"Change Ledger closed, none UNINTENDED."*

**Nine entries. Zero UNINTENDED. Ledger CLOSED.**

Signed: ______________________  Date: ____________

---

*Signature required to make this closure effective. This session does not sign on the owner's behalf.*
