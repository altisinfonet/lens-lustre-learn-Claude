# Session C — Full Workstream-P Candidate Dependency Audit (Phases 2–7)

**Continues from:** `2026-09-21-scale-observation-forensic-and-clocks.md` and `2026-09-21-seed-preflight-and-clock-readiness.md` (same branch). All prior findings and the three seed blockers stand, unrepeated here.
**Purpose of this pass:** find the next genuinely-executable Workstream-P unit independent of the three seed blockers. **Conclusion reached: none exists right now.** This document is the forensic artifact the task calls for in that case — additive-only, no Gate Register / governance / interface-file / Session A or B file touched.

## 0 · Re-verified state at this checkpoint

- `staging` tip: unchanged, **`f0377afa29d61ea44cbed38b7ed6d38e296df225`**.
- `docs/gates/phase-2-kickoff.md` and `docs/gates/P1-interface.md`: **still absent** from `staging`. Phase 2 has not formally opened.
- `compare main..staging` (Standing Rule 20): **still not zero** — 8 files / 2,369 deletions (the `f105de` referral-reward migration/rollback set present on `main` but not on `staging`). Unchanged since the first checkpoint; not caused by any session's current branch.
- Session B's branch (`d1/P1-session-b-p30-p31-p33-20260921`) now carries real commits: P30/P31 forensic-recheck docs and P33 work (leftover-RLS-table retirement migration + rollback, `get_primary_admin_user_id` anon revoke + rollback, a definer-view-predicate test, a view-definitions snapshot) — 11 new files, 0 modifications to shared files.
- Session A has superseded its branch with `d1/P32-session-a-clean-20260921` — 9 new files (money/identity2/auth-hook revoke migrations + probes + evidence), 0 modifications to shared files.
- **No collision with either session**: both diffs are pure additions under their own owned evidence/migration paths.

---

## TASK — CANDIDATE MATRIX, every Phase 2–7 unit (plus the Phase-1 units for completeness)

Classification key: **A** executable now · **B** requires Owner decision · **C** requires Auditor gate · **D** requires previous implementation · **E** requires the 1M seed · **F** requires an elapsed-time clock · **G** already implemented / in progress, must not duplicate.

