# P28 · The index-to-heap review rule (standing rule, D1)

**Gate (GATE_REGISTER P28):** "no table ships with more index than heap without a written reason; the ratio checked at review."

## 1 · The rule
1. **At review.** Every `CREATE INDEX` in a migration dated `20261004` or later carries a `-- P28:` line within the three lines above it. The line names the table, the expected row count at launch, and why the index pays for itself, for example `-- P28: posts · ~1M rows at launch · feed by author, 25k scans/day on staging`. CI enforces this with `scripts/db-p28-index-review-check.mjs` (workflow `d1-p28-index-review.yml`). A missing line is a red build.
2. **On the lanes.** A table whose heap is **≥ 1 MB** and whose total index size is larger than its heap must appear in `scripts/db-p28-index-ratio-reasons.json` with a written reason (≥ 40 characters). `PROBE_p28_index_ratio.sql` (read-only) is red otherwise. The build check keeps the PROBE's list and the JSON identical.
3. **Stale reasons are errors.** A reason for a table that no longer exceeds its heap must be removed. The PROBE reports it.

## 2 · Why the 1 MB floor (written reason, not a loophole)
Below 128 pages the ratio measures empty space, not cost. An empty table has 0 bytes of heap and ≥ 8 kB per index, so every new table "has more index than heap" until it holds rows. On staging (2026-10-04 08:17 UTC) 24 of the 25 largest offenders hold under 120 kB of heap. Judging them would make the rule fire on every table and be ignored. At 1 MB the ratio means something. The 1M-row seed (P20) brings every table that matters above the floor.

## 3 · What the rule does not do
It drops no index. The C-2 hold stands, and drops are A-4c. It does not size indexes for launch: P20's seed does that, and the rule applies to it automatically.
