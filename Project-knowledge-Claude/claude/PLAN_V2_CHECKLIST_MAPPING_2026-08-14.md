# PLAN v2 — Reviewer's 35-item checklist mapped to reality (2026-08-14)

DOCX delivered to the owner. Implementation FROZEN pending review, per the
owner's instruction. B3a still awaits `GO 0555226f`.

## Verdict
**2 DONE · 14 IN PROGRESS · 19 NOT STARTED · 0 N/A.**
Sixteen of 35 were already built or underway under different names, with
production evidence. **Seven items are genuinely new and adopted:** chaos
testing, memory soak, backup/RESTORE proof, account/data lifecycle audit,
idempotency matrix (as a written artifact), systematic rate-limiting audit,
written privacy transition matrix. Three of the reviewer's biggest points (EXIF
earlier, wallet promotion, performance budgets) were already flagged in Plan
v1's own §7 review questions — two reviews converged.

## Status by item

### P0
| Item | Status | Evidence anchor | Home |
|---|---|---|---|
| Source-of-truth/Git | IN PROGRESS | CONTROL + ai-control.mjs + hash-bound GO live; 33 commits unpushed (allowlist) — #1 risk | standing |
| EXIF/GPS privacy | NOT STARTED | nothing strips today; live exposure | **moved up: own cycle after B3c** |
| Media authorization | IN PROGRESS | RLS live (20260814084711), flip-to-private proven; CDN blind to privacy (0 nonpublic posts today) | B5 |
| SECDEF/RPC authorization | IN PROGRESS | 2 mutation-tested gate tests; 6 fns closed in prod; 132 legacy signatures remain | E backlog |
| Wallet integrity | NOT STARTED | real-money fns exist; 1 writer locked (A8); no ledger audit | **new cycle W1 in B window** |
| Account/data lifecycle | NOT STARTED | delete-my-account/delete-user exist unaudited; owner CASCADE | **new audit in C** |

### P1
| Item | Status | Home |
|---|---|---|
| Media state machine | **DONE** (20260814104119, proven live, 8/8 mutations) | shipped |
| Media referential integrity | **DONE** (20260814084711, 23514 proven live) | shipped |
| Upload recovery | IN PROGRESS (idempotent begin_upload live; client resume missing) | B4 |
| Multi-photo atomicity | NOT STARTED (defect F3) | B4 |
| Post publish atomicity | NOT STARTED | B5 design req |
| Privacy transition matrix | IN PROGRESS (DB proven V12; CDN + written matrix missing) | B5 deliverable |
| Realtime correctness | IN PROGRESS (dup-sub fixed; firehose decision pending) | C |
| Notification integrity | NOT STARTED | C |
| Competition integrity | NOT STARTED (nightly invariants/hash/plagiarism fns exist UNVERIFIED; 1 test skipped) | F + audit |
| Course entitlement | NOT STARTED | F |
| Search/privacy | NOT STARTED | F |
| Android lifecycle | NOT STARTED | F |
| Navigation state machine | NOT STARTED | F |
| Performance budgets | NOT STARTED | **F binding gate** |
| Memory soak | NOT STARTED (spot fixes 08-13 exist) | F |
| Chaos testing | NOT STARTED (new) | **D** |
| Idempotency matrix | IN PROGRESS (media done) | **matrix doc in D** |
| Rate limiting/abuse | IN PROGRESS (presign 60/5min; cap 50 proven; email allow-list) | **audit in C** |
| Backup/restore proof | NOT STARTED (export fns exist; restore never proven) | **C early** |

### P2
| Item | Status | Home |
|---|---|---|
| Data invariants | IN PROGRESS (B1/B2 CHECKs; no schema-wide sweep) | E |
| Deletion safety | IN PROGRESS (B3a built, 47 tests, awaiting GO 0555226f) | B3a→B3b |
| Legacy-client compat | IN PROGRESS (feed overloads proven live) | E |
| API contract compat | IN PROGRESS (feed 15-col proven) | E |
| Dead-code verification | IN PROGRESS (trap #11 caught twice; consumed-list test pattern) | **sweep in E** |
| Full user journeys | NOT STARTED | F |
| Image perf budget | NOT STARTED | B3d + F |
| Storage/orphan metrics | IN PROGRESS (B3a report fields) | C |
| Backfill safety | NOT STARTED (guarded patterns exist) | B5 |
| Blind final audit | NOT STARTED (precedent: 13 Aug forensic audit) | E |

## Plan deltas adopted
1. EXIF/GPS → own cycle immediately after B3c (was inside B3d).
2. Wallet → engine-room cycle W1 (was Phase F).
3. Backup/RESTORE proof → Phase C early.
4. Account lifecycle audit → Phase C.
5. Chaos + idempotency matrix → D; rate-limit audit → C; memory soak → F; dead-code sweep + compat matrices → E; privacy matrix → B5 deliverable.
6. Performance budgets = binding F gate.

Everything else in `MASTER_PLAN_INSTAGRAM_STRONG_2026-08-14.md` stands.
