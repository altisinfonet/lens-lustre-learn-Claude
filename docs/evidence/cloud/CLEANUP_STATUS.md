# CLEANUP STATUS — cleanup runner

Heartbeat: 2026-10-30 ~08:45Z. Repo + GitHub done and live. DB inventory done on both lanes. Duplicate-index drop: staging sequence running.
Inventory: `docs/evidence/cloud/CLEANUP_INVENTORY.md`.

| Class | Found | Deleted on staging | Deleted on main / production | Kept | Ask owner |
|---|---|---|---|---|---|
| A repo files | 152 files + 15 npm packages | 152 files + 15 packages (#647, #648, #656) | same (#658, #659, #663) — live check 3 browsers OK | 9 rows | 7 rows |
| A GitHub PRs | 33 open | 4 closed | – | 22 | 6 |
| A branches | 89 merged | 0 (blocked: 403) | – | – | 1 |
| B DB objects | 4 duplicate indexes droppable; 2 more pairs judging/referral | in progress (#664) | pending (#665) | 8 rows | 3 rows |
| D storage | 4 buckets prod (151 objects, 109.5 MB) | 0 | 0 | – | orphan match not measured |

Lines removed: 26,235 + 684 (lock/manifest) on staging and main · files removed: 152.
PRs merged to staging: #647, #648, #649, #656, #664. Carried to main: #657, #658, #659, #663; #665 open.
Independent reviewer (diff only): NOTHING BLOCKING on #647, #648, #649, #656, #664.
CI: all green on every PR above (tsc, vitest, build, security, Chromium/Firefox/WebKit, app origin https://localhost).
Live after main 22df8f4: d2-live-check run 41024008342 — home + /feed 200 in Chromium, Firefox, WebKit; console errors fewer than the pre-cleanup run 41008319490 (no new ones).
PRs closed: #391, #276, #214, #156. Branches deleted: 0. DB objects dropped: 0 so far.
SQL runs: PROBE 0501 staging 41018483103 ✓ · production 41023653669 ✓.

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
12. Two more duplicate index pairs exist, on judge decisions and on referral codes. Drop the spare one in each pair? (Judging and referral rewards, so I did not touch them.)
13. An empty audit table from the August category change (`categories_migration_dropped`) is still in the database. Drop it?
14. A July backup of the ad-slot settings (`ad_slots_backup_20260723`) is stored in the site settings and nothing reads it. Delete it?
