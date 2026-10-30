CLEANUP COMPLETE

# CLEANUP STATUS — cleanup runner

Final heartbeat: 2026-10-30 ~09:25Z. Inventory: `docs/evidence/cloud/CLEANUP_INVENTORY.md`.

| Class | Found | Deleted / dropped | Kept | Ask owner |
|---|---|---|---|---|
| A repo files | 152 files + 15 npm packages provably unused | **152 files + 15 packages**, on staging and main | 9 rows | 7 rows |
| A GitHub PRs | 33 open | **4 closed** (superseded) | 22 | 6 |
| A branches | 89 fully merged | 0 — this session's git proxy refuses branch deletion (HTTP 403) | – | 1 |
| B DB objects | 4 duplicate indexes droppable; 2 more pairs in judging/referral | **4 indexes dropped, staging + production** | 8 rows | 3 rows |
| D storage | prod: 4 buckets, 151 objects, 109.5 MB | 0 (orphan matching not measured) | – | – |

**Removed:** 26,235 lines of files plus 684 lockfile/manifest lines; 152 files.
**PRs:** to staging #647 (old docs), #648 (dead src), #649 (PROBE 0501), #656 (unused deps), #664 (duplicate indexes) — all merged. Carried to main by cherry-pick: #657, #658, #659, #663, #665 — all merged.
**Checks:** every PR fully green (tsc, vitest, build, security, Chromium/Firefox/WebKit, app origin https://localhost). Independent reviewer (diff only): NOTHING BLOCKING on #647, #648, #649, #656, #664.
**Live:** main 22df8f4 deployed; d2-live-check run 41024008342 — home + /feed 200 in Chromium, Firefox, WebKit, no new console errors (vs. pre-cleanup run 41008319490). Re-checked home + /feed 200 in Chromium after the production index drop.
**PRs closed:** #391, #276, #214, #156 (re-cut as #641, #639, #642, #640). **Branches deleted:** 0.

**SQL runs (apply-migration.yml)**
| Step | staging | production |
|---|---|---|
| PROBE 0501 inventory (read-only) | 41018483103 ✓ | 41023653669 ✓ |
| PROBE 20261103_0501 dup-indexes (expect FAIL) | 41028216907 FAIL ✓ | 41030712515 FAIL ✓ |
| apply 20261103_0501 | 41028490467 APPLIED | 41030944821 APPLIED |
| PROBE 20261103_0501 (expect PASS) | 41029685910 PASS | 41031055033 PASS |
| after-drop app check | d2-app-origin 41028898864 ✓ (09:01Z) | live home + /feed 200 |

Dropped: `idx_unsubscribe_tokens_token`, `idx_suppressed_emails_email`, `idx_post_reactions_post_user`, `idx_feed_events_post` (identical twins kept). Rollback: `supabase/rollback/20261103_0501_cleanup_duplicate_indexes_ROLLBACK.sql`.

**Separate jobs, not done here:** capture the live-only in-use DB objects into git (incl. `posts_dead_host_backup_20260812`, which is still in use); storage orphan matching; edge-function deletes (blocked: no SUPABASE_ACCESS_TOKEN).

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
