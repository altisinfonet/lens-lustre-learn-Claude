# G10 — PHASE 7 READINESS CHECKLIST

**2026-08-27. Owner rulings recorded. No QA widened. T unchanged, `main` unchanged, PR #103 unmerged.**

---

## OWNER RULINGS RECORDED THIS TURN

| Ref | Ruling |
|---|---|
| **AF-14** | **OPTION B** — CHG-G10-003 recorded as **`PREPARED — PENDING PROMOTION`**; ledger closes without merging PR #103 or changing `main` |
| **B8 / D-2** | **ACCEPT AS DOCUMENTED DEVIATION** for RC-20260826-01; 9-file rename deferred to G11 |
| **B10 / §8.9** | **NOT APPLICABLE** — web-only RC, no Android artifact produced. **AF-13** (four contradictory version records) logged for G11 |
| **B14 / AF-03** | **OPTION D** — accepted as staging-fidelity deviation **D-5**. Zero mutation; `af03_keys_still_present = 6` |
| **B6** | Unsafe N1 configuration **withdrawn**. Only the branch/target substitute + N2 authorised |

---

## ⚠ CORRECTION TO A PRIOR STATEMENT — CHG-G10-005 DOES NOT SELF-RESOLVE

I previously wrote that the unintended Story "auto-expires within 24 h". **That was wrong about the
database row.** Measured:

| Check | Result |
|---|---|
| `stories` rows | **1** |
| `expires_at` | 2026-08-28 05:19:25 UTC |
| Expiry function in `public` | **0** |
| Cron job referencing `stories` | **0** |

`expires_at` governs **display filtering only**. There is no reaper. **The row persists in staging
indefinitely until deleted.** Since §11 requires a closed ledger with **none UNINTENDED**, CHG-G10-005
is a live Phase 7 blocker and must be either **purged** (a staging write — currently blocked by B20) or
**explicitly waived in writing**.

---

## §11 PREREQUISITES — STATE BY STATE

| # | §11 requirement | State | What is missing |
|---|---|---|---|
| **1** | §15 matrix complete — **no row blank, no row marked "expected"** | 🟡 **no row blank**, but 1 FAILING + 6 PARTIAL | Owner scoping ruling (below) |
| **2** | Change Ledger **closed**, **none UNINTENDED** | 🟡 ruling given; text drafted | **Signature** + **CHG-005 disposition** |
| **3** | No §14 hard stop live | 🟡 HS-10 CLOSED | **B13 countersignature** |
| **4** | §10 RC record complete — every field, or N/A **with reason** | 🟡 3 fields open | **B11 signature · D-3 ruling · B5/B6/B7 dispositions** |
| **5** | Approval **names the tree**, not a branch | ⬜ procedural | Use `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` |
| **6** | Signed and dated **before** any merge | ⬜ procedural | Sign before Phase 8 |

---

## THE §15 SCOPING RULING (prerequisite 1) — THE LARGEST REMAINING ITEM

No row is blank, so the literal §11 wording is satisfiable — but **one row is FAILING and six are
PARTIAL**, and three of them have **no instrument that exists in this environment**. Approving over them
silently is exactly what this gate forbids. Each needs an explicit disposition:

| Row | State | Required owner disposition |
|---|---|---|
| **1 · UI** | 🔴 **FAILING** — assets resolve to `cdn.50mmretina.com` on 29 routes | **Accept under deviation D-5** (already ruled Option D) — must be stated as *approving over a known-failing row*, not as a pass |
| **3 · Auth** | 🟡 `/login`+`/signup` untestable while a session exists; password reset has no mail path | **N/A with reasoning**, or defer to G11 |
| **5 · Storage** | 🟡 upload chain VERIFIED; production object count and raw R2 write-refusal need B5 | **N/A with reasoning** (no object-level tooling), or hold for B5 |
| **6 · Edge Functions** | 🟡 **5/74** invoked; ~28 need writes; **5 are policy-excluded financial**; 9 cron; 8 email | **Scope the criterion to functions reachable by the ten §15 flows**, and record the 5 financial as **NOT TESTABLE — POLICY EXCLUSION** |
| **10 · Responsive** | 🟡 `server.url` VERIFIED; **breakpoints have no working instrument** | **N/A with reasoning**, or defer to G11 |
| **11 · Regression** | 🟡 §18 is post-promotion by design | **Record as Phase 8/§18 dependency** — structurally cannot close at Phase 7 |
| **12 · Cross-lane** | 🟡 N3–N8 VERIFIED; **N1/N2 need run evidence** | **B6 dispatches** |

