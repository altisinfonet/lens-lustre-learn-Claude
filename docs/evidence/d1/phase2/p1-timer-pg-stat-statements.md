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

| staging | 2026-09-28 07:17 UTC | the Auditor, read-only (R-67) | 357 | 17,015 | cut-over LIVE (e04a116: #310 + #313); 0001 applied; zero new calls since 2026-09-26 |
| staging | 2026-09-28 07:22 UTC | D1, Supabase MCP, read-only | 357 | 17,015 | same; `record_session_end` RPC calls in pg_stat_statements: **0**; `backfill_last_seen()`: 39 calls, all `succeeded` |

After-cut-over rows are appended here, one per reading, and each is re-read by the Auditor.

### Caveat on the 2026-09-28 rows: the zero is not yet discriminating (reported to the Auditor)
The timer's count was already 357 on 2026-09-26 19:05, before the cut-over existed. It is 357 now because **nobody has
used staging since 2026-09-15**, not only because the timer is gone. Read on staging 2026-09-28, read-only:
- `member_activity_minutes`: the newest heartbeat minute is 2026-09-15 06:23. There are 0 minutes after 2026-09-26 19:05.
- `profiles`: no `last_active_at` in the last 3 days.
- pg_stat_statements: 0 PostgREST calls to `record_session_end`.

A reading that separates "timer removed" from "nobody active" needs a real session on the cut-over build. Someone
signs in to staging, uses it for 10 minutes or more (two timer periods), then closes the tab. The expected result:
- heartbeat minutes > 0;
- `record_session_end` called at least once;
- the timer variant still at 357.

That reading is appended here as the 2-D1-02 evidence.
