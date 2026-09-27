# P2 · profiles dead-row ratio — the seven-day window (2-D1-04)

**Promotion condition** (`docs/gates/phase-2-kickoff.md`): P-2 is not promoted until this file holds **seven
consecutive dated readings, all < 10 %**, each confirmed by the Auditor's own SELECT. **Any reading >= 10 % restarts
the window.** The window is real elapsed time and is never shortened.

**Status: NOT STARTED.** Day 1 starts only when the Auditor records that D2's P1 client cut-over is live on staging
(2-AU-06). Readings taken before that date are not part of the window and are not entered below.

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
Cut-over live on staging (Auditor, 2-AU-06): **— not yet —**

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
