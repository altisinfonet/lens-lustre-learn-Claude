# CLEANUP STATUS — cleanup runner

Heartbeat: 2026-10-30 ~06:35Z. Phase 1 inventory done for repo + GitHub; DB inventory probe in review (#649).
Inventory: `docs/evidence/cloud/CLEANUP_INVENTORY.md`.

| Class | Found | Deleted (merged) | In PR | Kept | Ask owner |
|---|---|---|---|---|---|
| A repo files | 196 files | 0 | 156 files (#647, #648) + 15 deps (branch) | 9 rows | 6 rows |
| A GitHub PRs | 33 open | 4 closed | – | 22 | 6 |
| A branches | 89 merged | 0 (blocked: 403) | – | – | 1 |
| B DB objects | pending PROBE 0501 | 0 | – | – | – |
| C | – | – | – | – | listed below |

PRs: #647 old docs (125 files, −23,127) · #648 dead src (31 files, −3,093) · #649 PROBE 0501 (read-only) · `cleanup/unused-deps` (−684 lock/manifest lines; PR after #648).
Reviewer (independent, diff only): #647 NOTHING BLOCKING · #648 NOTHING BLOCKING · #649 NOTHING BLOCKING.
CI: queued. PRs closed: #391, #276, #214, #156 (re-cut by #641, #639, #642, #640). Branches deleted: 0. DB objects dropped: 0.

## Owner questions
1. 89 old branches are fully merged and safe to delete, but this runner is not allowed to delete branches. Delete them (list in the inventory) yourself, or allow it?
2. The five governance documents (Addendum, Gate Register, Promotion Ledger, Production Ledger, DECISIONS) have not been updated since early September. Keep them as they are, or archive them?
3. Keep the old runbooks and plans at the repo root (Android release runbook, next release runbook, Capacitor setup, store listing, project master record, changelog, architecture V2, phase-0 design review)?
4. CLAUDE.md calls every other file in `docs/` "historical". Delete those too (except files a test or workflow reads)?
5. Nine code files for judging, wallet and the old Lovable sign-in are not used anywhere. Delete them?
6. `vite-plugin-pwa` is installed but not used (the service worker is hand-written). Remove it?
7. The repo has two Bun lockfiles (`bun.lock` and the old `bun.lockb`). Delete the old one? (It only matters for the website build.)
8. Nine `UNAPPLIED_` SQL files are kept because tests and ledgers point at them. Keep them?
9. Six server functions have no caller in the code (two are called by Brevo/email services). Remove the ones nothing calls, once the database check confirms it?
10. Six old PRs (#174, #175, #254, #285, #289, #352) are not replaced by anything. Close them?
11. After #647 merges, CLAUDE.md still names files that are gone (AI_CONTROL.md, AI_EVIDENCE.md, docs/MASTER_EXECUTION_PLAN.md, docs/claude/**). Update that line in CLAUDE.md?