| Unit | Title | Phase | Class | Exact blocker | Owner of the fix | What starts immediately once cleared |
|---|---|---|---|---|---|---|
| P30 | Account enumeration closed | 1 | **G** | In progress — Session B | Session B / Auditor | n/a — not this session's |
| P31 | Certificate/staff-ID search narrowed | 1 | **G** | In progress — Session B | Session B / Auditor | n/a |
| P32 | Unauthenticated write/compute endpoints closed | 1 | **G** | In progress — Session A | Session A / Auditor | n/a |
| P33 | Leaked-password + definer views + catalogue tidy | 1 | **G** | In progress — Session B | Session B / Auditor | n/a |
| P1 | Presence removed from durable write path | 2 | **C** | `docs/gates/P1-interface.md` (Auditor-only, must be frozen before any P1 PR) and `docs/gates/phase-2-kickoff.md` — neither exists | Auditor | D1's presence-endpoint PR against the frozen signature |
| P2 | Replica identity corrected | 2 | **C** | `phase-2-kickoff.md` (phase entry condition for **all** of Phase 2, not just P1) | Auditor | D1's `REPLICA IDENTITY` migration |
| P10 | Client timer discipline | 2 | **C** | Same phase-2-kickoff gate | Auditor | D2's timer-discipline PRs (baseline inventory already exists from Phase 0) |
| P3 | Subscription/publication parity | 3 | **D** | Phase 3 entry: "Phase 2's A-2 is live on both lanes" — A-2 hasn't been written, let alone applied | D1/Auditor (sequential) | `docs/gates/phase-3-kickoff.md` + `P3-parity-schema.md` |
| P4 | Config served from edge | 3 | **D** | Same Phase-3 entry condition | D1/Auditor | D2's edge-config PR |
| P5 | Polling replaced by events | 3 | **D** | Same | D1/Auditor | D1's LISTEN/NOTIFY or queue change |
| P7 | Schema-cache reload discipline | 3 | **D** | Same | D1/Auditor | D1's reload-trigger audit |
| P9 | Vault secret decrypted once per worker | 3 | **D** | Same | D1/Auditor | D1's worker-init change |
| P6 | Cron run-log retention/purge | 4 | **D** | Phase 4 entry: "Phase 3 closed" | Auditor | A-4a expand |
| P8 | Autovacuum tuned, 7-day window | 4 | **D + F** | Phase 3 closed, then A-4a live, then the window itself | Auditor, then D1 (clock) | The 7-day dead-row window |
| P26 | Audit-log scope/retention | 4 | **D** | Phase 3 closed | Auditor | A-4b behaviour change |
| P27 | Leftover tables/backups retired | 4 | **D + F** | Phase 3 closed, then A-4c only after P-4 stable 7 days | Auditor | The contract-step drop, after the wait |
| P28 | Index-to-table ratio review gate | 4 | **D** | Phase 3 closed | Auditor | `scripts/db-index-ratio.mjs` + rule file |
| P34 | Role checks index-only, at 1M rows | 4 | **D + E + B** | Phase 3 closed **and** the seed (3 standing blockers) **and** H-2 (X1/X2 RLS consolidation — Owner has not scheduled it, task `4-OW-01`) | Owner (H-2 + seed rulings), then D1 | The equivalence matrix work, once all three land |
| P35 | Primary keys / catalogue hygiene | 4 | **D** | Phase 3 closed | Auditor | A-4a primary-key additions |
| P11 | Fast image component, ban bare `<img>` | 5 | **D** | Phase 5 entry: "Phase 4's P-4 promoted." (The plan's own `4-D2-01` "run ahead" note lets D2 branch this *during* Phase 4 — but Phase 4 itself requires Phase 3 closed, which hasn't happened, so the run-ahead allowance doesn't create an earlier real start point today.) | Auditor (phase sequencing) | D2's `OptimizedImage` rollout — code and lint rule are independent of any DB state once unblocked |
| P12 | One translation chunk per language | 5 | **D** | Same | Auditor | D2's `translations.rest.ts` split |
| P13 | Binding bundle-size budget | 5 | **D** | Same | Auditor | D2's CI ceiling |
| P14 | Caching rules written/enforced | 5 | **D** | Same | Auditor | D2's header policy |
| P15 | Transfer compression verified | 5 | **D** | Same | Auditor | One-shot D2 measurement |
| P16 | AVIF derivative ladder | 5 | **D** | Same | Auditor | D2/Cloudflare negotiation |
| P17 | First-paint/SEO decision | 5 | **D** | Same | Auditor, then Owner names SEO owner | D2's decision doc |
| P18 | Core Web Vitals as yardstick | 5 | **D** | Same | Auditor | Per-release vitals report |
| P21 | Font loading policy | 5 | **D** | Same | Auditor | D2's font strategy |
| P22 | Web offline — decision | 5 | **D** | Same | Auditor | D2's decision doc |
| P23 | Accessibility workstream | 5 | **D** | Same | Auditor | D2's WCAG-level decision + CI check |
| P24 | Language/localisation governance | 5 | **D** | Same | Auditor | D2's policy doc |
| P25 | Certificates in R2, owner-only | 6 | **D + B + C** | Phase 6 entry: Phase 5 closed; `P25-interface.md` (Auditor); R2 bucket created (Owner, `6-OW-01`) | Auditor + Owner | D1/D2's expand + render pipeline |
| P19 | Read-through cache tier | 7 | **D** | Phase 7 entry: Phase 6 closed | Auditor | D1's cache-tier build |
| P20 | Search engine at 1M rows | 7 | **D + E** | Phase 6 closed **and** the seed | Auditor, Owner (seed) | D1's index build once seeded |
| P29 | N+1 audit at scale | 7 | **D + E** | Phase 6 closed **and** the seed (screen-level tracing is more meaningful at volume, though the trace itself doesn't strictly require 1M rows — the plan places it in Phase 7 regardless) | Auditor | D1/D2's per-screen trace |
| X1/X2 | RLS policy consolidation (pre-Phase-4 hold, H-2) | — | **B** | Owner has not scheduled it (`4-OW-01`) | Owner | Work can start the moment it's scheduled — it's outside Addendum A's own numbering, owned by D1 when scheduled |

**Result: 0 units classified A.** Every Phase 2–7 unit is blocked either on Phase 2's Auditor kickoff (which doesn't exist and which this session is explicitly barred from creating), or transitively on a later phase's predecessor promotion, or on the seed, or on an Owner ruling. There is no unit whose current blocker is "nothing, a developer session could just do it."

## Why this holds even for the "run-ahead" units (P11, P12, P15, P16, P21)

The plan itself (`4-D2-01`) anticipates exactly the question "can Phase-5 client work start early since it needs no DB change?" — and answers it: yes, but *during Phase 4*, not before it. Phase 4 in turn requires Phase 3 closed (`4.2`), and Phase 3 requires Phase 2's `A-2` live (`3.2`), and Phase 2 requires its own kickoff and interface freeze, neither of which exist. So the run-ahead allowance shortens the critical path once the chain is moving; it does not create an independent start point while the chain hasn't started at all. Starting P11 et al. today would be building ahead of a phase that has not been authorized to open — the same "casual shortcut" category flagged in the prior checkpoints, not a genuinely eligible unit.

## Why nothing was implemented this pass

Per the instructions: if all candidates are genuinely blocked, do not manufacture work. Every path checked terminates in the same place — an Auditor-owned gate file that doesn't exist, a phase promotion that hasn't happened, the seed, or an Owner ruling. None of these is something a Session-C-scoped branch can produce without either impersonating the Auditor (writing `phase-2-kickoff.md` / `P1-interface.md` myself — explicitly forbidden) or working ahead of an unopened phase (the same risk already flagged twice on this branch).

## What becomes immediately available the moment each gate clears

- **The instant `phase-2-kickoff.md` + `P1-interface.md` land:** P2 and P10 can start immediately (D1's replica-identity migration and D2's timer-discipline PRs both have everything else already in place — baseline data, instruments, reservation targets named in the plan text itself). P1 can start immediately once the interface signature is fixed.
- **The instant Phase 3 closes:** the Phase-4 expand step (`A-4a`) — primary keys, autovacuum settings, retention — has no other dependency and no elapsed-time wait.
- **The instant the seed's three blockers clear:** Task 1's pre-flight checklist (prior document) makes the seed itself a checklist, not an investigation; P34/P20/P29's *scale* work becomes possible the same day the seed and (for P34) H-2 both land.
- **The instant the Owner schedules X1/X2:** that work can start in parallel with anything else, since it is explicitly outside Addendum A's phase numbering.

---

## Confirmation

No 1M seed was run. No elapsed-time clock was started. No file under `docs/gates/**`, `docs/PROMOTION_LEDGER.md`, `docs/gates/governance-manifest.json`, or any Session A/B–owned path was touched. This document itself is the only change on this branch this pass.
