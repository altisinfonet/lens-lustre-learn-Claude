# CG — Competition Engine Integrity Gate, first pass (2026-08-14)

Read-only audit against production. No changes.

## The auditor is real and green
`judging_invariants_check()` run directly on production: **7/7 ok, 0 failures**
(tag_decision_drift, current_round_canonical, decision_vocabulary,
eligibility_consistency, r4_stuck, no_legacy_in_progression_writers,
rejected_entry_gate_leak). The CI test that wraps it is skipped ONLY for
missing service-role credentials — parity note: the nightly cron and the test
call the same function.

## Guard map vs the CG matrix
| Matrix item | Status | Mechanism |
|---|---|---|
| Score immutability | **GUARDED** | `trg_enforce_round_lock` (completed → "Scoring is locked", UPDATE+DELETE), score-range + criteria validators, `audit_judge_scores` trail |
| Duplicate votes | **GUARDED (hard)** | unique constraint `competition_votes_entry_user_photo_unique` |
| Duplicate/over-submission | **GUARDED (soft) — finding** | 15 insert gates incl. `trg_enforce_max_entries`, rate-limit, throttle, fee, photo-limit, status-transition, audit. **Finding (minor): COUNT-based max-entries is racy under concurrent inserts** — over-admission by 1 possible; fix candidate: advisory lock or partial unique index when max=1. Recorded, not silently fixed. |
| Completed-round protection | Partially verified | score writes locked; round-row edit protection after publish not yet verified |
| Bypass assumption | To test in matrix | `app.bypass_round_lock` GUC bypasses the lock (designed for internal syncs) — who can set it must be enumerated |
| Judge authz / participant isolation / deterministic winners / award stacking | **CG-2** | production `competition_entries` is currently EMPTY (between contests) — needs a seeded harness pass |

## Queue
CG-2 = seeded-harness matrix (judge authz, isolation, winner determinism,
award stacking, round-row protection, bypass enumeration, race test for the
max-entries gate). Alongside: Phase F awaits the owner's bug list; W1 awaits
Razorpay sandbox credentials.
