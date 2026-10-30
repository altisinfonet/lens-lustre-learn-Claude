# CLEANUP STATUS — cleanup runner

Heartbeat: 2026-10-30 ~07:15Z. Repo + GitHub inventory done. DB probe 0501 merged; staging run queued; production after carry #657.
Inventory: `docs/evidence/cloud/CLEANUP_INVENTORY.md`.

| Class | Found | Deleted on staging | Deleted on main | In PR | Kept | Ask owner |
|---|---|---|---|---|---|---|
| A repo files | 156 files + 15 deps | 152 files (#647, #648) | 0 (carries #658, #659) | 15 deps (#656) | 9 rows | 6 rows |
| A GitHub PRs | 33 open | 4 closed | – | – | 22 | 6 |
| A branches | 89 merged | 0 (blocked: 403) | – | – | – | 1 |
| B DB objects | pending PROBE 0501 | 0 | 0 | – | – | – |

Lines removed on staging: 26,235 (#647 −23,127, #648 −3,108) · files removed: 152.
PRs: #647 merged (3e15344) · #648 merged (dd3b3b0) · #649 merged (3b34ce9) · #656 deps → staging · #657 / #658 / #659 carries → main.
Reviewer (independent, diff only): #647, #648, #649 NOTHING BLOCKING; #656 running.
CI on #647/#648/#649: all green (tsc, vitest, build, security, Chromium/Firefox/WebKit, app origin https://localhost).
PRs closed: #391, #276, #214, #156 (re-cut by #641, #639, #642, #640). Branches deleted: 0. DB objects dropped: 0.
SQL runs: staging PROBE 0501 — run 41018483103 (queued).

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
