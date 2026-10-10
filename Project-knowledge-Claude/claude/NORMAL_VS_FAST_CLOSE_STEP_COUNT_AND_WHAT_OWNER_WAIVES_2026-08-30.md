# Normal close vs fast close — step count, and exactly what the owner gives up

Date: 2026-08-30
Purpose: the record of what was understood before the deviation was signed. An auditor will later ask "did the owner know what he was waiving?" — this document is the answer.

---

## 1. Step count

### NORMAL CLOSE — 15 steps, all before the merge

| # | Step | Who |
|---|---|---|
| 1 | Answer WO-8 B1, B2 (sets the fix file count) | developer |
| 2 | Build the Option 2 patches | developer |
| 3 | Cut the replacement RC branch and apply | developer |
| 4 | Repair the lexer (A9) and prove it with a planted defect (A10) | developer |
| 5 | Re-run closure across all 71; republish drift totals | developer |
| 6 | Apostrophe blast-radius census (A8) + instrument lineage (A11) | developer |
| 7 | Silent-field sweep (A12) | developer |
| 8 | Re-run credential scrub with full run conditions (A5) | developer |
| 9 | Answer WO-8 B3, B4 | developer |
| 10 | Unblock §25.3 rows 1.4, 1.5, 1.6b, 1.6c — **four separate items** | developer + auditor |
| 11 | Rebuild pack as rev7 (Group D) | developer |
| 12 | Auditor closes the 138-file review, the independent test run, the 71-function re-measurement, and all eight §25.3 rows | **auditor** |
| 13 | Run the §5.3 probe | owner |
| 14 | §11 signature | owner + auditor |
| 15 | Tag, then merge | owner |

**All 15 sit in front of the merge. Every one is serial.**

### FAST CLOSE — 8 steps on the critical path

| # | Step | Who |
|---|---|---|
| 1 | Answer B1, B2 | developer |
| 2 | Build the Option 2 patches | developer |
| 3 | Cut the replacement RC branch and apply | developer |
| 4 | Build the delta pack — changed files only | developer |
| 5 | Auditor closes the 138-file review on the delta, and rules which §25.3 rows are merge-bearing | **auditor** |
| 6 | Run the §5.3 probe | owner |
| 7 | §11 signature, **with the deviation recorded** | owner + auditor |
| 8 | Tag, then merge | owner |

**Seven steps move to after the merge.** They are not cancelled. They are not reduced in standard. They run on their own track and finish later.

**15 → 8.**

---

## 2. What the owner loses — the honest list

### Loss 1 — a clean promotion record, permanently

The ledger will read *"promoted under recorded deviation D-1"* instead of *"all gates green."* That entry does not expire. Anyone reading the promotion history in two years sees it. This is the price of the shortcut and it is paid once, forever.

### Loss 2 — the auditor can refuse

The whole fast close rests on one reading: B13 condition 2 excludes edge-function deployment, therefore deployed-state evidence is not merge-bearing. **If the independent auditor rejects that reading, the fast close collapses back to 15 steps** — and a refused deviation is now also on the record. This is a real risk, not a theoretical one, and the owner carries it.

### Loss 3 — no known-good baseline at the moment of promotion

The drift totals are currently **INFERRED**, because the instrument that produced them has a lexer defect. Fast close crosses the release line **without knowing** whether the deployed functions match what we believe they are.

This does not make the merge unsafe — the merge deploys nothing. But it means that if production misbehaves in the following weeks, there is **no clean snapshot from promotion day to compare against.** Normal close would have given one. That diagnostic asset is lost and cannot be recreated after the fact.

### Loss 4 — crossing the line with C-14-L open

`assertStorageLane` is in **zero of 71 deployed bundles**. Production has no storage-lane guard. Fast close does not make this worse — it is already true today — but the release goes out with it knowingly open, and the record will say so.

### Loss 5 — accountability moves onto the owner's signature

This is the one that matters most and is easiest to miss.

With a clean close, if something later goes wrong in a gated area, the process is what failed. With a recorded deviation, **anything that goes wrong inside the deviated scope lands on the owner's signature**, because the owner is the person who ruled it non-blocking. That is what signing a deviation means.

### Loss 6 — the deferred work needs will to finish

Seven steps move to after the merge. In practice, work deferred past a release often does not get done, because the pressure that funded it is gone. Fast close converts *"blocked work"* into *"work that requires the owner to keep pushing."* If that push does not come, the evidence chapter simply never closes — and the reason will be the deviation, not the defects.

---

## 3. What the owner does **not** lose

- **No safety.** The shell-injection fix happens in both paths, before the merge, without exception. The merge is exactly as safe either way.
- **No evidence.** Nothing is deleted, cancelled or downgraded. The evidence track continues at full standard.
- **No standard.** A recorded deviation names the gate, states why it does not apply, and is signed. A bypass hides the gate. This is the first thing, not the second.
- **No auditor independence.** The auditor still countersigns, and can still refuse.

---

## 4. The decision, stated in one line

**Normal close** buys a clean record and a known-good baseline, and costs roughly two to three more weeks and 7 extra serial steps.

**Fast close** buys those weeks back, and costs a permanent deviation on the record, no promotion-day baseline, and personal accountability for the deviated scope.

Both are legitimate. Neither is a bypass. **Only the owner can choose**, and the choice should be made knowing all six losses above, not just the step count.
