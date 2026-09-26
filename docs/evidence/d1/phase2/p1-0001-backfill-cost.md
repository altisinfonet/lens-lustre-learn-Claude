# P1 · 20260920_0001 — what `backfill_last_seen()` costs, measured

Unit 2-D1-02. Referenced from the migration header ("WHERE THE INTERFACE IS SILENT", 4).

## Why this file exists
`docs/gates/P1-interface.md` §3 says the crash bound is `max(member_activity_minutes.minute_bucket)` per member.
The function does exactly that: it aggregates the **whole** heartbeat table on every run, every 30 minutes.
A windowed scan (only the last ~35 minutes of minutes) would be cheaper, but it would miss members whenever a
cron run is skipped, and it is not what the frozen interface says. So the whole-table cost is measured rather than argued.

## Staging, read-only, 2026-09-26 19:05 UTC (database clock), instrument: SELECT via the Supabase MCP, project `fpszggreishhuvdpkmdr`
| reading | value |
|---|---|
| `member_activity_minutes` rows | 35 |
| distinct members in it | 1 |
| total relation size | 48 kB |
| `profiles` rows | 50 |
| rows a backfill would touch right now | 0 |

Staging is too small to say anything about cost, so scale was measured on the scratch cluster.

## Scratch PostgreSQL 17.11, 1,000,000 heartbeat rows (20,000 members × 50 minutes), after `VACUUM ANALYZE`
Fixture `p1-0001-fixture.sql`, 0001 applied through `p1-0037-runit2.sh` (staging lane), called as `service_role`.

| run | rows touched | wall time |
|---|---|---|
| 1 — every member 50 min stale | 20,000 | 681 ms |
| 2 — nothing stale | 0 | 198 ms |
| 3 — nothing stale | 0 | 186 ms |

`EXPLAIN (ANALYZE, BUFFERS)` of the selecting half: parallel seq scan of `member_activity_minutes` (2 workers),
hash aggregate by `user_id` (2 MB), hash join to `profiles`; **165 ms, 7,648 shared buffers**, all hits.

## Reading
- The steady-state run (nothing stale) is ~0.2 s per 1 M heartbeat rows, every 30 minutes — about 0.01 % of one core.
  It is linear in the table's size: at 10 M rows expect ~2 s per run.
- The cost that matters to P1 is the **write** count, and that is bounded by members whose session ended silently —
  not by members online, which is what the client timer's write count was.
- Growth of `member_activity_minutes` itself is not this unit's subject. If its retention is ever unbounded, this
  function is one of the things that gets slower; that belongs with the Phase 4 lifecycle units (P6/P8), and is
  recorded here so it is found there.
