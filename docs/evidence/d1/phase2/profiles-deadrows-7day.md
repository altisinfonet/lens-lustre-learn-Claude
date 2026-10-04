# P2 · profiles dead-row ratio — the seven-day window (2-D1-04)

**Promotion condition** (`docs/gates/phase-2-kickoff.md`): P-2 is not promoted until this file holds **seven
consecutive dated readings, all < 10 %**, each confirmed by the Auditor's own SELECT. **Any reading >= 10 % restarts
the window.** The window is real elapsed time and is never shortened.

**Status: NOT STARTED** (R-67: pre-cut-over dead rows; the 0003 VACUUM resolves them — see "The window" below).
Readings taken before day 1 are not part of the window and are not entered in its table.

## Lane and instrument
- **Lane:** staging, project `fpszggreishhuvdpkmdr` (the lane the cut-over lands on first, per 2-D1-04).
- **Instrument:** the SELECT below, verbatim, read-only, run through the Supabase MCP `execute_sql` by D1; the Auditor
  re-runs the same SELECT independently and records the value in the "Auditor" column.
- **One reading per calendar day (UTC).** The time is the database clock (`now()` in the result), not a session clock.
- **What moves the number besides the cut-over** — recorded with every reading so a good day cannot be mistaken for a
  fix: `last_autovacuum` / `last_vacuum` (a vacuum drops `n_dead_tup` to ~0 whatever the write rate), `n_tup_upd` and
  `n_tup_hot_upd` (write volume since stats reset), and `stats_reset`.

```sql
-- P2 · 2-D1-04 · profiles dead-row reading. READ-ONLY.
SELECT now()                                                             AS read_at_db_clock,
       s.n_live_tup,
       s.n_dead_tup,
       round(100.0 * s.n_dead_tup / nullif(s.n_live_tup + s.n_dead_tup, 0), 1) AS dead_pct,
       s.n_tup_upd,
       s.n_tup_hot_upd,
       s.last_autovacuum,
       s.last_vacuum,
       (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()) AS stats_reset
  FROM pg_stat_user_tables s
 WHERE s.relid = 'public.profiles'::regclass;
```

## Baseline (not part of the window)
| read at (db clock, UTC) | by | live | dead | dead % | note |
|---|---|---|---|---|---|
| 2026-09-26 19:05 | D1 | 50 | 51 | 50.5 | staging, client timer live, before any P1/P2 change |
| 2026-09-27 10:28 | D1 | 50 | 51 | 50.5 | the SELECT above, verbatim, to prove it runs; n_tup_upd 358, n_tup_hot_upd 2, last_autovacuum 2026-09-15 07:05, last_vacuum none, stats_reset 2026-08-25 20:33 |

Note on the baseline: only **2 of 358** profiles UPDATEs since the stats reset were HOT. A non-HOT update leaves a
dead heap tuple *and* new index entries, which is why the timer's volume shows up so directly in `n_dead_tup`. This is
recorded, not acted on.

## The window
Cut-over live on staging (Auditor, R-67): **2026-09-28 07:17 UTC** (e04a116, #310 + #313).

**The window has NOT started (R-67).**
- **Reason:** `profiles` still carries the dead rows left by the OLD client timer: 50 live / 51 dead = 50.5 %, last
  autovacuum 2026-09-15.
- **Why autovacuum won't clear them:** at this table size it does not fire until there are
  50 + 0.2 × 50 = **60** dead rows.
- **Resolution:** the one-time `VACUUM (ANALYZE) public.profiles`, in
  `supabase/migrations/20260920_0003_p1_profiles_vacuum_once.sql`, dispatched on staging.
- **Day 1** is the first reading < 10 % after that dispatch, as the Auditor re-reads it.

**For the Auditor before day 1: on staging, a < 10 % reading may not be discriminating.**
- Nobody has used staging since 2026-09-15: no heartbeat minutes and no `last_active_at` in the last 3 days (read
  2026-09-28).
- After the VACUUM, a table nobody writes to stays at 0 % whatever the client does.
- Seven such days would show that staging was idle, not that P1 works.
- The window measures P1 only if staging carries real sessions during it, or if the window is taken on production.
  That choice is the Auditor's; this file records the readings either way, with `n_tup_upd` beside each, so an idle
  day is visible as one.
- Also recorded: the index `idx_profiles_reengagement_scan (last_active_at, …)` makes every `last_active_at` UPDATE
  non-HOT. So each `record_session_end` or backfill write leaves one dead tuple. At 50 live rows, 6 such writes
  between vacuums reach 10.7 %, and autovacuum does not fire until 60. No action here (C-2 holds all index drops);
  this is recorded so the Auditor can read the window in that light.

| day | read at (db clock, UTC) | live | dead | dead % | n_tup_upd | n_tup_hot_upd | last_autovacuum | last_vacuum | < 10 %? | D1 | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | |
| 2 | | | | | | | | | | | |
| 3 | | | | | | | | | | | |
| 4 | | | | | | | | | | | |
| 5 | | | | | | | | | | | |
| 6 | | | | | | | | | | | |
| 7 | | | | | | | | | | | |

A reading >= 10 % is entered in the row it falls on, marked **RESTART**, and a new table (window 2) is started below
this one from the next day. Rows are never edited after the Auditor confirms them.