Rows **4, 7, 9** are VERIFIED and need nothing. Row **2** is 7/10 with 2 blocked on B20 and 1
structurally untestable (0 journal articles) — needs the same explicit disposition as row 6.

---

## CHANGE LEDGER — CLOSURE STATEMENT (drafted for signature)

> **CHANGE LEDGER — RC-20260826-01 — CLOSED.**
>
> | ID | Change | Class | Terminal state |
> |---|---|---|---|
> | CHG-G10-001 | PR #102 → `staging`, 9 files | INTENDED | APPLIED & VERIFIED |
> | CHG-G10-002 | Staging ACL remediation, 252 statements, 76 signatures | INTENDED | APPLIED & VERIFIED (fingerprint `ab26c06a…` identical both lanes) |
> | CHG-G10-003 | PR #103 — arm production-lane isolation host rules, 3 files | INTENDED | **PREPARED — PENDING PROMOTION** (AF-14 Option B) |
> | CHG-G10-004 | Flow 6 friendship row +1 | INTENDED | RETAINED as QA evidence |
> | CHG-G10-005 | Story row +1 | **UNINTENDED** | ☐ PURGED ☐ WAIVED — **must be ticked** |
> | CHG-G10-006 | Flow 1 test post +1 | INTENDED | RETAINED as QA evidence |
> | CHG-G10-007 | Flow 5 reaction +1 | INTENDED | RETAINED |
> | CHG-G10-008 | Flow 4 comment +1 | INTENDED | RETAINED |
> | CHG-G10-009 | Notification fan-out +513 | INTENDED consequence of CHG-006 | RETAINED |
>
> No production row was written at any point. All RLS write tests were executed inside rolled-back
> transactions and left zero residue. CHG-G10-005 is the only UNINTENDED entry and its disposition is
> recorded above.
>
> Signed: ______________________  Date: ____________

**The ledger is not closed until that signature exists and the CHG-005 box is ticked.** I have drafted
it; I have not closed it, and I will not sign on the owner's behalf.

---

## RC RECORD — REMAINING OPEN FIELDS

| §10 field | Disposition needed |
|---|---|
| Staging Pages deployment ID (**D-3**) | Previews are disabled (`Preview branch: None`), so no deployment exists for T. **Rule N/A with reasoning**, or identify the `lens-lustre-learn-claude-staging` deployment |
| Database rollback component (**B11**) | **Signature** on the five-file binding (drafted) |
| §5.3 secret-isolation re-test (**B7**) | §5.3.6 requires it **immediately before promotion** → **record as a Phase 8 pre-merge gate**, not a Phase 7 field |
| 4.7b R2 bidirectional write refusal (**B5**) | **N/A with reasoning**, or hold Phase 7 for it |
| N1 / N2 (**B6**) | Two run IDs + literal refusal text |
| Android versionCode | ✅ **N/A ruled this turn** |
| AF-03 / D-5 | ✅ **Option D ruled**; deviation text drafted |
| D-2 | ✅ **Accepted as documented deviation**; rename deferred to G11 |

---

*T = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca` · `main` = `b671e1f` · PR #103 unmerged ·
production unwritten · AF-03 unapplied · **RC NOT APPROVED**.*
