# P1-H · profiles dead-row ratio by design (R-82) — evidence (D1, T1)

**Gate (P1, amended by the Owner in R-82):** "`profiles` dead-row ratio measured below 10 % for seven consecutive days" is replaced by a design proof with three parts. The seven-day reading (`p2-deadrows-daily`) keeps running as a **monitor only**.

| Part | What | Status |
|---|---|---|
| (a) No client-timer write | CI `d1-p1-client-timer` | Green on main (since `649bd51`) |
| (b) Tuned autovacuum | `20261004_0001`: `profiles` gets `autovacuum_vacuum_scale_factor = 0.05`, `autovacuum_vacuum_threshold = 0` | **Build guard** `scripts/db-p1-autovacuum-check.mjs` + self-test (9), CI `d1-p1-autovacuum.yml`. **Red on staging `3408104`** (`p1-autovacuum-check-red-staging-3408104.txt`: 54.5 % / 36.8 % / 16.7 % worst case at 50 / 131 / 100k rows); green with the migration (4.8 % at every size). **Live:** `PROBE_p1_profiles_autovacuum.sql` |
| (c) Synthetic churn at launch scale, fail-first | `p1-churn-run.sh` → `p1-churn-transcript.txt` | below |

## Why the defaults cannot hold 10 %
Autovacuum starts when `n_dead_tup > threshold + scale × N`. With Supabase's defaults (50, 0.2; read on staging 17.6, 2026-10-04 10:33 UTC), the worst ratio before a vacuum is `(50 + 0.2N) / (1.2N + 50)`:
- 54.5 % at 50 rows (staging);
- 36.8 % at 131 rows (production);
- 16.7 % at 100,000 rows (launch).

Every last-seen write is non-HOT, because `idx_profiles_reengagement_scan` indexes `last_active_at`. So each write leaves one dead tuple.

## The synthetic churn test (scratch PG 17.11, **real autovacuum**)
**Setup**
- The table has staging's six `profiles` indexes and staging's average row width (366 B).
- The write pattern is P1's: `record_session_end` UPDATEs, plus a `backfill_last_seen` burst.

**Time compression, stated**
- `autovacuum_naptime` is 1 s here; on Supabase it is 60 s.
- Session ends arrive at 250/s, against the launch rate of about 7 per minute (10,000 a day).
- Per naptime that is about 35× **harsher** than launch, so the numbers are an upper bound.

| Size | Load | Defaults (50 / 0.2) | **P1-H (0 / 0.05)** |
|---|---|---|---|
| **100,000 (launch)** | 20,000 session ends + a 2,000-row backfill every 10 s | max **16.8 %**, p95 16.1 %, ≥ 10 % for 39.6 % of the time, 1 autovacuum | max **6.6 %**, p95 4.9 %, **never ≥ 10 %**, 6 autovacuums |
| 131 (production today) | 240 session ends + a 10-row backfill every 30 s | max 38.2 %, p95 35.8 %, ≥ 10 % for 70.1 % of the time | max 11.5 %, **p95 5.8 %**, ≥ 10 % for 1.2 % of the time |

**Fail-first:** the defaults go over 10 % at both sizes. Probe and rollback: the PROBE passes with P1-H. The rollback (lane-guarded) RESETs the two options, and the PROBE then refuses (36.8 %).

## Finding F-P1H-1 (small tables, stated rather than hidden)
At 131 rows, a single backfill that touches 10 profiles is 7.6 % of the table in one statement. **No setting** can keep the ratio under 10 % during the naptime after such a burst, because autovacuum cannot start until its next check. P1-H limits that to about 1 % of the time (p95 5.8 %). At launch scale a burst of the same share would be 7,600 rows in one statement; the backfill's real size is the members active in 30 min, a far smaller share. The gate's design proof is the launch-scale row.

## Cost
- At launch: one vacuum per ~5,000 dead rows, about twice a day.
- Today (131 rows): at most one small vacuum per naptime, on a 64 kB table.
- `ALTER TABLE … SET` takes SHARE UPDATE EXCLUSIVE, so reads and writes continue.
