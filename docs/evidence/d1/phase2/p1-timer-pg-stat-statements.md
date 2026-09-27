# P1 · the client timer's UPDATE in `pg_stat_statements` — readings

The gate's after-cut-over evidence: timestamped readings showing the timer's UPDATE variants making **zero new calls**.
Each reading is the same `SELECT` (below), with the instrument and the database clock recorded. Counters are
cumulative since the last `pg_stat_statements_reset()`, so "zero new calls" means **the same `calls` value on two
readings taken after D2's cut-over is live on the lane, at least one full timer period (5 min) apart** — not a zero.

```sql
SELECT now() AS read_at, calls, round(total_exec_time) AS total_ms, left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM extensions.pg_stat_statements
 WHERE query ILIKE '%update%profiles%last_active_at%' AND query NOT ILIKE '%pg_stat_statements%'
 ORDER BY calls DESC;
```

| lane | read at (database clock) | by | calls | total ms | state of the lane |
|---|---|---|---|---|---|
| staging | 2026-09-26 19:05 UTC | D1, Supabase MCP, read-only | 357 | 17,015 | **baseline** — timer live, 0001 not applied, D2 cut-over not landed |
| production | 2026-09-26 18:50 UTC | the Owner (relayed in the Phase 2 kickoff) | 13,294 / 4,306 / 43 / 3 | 1,033,384 / 233,171 / 188 / 16 | baseline — relayed, not read by D1 |

After-cut-over rows are appended here, one per reading, and each is re-read by the Auditor.
