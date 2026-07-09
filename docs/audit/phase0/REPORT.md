# Phase 0 — Forensic Baseline Report
**Authored by Claude only.**  Snapshot UTC: 2026-04-30T13:30:00Z  Source: live Lovable Cloud DB (project `isywidnfnjhtydmdfgtk`).
This is a **READ-ONLY** snapshot. No DB row, no code line, no edge fn was modified during Phase 0.

---

## 1. Current DB truth

### 1.1 `competition_entries.progression_decision` — DISTINCT values
| value          | row_count |
|----------------|-----------|
| `shortlisted`  | 1         |

> **Finding F-1 (CRITICAL):** The single value `shortlisted` is **NOT in the locked 14-key vocabulary**. It is a legacy short-form. Phase 2 backfill must rewrite this row.

### 1.2 `judging_tags` — all rows
18 tag rows. Active rows shown below; `is_active=false` rows kept for audit trail.

| tag_id (short) | label                       | round | is_system | is_active |
|----------------|-----------------------------|-------|-----------|-----------|
| 4f1805d5…      | Accept                      | 1     | true      | true      |
| 0034f2e3…      | Needs Review                | 1     | true      | true      |
| 4b440411…      | Reject                      | 1     | true      | true      |
| 13f2d1bd…      | Shortlist for R2            | 1     | true      | true      |
| bce0e662…      | Not Selected for R3         | 2     | true      | **false** |
| 67d446d4…      | Qualified for R3            | 2     | true      | true      |
| e2b179a8…      | Stayed at R2                | 2     | true      | **false** |
| 15012bbe…      | Not Selected for Final      | 3     | true      | **false** |
| df11381a…      | Shortlisted for Final       | 3     | true      | true      |
| 37c160fd…      | Stayed at R3                | 3     | true      | **false** |
| b5281733…      | 1st Runner-Up               | 4     | false     | true      |
| f01c2ccb…      | 2nd Runner-Up               | 4     | false     | true      |
| cfd7d5af…      | Honorary Mention            | 4     | false     | true      |
| fa292f24…      | Qualified for Final         | 4     | false     | true      |
| ddf5b7bb…      | Special Jury                | 4     | false     | true      |
| 249926a9…      | Top 100                     | 4     | false     | true      |
| 0d734146…      | Top 50                      | 4     | false     | true      |
| 49c0c69f…      | Winner                      | 4     | false     | true      |

> **Finding F-2:** `judging_tags` labels are **already aligned to the locked vocab** for awards (Top 50, Top 100, Honorary Mention, Special Jury, Winner, 1st/2nd Runner-Up, Qualified for Final). No tag-label rename is required in `judging_tags`. The renames are isolated to `v3_stage_catalog`.
>
> **Finding F-3:** R2 tag "Stayed at R2" and R3 tag "Stayed at R3" are already inactive. Locked doc has no "Stayed" key — confirms binary-only intent. **No action.**
>
> **Finding F-4:** R2 "Not Selected for R3" and R3 "Not Selected for Final" tags are **inactive** even though the locked vocab requires `r2_not_selected_r3` and `r3_not_selected_final` as live binary-fail keys. Phase 2 must **re-activate** these two tags or rely solely on `v3_stage_catalog` for the fail state. **Open question for Phase 1 sign-off.**

### 1.3 `judge_decisions.decision` — DISTINCT values per round
| round | decision         | row_count |
|-------|------------------|-----------|
| 1     | shortlist        | 16        |
| 1     | reject           | 3         |
| 1     | accept           | 1         |
| 2     | qualified_r3     | 15        |

> **Finding F-5:** R1 vocabulary in `judge_decisions` is `accept` / `reject` / `shortlist` (token form). R2 is `qualified_r3`. These are **decision tokens**, NOT stage_keys. They map cleanly to the locked vocab via `v3_stage_catalog.decision_token`. No rename required at this layer.
>
> **Finding F-6:** R3 / R4 have **zero rows** in `judge_decisions` today. Phase 4 aggregation function will be tested only against the R1 + R2 path on the live entry; R3/R4 paths remain untested in production.

### 1.4 `v3_stage_catalog` — current state (19 active rows)
Full dump matches the table baked into `src/lib/judging/stageCatalog.ts`. Confirmed verbatim against the file (Phase 0 step 0.4 grep). Diff vs locked 14 keys:

| present today           | locked vocab? | action in Phase 2 |
|-------------------------|---------------|-------------------|
| `r1_accept`             | NO            | DELETE (soft) → backfill to `r1_accepted` |
| `r1_accept_short`       | NO            | DELETE (soft)     |
| `r1_needs_review`       | YES           | KEEP              |
| `r1_reject`             | NO            | DELETE → backfill to `r1_rejected` |
| `r1_reject_short`       | NO            | DELETE            |
| `r1_shortlist_for_r2`   | NO            | RENAME → `r1_shortlisted_for_r2` |
| `r2_not_selected_r3`    | YES           | KEEP              |
| `r2_qualified_r3`       | YES           | KEEP              |
| `r2_qualified_r3_short` | NO            | DELETE            |
| `r3_not_selected_final` | YES           | KEEP              |
| `r3_shortlisted_final`  | NO            | RENAME → `r3_qualified_final` |
| `r4_best_moment`        | NO            | DELETE            |
| `r4_honorary_mention`   | NO            | RENAME → `r4_honorary` |
| `r4_runner_up_1`        | YES           | KEEP              |
| `r4_runner_up_2`        | YES           | KEEP              |
| `r4_special_jury`       | YES           | KEEP              |
| `r4_top_100`            | YES           | KEEP              |
| `r4_top_50`             | YES           | KEEP              |
| `r4_winner`             | YES           | KEEP              |
| `r1_accepted`           | (missing)     | ADD               |
| `r1_rejected`           | (missing)     | ADD               |
| `r4_qualified_final`    | (missing)     | ADD               |

