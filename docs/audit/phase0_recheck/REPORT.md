# Phase 0 Recheck — Forensic Baseline (READ-ONLY)
Run UTC: 2026-04-30T13:33Z
Mandate: No Assumptions · No Guesswork · No Part Checking · No Casual Approach · Claude Only
Raw SQL output: `docs/audit/phase0_recheck/raw.txt`

---

## 1. DB Truth (verbatim)

### 1A. `v3_stage_catalog` — 19 rows, all `is_active=true`
```
r1_accept             | 1 | t          r2_not_selected_r3    | 2 | t
r1_accept_short       | 1 | t          r2_qualified_r3       | 2 | t
r1_needs_review       | 1 | t          r2_qualified_r3_short | 2 | t
r1_reject             | 1 | t          r3_not_selected_final | 3 | t
r1_reject_short       | 1 | t          r3_shortlisted_final  | 3 | t
r1_shortlist_for_r2   | 1 | t          r4_best_moment        | 4 | t
                                       r4_honorary_mention   | 4 | t
                                       r4_runner_up_1        | 4 | t
                                       r4_runner_up_2        | 4 | t
                                       r4_special_jury       | 4 | t
                                       r4_top_100            | 4 | t
                                       r4_top_50             | 4 | t
                                       r4_winner             | 4 | t
```

### 1B. `competition_entries.progression_decision`
```
shortlisted | 1
```
Only one entry exists in the table; its value is the **legacy** `shortlisted` (NOT in the locked 14-key whitelist).

### 1C. `judging_tags` (18 rows; column is `id`, not `tag_id`)
| label | active | round |
|---|---|---|
| Accept | ✅ | 1 |
| Needs Review | ✅ | 1 |
| Reject | ✅ | 1 |
| Shortlist for R2 | ✅ | 1 |
| Not Selected for R3 | ❌ | 2 |
| Qualified for R3 | ✅ | 2 |
| Stayed at R2 | ❌ | 2 |
| Not Selected for Final | ❌ | 3 |
| Shortlisted for Final | ✅ | 3 |
| Stayed at R3 | ❌ | 3 |
| 1st Runner-Up, 2nd Runner-Up, Honorary Mention, Qualified for Final, Special Jury, Top 100, Top 50, Winner | ✅ | 4 |

### 1D. `judge_decisions.decision` (production rows)
```
shortlist    | 16
qualified_r3 | 15
reject       |  3
accept       |  1
```
Allowed by CHECK constraint (16 values): `accept, reject, shortlist, needs_review, qualified, finalist, winner, skip, qualified_r3, not_selected_r3, shortlisted_final, not_selected_final, runner_up_1, runner_up_2, honorary_mention, special_jury`.

---

## 2. Vocabulary counts
- `v3_stage_catalog`: **19 active / 0 inactive** (19 total)
- Locked plan target: **14 keys** active
- **Delta: 9 keys present that are NOT in the locked 14** — see §3.

---

## 3. Duplicate / legacy presence in `v3_stage_catalog`
| Present key | Locked key it duplicates / replaces | Action per plan |
|---|---|---|
| `r1_accept` | `r1_accepted` | Soft-delete |
| `r1_reject` | `r1_rejected` | Soft-delete |
| `r1_shortlist_for_r2` | `r1_shortlisted_for_r2` | Soft-delete (rename to past-tense) |
| `r1_accept_short` | (redundant) | Soft-delete |
| `r1_reject_short` | (redundant) | Soft-delete |
| `r2_qualified_r3_short` | (redundant) | Soft-delete |
| `r3_shortlisted_final` | `r3_qualified_final` | Soft-delete |
| `r4_best_moment` | (not in locked set) | Soft-delete |
| `r2_qualified_r3` | ✅ kept | — |

**Missing from catalog** (must be ADDED in Phase 2):
`r1_accepted`, `r1_rejected`, `r1_shortlisted_for_r2`, `r3_qualified_final`, `r4_qualified_final`.

`progression_decision` legacy value found: **`shortlisted`** (1 row) — needs migration to `r1_shortlisted_for_r2` in Phase 2.

`judge_decisions.decision` legacy values present in data: `shortlist` (16), `accept` (1), `reject` (3) — these remain valid at the **photo-grain** layer per locked plan (judge_decisions stay as-is; only entry-level vocabulary tightens).

---

## 4. Sample dump (entries)

Database contains **only 1 entry total**. Multi-photo, currently at R3.

```
entry_id              : 6ecd09a9-ce9b-48ae-960d-a497ffa3630e
competition_id        : 813237c4-2cbf-4ca1-b051-9e5c59fa9723
current_round         : 3
progression_decision  : shortlisted    ← LEGACY KEY (not in 14-key whitelist)
status                : round2_qualified
photo_count           : 20
decision_rows total   : 35  (R1=20, R2=15)
```

Per-photo breakdown:
- **R1 (20/20 photos decided)**: 16×`shortlist`, 1×`accept`, 3×`reject`
- **R2 (15/20 photos decided)**: 15×`qualified_r3`, **5 photos pending**
- **R3**: 0 decisions yet
- **R4**: 0 decisions, 0 entries

---

## 5. PENDING audit (locked-plan rule: any pending photo ⇒ entry result MUST be hidden / NULL)

Current-round = R3 ⇒ 0 of 20 photos decided in R3 ⇒ **20 photos pending**.

### 5b. LEAK detected
| entry_id | current_round | progression_decision | photo_count | decided_in_round |
|---|---|---|---|---|
| `6ecd09a9…3630e` | 3 | `shortlisted` | 20 | 0 |

⚠️ **VIOLATION of Locked Plan §Pending Rule**: `progression_decision` is non-NULL while every photo in the current round is still pending. This is the exact bug the Phase 3 trigger + Phase 5 derive function will eliminate. (Read-only audit; **no fix applied**.)

---

## 6. Round coverage in production
| Round | decision rows | entries | judges |
|---|---|---|---|
| 1 | 20 | 1 | 1 |
| 2 | 15 | 1 | 1 |
| 3 | 0 | 0 | 0 |
| 4 | 0 | 0 | 0 |

R3/R4 have **zero production data** — Phase 8 must rely on synthetic seeds for those rounds.

---

## 7. Open questions (unchanged from prior recheck — still blocking Phase 1)

- **Q-0.1** Phase 8 may use synthetic seeded entries? (recommended: yes)
- **Q-0.2** Re-activate inactive `Not Selected for R3` / `Not Selected for Final` / `Stayed at R2` / `Stayed at R3` tags, or keep them inactive and rely on `v3_stage_catalog` only?
- **Q-0.3** Confirm: R3/R4 paths validated via synthetic seed + edge-fn negative tests is sufficient?

---

## 8. Compliance with the 5 Mandate Rules
1. **No Assumptions** — every value above is from raw SQL, attached in `raw.txt`.
2. **No Guesswork** — open questions surfaced rather than guessed.
3. **No Part Checking** — all 5 required items (catalog, progression_decision, tags, decisions, pending) executed.
4. **No Casual Approach** — diff matrix per key, leak case isolated by entry_id.
5. **Claude Only** — this report and all SQL authored by Claude.

**No data was modified. Phase 0 read-only complete.**
**Awaiting `phase 0 ok` + answers to Q-0.1 / Q-0.2 / Q-0.3 before Phase 1.**
