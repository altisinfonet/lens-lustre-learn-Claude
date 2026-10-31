# P35 · Primary keys + foreign-key indexes — evidence (D1, T1) · EXPAND half (A-4a)

**Gate (GATE_REGISTER P35):** "every table has a primary key or a written reason not to; the duplicate index pairs dropped; `post_hashtags.author_id` indexed."

| Clause | This PR | Proof |
|---|---|---|
| Primary key or a written reason | Staging (read-only, 2026-10-04 08:20 UTC): **6** public tables have no PK. All six are frozen snapshots (`_v3_preflight_snapshot_*` ×4) or RETIRED tables (`categories_migration_dropped`, `posts_dead_host_backup_20260812`). Their DROP is A-4c (1-AU-03), and the reasons are written in `PROBE_p35_keys.sql` | **Build:** `scripts/db-p35-keys-check.mjs` rule 1 (new tables need a PK or a `-- P35: no PK because …` line). **Live:** the PROBE fails on an unreasoned table and on a stale reason |
| `post_hashtags.author_id` indexed | `20261004_0003`: `idx_post_hashtags_author_id`, plus **`user_block_notices.blocked_id`**, the only other unindexed FK in public (staging, 08:20 UTC). That is D1's own table from 20261003_0002 | **Build:** rule 2 (every new FK needs a leading index). It is **red on staging's own tree** before this PR (`p35-keys-check-red-staging-64a0d66.txt`) and green with it. **Live:** the PROBE fails on both FKs and passes after |
| Duplicate pairs dropped | **Not here.** These are CONTRACT drops (A-4c), held by C-2 | — |

## Synthetic test at launch scale (`p35-transcript.txt`): scratch PG 17.11, 10,000 accounts, **999,500 `post_hashtags` rows** (161 MB), with staging's indexes
| Reading | Before | After |
|---|---|---|
| FK cascade into `post_hashtags` when one account is deleted (EXPLAIN ANALYZE trigger time, median of 3) | **3.0 ms**: a whole-index scan of `idx_post_hashtags_author (hashtag_id, author_id)`, whose leading column is not `author_id` | **0.4 ms** (×8) |

This scales with the table: the cost before is a full index scan, so it grows linearly with `post_hashtags`.
- The rollback is lane-guarded and drops only its own two indexes, never a pre-existing one.
- Re-applying is harmless, because the indexes are created IF NOT EXISTS.

## Findings
- **F-P35-1:** the four `_v3_preflight_snapshot_*` tables still grant `anon` and `authenticated` every privilege, including TRUNCATE (RLS on, no policy). TRUNCATE is not governed by RLS. They are not exposed through PostgREST, but this belongs to SEC and to the A-4c drop.
- **F-P35-2:** `idx_post_hashtags_author` is named for author but leads on `hashtag_id`. It is a duplicate-pair candidate with `idx_post_hashtags_hashtag` for A-4c, after C-2.