**Net: 19 active → 14 active (5 soft-deleted, 3 renamed in place, 3 added).**

---

## 2. Duplicate count

| Pair                                              | DB rows  | Code refs (TBD Phase 1) |
|---------------------------------------------------|----------|--------------------------|
| `r1_accept` (in catalog) vs `r1_accepted` (locked)| 1 vs 0   | TBD                      |
| `r1_reject` (in catalog) vs `r1_rejected` (locked)| 1 vs 0   | TBD                      |
| `r2_qualified_r3` vs `r2_qualified_for_r3`        | 1 vs 0   | TBD                      |
| `r3_shortlisted_for_final` (locked-removed)       | 0 in DB  | TBD in src/              |
| `r3_shortlisted_final` (current catalog row)      | 1        | TBD                      |
| Short-suffix dupes (`*_short`)                    | 3 rows   | n/a                      |

> **Finding F-7:** No `competition_entries.progression_decision` row currently holds any of the duplicate keys (only `shortlisted`). So Phase 2 backfill UPDATE on `competition_entries` is **single-row** — minimal data risk.

---

## 3. Sample entries (10 requested — only 1 exists)

| entry_id            | competition | status            | progression_decision | current_round | n_photos | photos_decided | total_decisions |
|---------------------|-------------|-------------------|----------------------|---------------|----------|----------------|------------------|
| 6ecd09a9…3630e      | 813237c4…   | round2_qualified  | `shortlisted`        | 3             | 20       | 20             | 35               |

> **Finding F-8 (CRITICAL):** The DB contains exactly **one** competition entry. The "10 sample entries across R1–R4" requested by Phase 0 step 3 cannot be produced because the data does not exist. Per Mandate Rule 2 (No Guesswork), this is reported as-is. **User must approve whether Phase 8 end-to-end validation will use synthetic test data or wait for live entries.**

### 3.1 Per-photo decision spread for the only entry
- 20 photos total, all 20 have R1 decisions, 14 have R2 decisions.
- R1 mix: 1 `accept`, 16 `shortlist`, 3 `reject`.
- R2 mix: 14 `qualified_r3`, 0 `not_selected_r3`.
- Photos pending R2 decision: **6 of 20** (photo_index 1, 2, 10, 11, 12 missing from R2 set).

> **Finding F-9 (CRITICAL — confirms locked-doc Section 5):** Per the locked Pending Rule, this entry **should not display any R2 result to the participant** because 6 photos are still pending R2 decisions. Today the entry shows `progression_decision='shortlisted'` and `status='round2_qualified'` — i.e. **the system already leaks a partial R2 result while photos are pending**. This is the primary defect Phase 3 + Phase 4 + Phase 7 will fix.

---

## 4. Pending condition check

Definition used (per locked Section 5): "any photo has no decision for the entry's current round".

Active competition is in `current_round=3`. Strict reading: pending = any photo with no R3 decision. R3 has 0 decisions DB-wide → **20 of 20 photos pending R3** → entry must show NOTHING per locked rule.

Looser reading (last completed round = R2, since R3 hasn't started): 6 of 20 photos pending R2 → entry must still hide R2 result.

Either way, the displayed result `shortlisted` violates the locked Pending Rule.

---

## 5. Forensic audit checklist (Mandate evidence)

| # | Check | Evidence |
|---|-------|----------|
| A1 | Touched only files listed in plan? | YES — only `docs/audit/phase0/REPORT.md` was created. Zero src/ or DB writes. |
| A2 | Diffs captured? | N/A — read-only phase. |
| A3 | Every claim cited? | YES — every finding cites a SQL result above. |
| A4 | Negative tests run? | N/A — Phase 0 has none. |
| A5 | "Authored by Claude only" header? | YES (line 2). |
| A6 | User notified before Phase 1? | YES — this report awaits explicit approval before Phase 1. |

---

## 6. Phase 0 exit gate — status

- [x] Live DB snapshot captured (4 SQL dumps above).
- [x] Code-vs-DB diff captured (Section 1.4 table).
- [x] Pending condition documented (Section 4).
- [ ] **AWAITING USER ACKNOWLEDGEMENT** — reply `phase 0 ok` to unlock Phase 1.

---

## 7. Open questions raised by Phase 0 (must be answered before Phase 1)

1. **Q-0.1:** The DB has only 1 entry. May Phase 8 validation use **synthetic seeded entries**, or do we wait for production data? *(Mandate Rule 2 forbids guessing.)*
2. **Q-0.2:** Tags `Not Selected for R3` and `Not Selected for Final` are currently `is_active=false` in `judging_tags`. The locked vocab requires their stage_keys (`r2_not_selected_r3`, `r3_not_selected_final`) to be live. Should Phase 2 **re-activate** these `judging_tags` rows, or keep them inactive (relying on `v3_stage_catalog` only for the fail bucket)?
3. **Q-0.3:** R3 and R4 paths have **zero production rows**. Phase 8 cannot validate them against real data. Acceptable to validate via synthetic seeds + edge-fn negative tests only? *(Re-asks Q-0.1 specifically for R3/R4.)*
