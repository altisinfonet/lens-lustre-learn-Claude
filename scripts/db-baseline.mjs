#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// D1 · PHASE 0 — THE MEASUREMENT BASELINE. READS ONLY. WRITES NOTHING.
//
// Addendum A execution master, §6 PHASE 0, D1 column:
//
//   "scripts/db-baseline.mjs: a read-only snapshot of pg_stat_statements,
//    table sizes, dead-row ratios, index usage, publication list, policy
//    counts, definer-function classification. Output committed as JSON under
//    docs/evidence/d1/baseline/."
//
//   Gate: "A committed baseline for every unit that claims a number, with the
//          timestamp of measurement on every line."
//
// ───────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS, AND WHY IT IS A COMMITTED INSTRUMENT RATHER THAN A
// SESSION TRANSCRIPT.
//
// Every unit in the addendum is quantified — 66.7 %, 50.9 %, 580,000 requests,
// 64.2 % dead rows — and those figures were taken by hand, once, in a 38-minute
// window on 2026-09-01. A number taken by hand is a number nobody else can
// re-take. In three weeks somebody will claim an improvement, and the only
// honest answer to "compared with what, measured how?" is a file like this one:
// the query is in the artefact, so the "after" reading is the same instrument
// as the "before" reading, run by anyone, at any time.
//
// F-30, standing: an instrument that produces a published number ships with
// the number. So this file emits the SQL it ran alongside every result.
//
// ───────────────────────────────────────────────────────────────────────────
// THE FOUR CONTROLS, IN THE ORDER THEY FIRE. Each one refuses; none of them
// warns and continues.
//
//   1. LANE GATE, BEFORE CONNECTING. The project ref is parsed out of the
//      connection string's username (`postgres.<ref>`), exactly as
//      .github/workflows/apply-migration.yml does, and compared with --target.
//      A direct (non-pooler) string parses to nothing and is refused rather
//      than guessed at. This is the control that stops a production credential
//      pasted into the staging Environment.
//
//   2. READ-ONLY SESSION, AND A NEGATIVE CONTROL THAT PROVES IT.
//      PGOPTIONS sets default_transaction_read_only=on. A setting nobody has
//      seen fire is a claim, not a control (standing rule: a suite never shown
//      to detect a planted defect is not evidence about that class), so before
//      any probe runs, this script deliberately attempts a CREATE TABLE and
//      REQUIRES SQLSTATE 25006 back. If that write succeeds — or fails for any
//      other reason — the run aborts and no baseline is written. The baseline
//      is therefore never published on an unproven read-only claim.
//
//   3. CLUSTER FINGERPRINT, AFTER CONNECTING. pg_control_system().
//      system_identifier is a permanent per-cluster value. The lane gate reads
//      a string the caller supplied; this reads the database's own answer to
//      "who are you", and the two must agree. Recorded here from a read on
//      2026-09-02 06:38Z:
//        production jtdtehuqtinjxropkkcn → 7656985631720456337
//        staging    ztzutckwdhetphwghuzj → 7666007964130682852
//      If a fingerprint ever disagrees, that is a finding to report, not a
//      constant to update. Do not edit these to make a run pass.
//
//   4. NO MEMBER DATA. Every probe reads catalogue or statistics views only.
//      pg_stat_statements text is normalised by Postgres (constants become $1),
//      and is additionally truncated and redacted here before it is written.
//      No probe selects from an application table.
//
// ───────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE DELIBERATELY DOES NOT DO.
//
//   * It does not resolve disagreements. §6 Phase 0: "Disagreements are
//     recorded, not resolved." Where a re-measured figure differs from the
//     addendum's 2026-09-01 figure, the verdict is DISAGREES and both numbers
//     are written down. The script offers no explanation, because an
//     explanation written by the instrument is not evidence.
//
//   * It does not emit a single unused-index count. C-2 is a hard hold: four
//     methods produced 79 / 78 / 298-of-which-125 / 188, and no index is
//     dropped by anyone until they reconcile. This script therefore runs four
//     NAMED counting methods and emits four numbers. Collapsing them into one
//     is the exact mistake C-2 exists to prevent.
//
//   * It does not handle a secret. The connection string is supplied by the
//     Environment secret SUPABASE_DB_URL, read from the process environment,
//     never printed, and scrubbed from every error path. Nobody reading this
//     file, and nothing running in it, can print the credential.
//
//   * It does not write to the repository outside docs/evidence/d1/baseline/.
//
// ───────────────────────────────────────────────────────────────────────────
// USAGE
//
//   node scripts/db-baseline.mjs --target staging
//   node scripts/db-baseline.mjs --target production --out docs/evidence/d1/baseline
//   node scripts/db-baseline.mjs --print-sql          # emits every probe, connects to nothing
//
// Requires psql on PATH (the same postgresql-client apply-migration.yml
// installs) and SUPABASE_DB_URL in the environment. Node >= 22.12, ESM,
// zero npm dependencies — deliberately, because package.json is behind the
// Auditor's dependency window and a measurement instrument must not be the
// reason that window has to open.
// ═══════════════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The lane guard is a module, not a copy. One implementation of 'am I talking
// to the database I think I am', imported by every db-*.mjs script — because
// two copies of that check start to differ, and the one that did not get the
// fix is the one that runs the night something goes wrong.
import {
  LANES,
  assertLane,
  proveFingerprint,
  proveReadOnly,
  psql,
  redactSecrets,
  refParsedFromDsn,
  requireDsn,
  scrub,
  scrubExternal,
} from './db-lane-guard.mjs';

// ── The addendum's own figures, for the Phase 0 re-check ───────────────────
// Source: claude/DB_LOAD_PART_2_WHAT_ACTUALLY_EATS_THE_DATABASE_2026-09-01.md
// and claude/MASTER_PLAN_ADDENDUM_A_FORENSIC_2026-09-01.md, both measured
// read-only against production jtdtehuqtinjxropkkcn on 2026-09-01 between
// 10:44Z and 11:22Z, counter window from 2026-07-22 16:00:58Z.
//
// `probe` names the probe whose output answers it. `path` is a JSONPath-ish
// hint for a human reader, not an evaluated expression — this file does not
// grade itself. The verdict column is filled in by a person or by the
// comparison report, from the numbers in the same artefact.
const ADDENDUM_CLAIMS = [
  { id: 'A1', lane: 'production', claim: 'Counter window opened 2026-07-22 16:00:58Z', value: '2026-07-22T16:00:58Z', probe: 'R1' },
  { id: 'A2', lane: 'production', claim: 'Total statements executed in the window', value: 15885787, probe: 'R1' },
  { id: 'A3', lane: 'production', claim: 'Total database execution time in the window', value: '9 h 26 m', probe: 'R1' },
  { id: 'A4', lane: 'production', claim: 'Realtime change-log read: calls', value: 1440771, probe: 'R3' },
  { id: 'A5', lane: 'production', claim: 'Realtime change-log read: total_exec_time ms', value: 17271544, probe: 'R3' },
  { id: 'A6', lane: 'production', claim: 'Realtime change-log read: share of all exec time', value: '50.9 %', probe: 'R3' },
  { id: 'A7', lane: 'production', claim: 'Schema-cache reload queries: share of all exec time', value: '10.3 % (58 m)', probe: 'R3' },
  { id: 'A8', lane: 'production', claim: 'cron.job_run_details write traffic: share of all exec time', value: '3.0 % (17 m)', probe: 'R3' },
  { id: 'A9', lane: 'production', claim: 'Presence writes: calls / total ms', value: '12740 / 843574', probe: 'R3' },
  { id: 'A10', lane: 'production', claim: 'Presence writes: slow variant mean ms', value: 72, probe: 'R3' },
  { id: 'A11', lane: 'production', claim: 'Work no member asked for: share of all exec time', value: '66.7 % (6 h 17 m)', probe: 'R3' },
  { id: 'A12', lane: 'production', claim: 'pg_timezone_names: executions / mean ms', value: '2744 / 798', probe: 'R3' },
  { id: 'A13', lane: 'production', claim: 'Publication-list check: executions', value: 28624, probe: 'R3' },
  { id: 'A14', lane: 'production', claim: 'process_post_jobs(100): executions / total time', value: '701116 / 46 m', probe: 'R3' },
  { id: 'A15', lane: 'production', claim: 'Queue read triggered by the 5-second job: executions', value: 702154, probe: 'R3' },
  { id: 'A16', lane: 'production', claim: 'Outbound HTTP helper: executions (each decrypting a vault secret inline)', value: 422342, probe: 'R3' },
  { id: 'A17', lane: 'production', claim: 'email_send_state (0 rows) read this many times', value: 351031, probe: 'R3' },
  { id: 'A18', lane: 'production', claim: 'cron purge: executions / rows removed / mean ms', value: '41 / 1130456 / 6436', probe: 'R3' },
  { id: 'A19', lane: 'production', claim: 'profiles: live / dead rows and dead share', value: '106 / 68 = 64.2 %', probe: 'T1' },
  { id: 'A20', lane: 'production', claim: 'profiles: updates in the stats window', value: 13991, probe: 'T1' },
  { id: 'A21', lane: 'production', claim: 'profiles: HOT updates out of total', value: '2178 of 13989', probe: 'T1' },
  { id: 'A22', lane: 'production', claim: 'profiles_public_data: HOT updates out of total', value: '13846 of 13989', probe: 'T1' },
  { id: 'A23', lane: 'production', claim: 'user_devices: live / dead, never autovacuumed, 6781 writes', value: '333 / 75 = 22.5 %', probe: 'T1' },
  { id: 'A24', lane: 'production', claim: 'user_notifications: live / dead', value: '4266 / 797 = 18.7 %', probe: 'T1' },
  { id: 'A25', lane: 'production', claim: 'activity_logs: live / dead, last autovacuum 2026-08-19', value: '8778 / 1278 = 14.6 %', probe: 'T1' },
  { id: 'A26', lane: 'production', claim: 'cron.job_run_details: rows / size', value: '202082 / 76 MB', probe: 'T3' },
  { id: 'A27', lane: 'production', claim: 'Whole database size', value: '135 MB', probe: 'X3' },
  { id: 'A28', lane: 'production', claim: 'cron.job_run_details share of the database', value: '56 %', probe: 'T3' },
  { id: 'A29', lane: 'production', claim: 'profiles: table bytes / index bytes', value: '112 kB / 184 kB', probe: 'T2' },
  { id: 'A30', lane: 'production', claim: 'competition_entries: 0 rows, 48 kB table, 712 kB index', value: '0 / 48 kB / 712 kB', probe: 'T2' },
  { id: 'A31', lane: 'production', claim: 'judge_decisions: 0 rows, 0 B table, 208 kB index', value: '0 / 0 / 208 kB', probe: 'T2' },
  { id: 'A32', lane: 'production', claim: 'feed_events / ad_impressions / posts / email_send_log table:index bytes', value: '216:544 / 72:200 / 576:944 / 1320:1656 kB', probe: 'T2' },
  { id: 'A33', lane: 'production', claim: 'Tables published to realtime', value: 29, probe: 'P1' },
  { id: 'A34', lane: 'production', claim: 'REPLICA IDENTITY FULL on exactly these three', value: 'profiles, scheduled_posts, competition_round_publish', probe: 'P2' },
  { id: 'A35', lane: 'production', claim: 'SECURITY DEFINER functions', value: 329, probe: 'S1' },
  { id: 'A36', lane: 'production', claim: 'Triggers', value: 149, probe: 'S2' },
  { id: 'A37', lane: 'production', claim: 'Duplicate permissive policy instances across 82 tables', value: '384 / 82', probe: 'S3' },
  { id: 'A38', lane: 'production', claim: 'Active scheduled jobs', value: 16, probe: 'C1' },
  { id: 'A39', lane: 'production', claim: 'C-2 HARD HOLD — unused indexes, four unreconciled methods', value: '79 / 78 / 298-of-which-125 / 188', probe: 'I2' },
];

// ── Probes ────────────────────────────────────────────────────────────────
// Each probe's SQL is a bare SELECT. The runner wraps it so that every row
// returned carries its own measured_at_utc, which is what the gate sentence
// requires: "the timestamp of measurement on every line."
const PROBES = [
  {
    id: 'X3',
    title: 'Server identity, size and fingerprint',
    why: 'Control 3, and the identity every other number in this file is about.',
    sql: `
      SELECT current_database()                                   AS database,
             version()                                            AS version,
             (SELECT setting FROM pg_settings
               WHERE name = 'server_version')                     AS server_version,
             (SELECT system_identifier::text
                FROM pg_control_system())                         AS system_identifier,
             pg_database_size(current_database())                 AS database_bytes,
             pg_size_pretty(pg_database_size(current_database()))  AS database_size,
             current_setting('default_transaction_read_only')     AS read_only_session
    `,
  },
  {
    id: 'X1',
    title: 'Installed extensions',
    why: 'pg_stat_statements and pg_cron must be present or half this file measures nothing.',
    sql: `
      SELECT e.extname AS extension, e.extversion AS version, n.nspname AS schema
        FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       ORDER BY 1
    `,
  },
  {
    id: 'X2',
    title: 'Autovacuum and statement settings',
    why: 'P6/P8 propose changing these. The "before" value has to exist first.',
    sql: `
      SELECT name, setting, unit, source, boot_val
        FROM pg_settings
       WHERE name LIKE 'autovacuum%'
          OR name IN ('track_activity_query_size','statement_timeout',
                      'idle_in_transaction_session_timeout','shared_buffers',
                      'work_mem','maintenance_work_mem','max_wal_size',
                      'wal_level','max_replication_slots','max_connections')
       ORDER BY 1
    `,
  },
  {
    id: 'R1',
    title: 'pg_stat_statements window and totals',
    why: 'Claims A1, A2, A3. Every share-of-total in this file divides by this row — and statements_evicted says whether that denominator is complete.',
    sql: `
      SELECT (SELECT to_char(stats_reset AT TIME ZONE 'utc',
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                FROM pg_stat_statements_info)                       AS window_opened_utc,
             (SELECT round(extract(epoch FROM (now() - stats_reset))/86400.0, 2)
                FROM pg_stat_statements_info)                       AS window_days,
             -- dealloc is load-bearing, not trivia. It counts statements EVICTED
             -- from pg_stat_statements because the table hit pg_stat_statements.max.
             -- Any share-of-total computed over an evicted population — including
             -- the addendum's 50.9 % and 66.7 % — has an unknown denominator. If
             -- this is non-zero, say so beside every percentage in this file.
             (SELECT dealloc FROM pg_stat_statements_info)          AS statements_evicted,
             (SELECT count(*) FROM pg_stat_statements)              AS statements_tracked,
             (SELECT setting FROM pg_settings
               WHERE name = 'pg_stat_statements.max')               AS statements_capacity,
             sum(s.calls)                                           AS total_calls,
             round(sum(s.total_exec_time)::numeric, 3)              AS total_exec_ms,
             round((sum(s.total_exec_time)/3600000.0)::numeric, 4)  AS total_exec_hours,
             round(sum(s.rows)::numeric, 0)                         AS total_rows
        FROM pg_stat_statements s
    `,
  },
  {
    id: 'R2',
    title: 'Top 40 statements by total execution time',
    why: 'The unfiltered evidence behind every categorised total in R3. A category total nobody can re-derive is an assertion.',
    sql: `
      WITH t AS (SELECT sum(total_exec_time) AS all_ms FROM pg_stat_statements)
      SELECT s.queryid::text                                        AS queryid,
             s.calls,
             round(s.total_exec_time::numeric, 3)                   AS total_exec_ms,
             round(s.mean_exec_time::numeric, 3)                    AS mean_exec_ms,
             round(s.max_exec_time::numeric, 3)                     AS max_exec_ms,
             s.rows                                                 AS rows_returned,
             round((100 * s.total_exec_time / NULLIF(t.all_ms,0))::numeric, 4)
                                                                    AS pct_of_all_exec_ms,
             encode(sha256(convert_to(s.query,'UTF8')),'hex')       AS query_sha256,
             length(s.query)                                        AS query_length,
             left(regexp_replace(s.query, '\\s+', ' ', 'g'), 200)   AS query_prefix
        FROM pg_stat_statements s, t
       ORDER BY s.total_exec_time DESC
       LIMIT 40
    `,
  },
  {
    id: 'R3',
    title: 'The addendum’s named categories, re-derived',
    why: 'Claims A4–A18. Each category is a NAMED pattern; the matched queryids are emitted beside the total so the categorisation can be audited rather than trusted.',
    sql: `
      WITH t AS (SELECT sum(total_exec_time) AS all_ms FROM pg_stat_statements),
      cat AS (
        SELECT CASE
                 WHEN s.query ILIKE '%realtime.list_changes%'
                   OR s.query ILIKE '%pg_logical_slot%'
                   OR s.query ILIKE '%wal2json%'                        THEN 'realtime_changelog_read'
                 WHEN s.query ILIKE '%last_active_at%'                  THEN 'presence_write'
                 WHEN s.query ILIKE '%cron.job_run_details%'
                  AND (s.query ILIKE 'INSERT%' OR s.query ILIKE 'UPDATE%') THEN 'cron_log_write'
                 WHEN s.query ILIKE '%cron.job_run_details%'
                  AND s.query ILIKE 'DELETE%'                           THEN 'cron_log_purge'
                 WHEN s.query ILIKE '%pg_timezone_names%'               THEN 'schema_cache_timezones'
                 WHEN s.query ILIKE '%pg_publication_tables%'
                   OR s.query ILIKE '%pg_publication %'                 THEN 'schema_cache_publication'
                 WHEN s.query ILIKE '%pg_catalog.pg_proc%'
                   OR s.query ILIKE '%pg_catalog.pg_class%'
                   OR s.query ILIKE '%information_schema%'              THEN 'schema_cache_introspection'
                 WHEN s.query ILIKE '%process_post_jobs%'               THEN 'job_poll_process_post_jobs'
                 WHEN s.query ILIKE '%pgmq%' OR s.query ILIKE '%read_email_batch%'
                   OR s.query ILIKE '%email_send_state%'                THEN 'queue_read'
                 WHEN s.query ILIKE '%net.http_%' OR s.query ILIKE '%vault.decrypted_secrets%'
                                                                        THEN 'outbound_http_and_vault'
                 ELSE 'other'
               END                                                      AS category,
               s.queryid, s.calls, s.total_exec_time, s.mean_exec_time
          FROM pg_stat_statements s
      )
      SELECT c.category,
             count(*)                                               AS distinct_statements,
             sum(c.calls)                                           AS calls,
             round(sum(c.total_exec_time)::numeric, 3)              AS total_exec_ms,
             round((sum(c.total_exec_time)/60000.0)::numeric, 2)    AS total_exec_minutes,
             round(max(c.mean_exec_time)::numeric, 3)               AS slowest_mean_ms,
             round((100 * sum(c.total_exec_time) / NULLIF(t.all_ms,0))::numeric, 4)
                                                                    AS pct_of_all_exec_ms,
             (array_agg(c.queryid::text ORDER BY c.total_exec_time DESC))[1:10]
                                                                    AS top_queryids
        FROM cat c, t
       GROUP BY c.category, t.all_ms
       ORDER BY sum(c.total_exec_time) DESC
    `,
  },
  {
    id: 'T1',
    title: 'Per-table live rows, dead rows, churn and last vacuum',
    why: 'Claims A19–A25, and the "before" side of every dead-row gate in Phases 2 and 4.',
    sql: `
      SELECT s.schemaname                                           AS schema,
             s.relname                                              AS table_name,
             s.n_live_tup                                           AS live_rows,
             s.n_dead_tup                                           AS dead_rows,
             CASE WHEN (s.n_live_tup + s.n_dead_tup) = 0 THEN NULL
                  ELSE round(100.0 * s.n_dead_tup /
                             (s.n_live_tup + s.n_dead_tup), 2) END  AS dead_pct,
             s.n_tup_ins AS inserts, s.n_tup_upd AS updates,
             s.n_tup_del AS deletes, s.n_tup_hot_upd AS hot_updates,
             CASE WHEN s.n_tup_upd = 0 THEN NULL
                  ELSE round(100.0 * s.n_tup_hot_upd / s.n_tup_upd, 2)
             END                                                    AS hot_update_pct,
             s.seq_scan, s.idx_scan,
             to_char(s.last_autovacuum  AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_autovacuum_utc,
             to_char(s.last_autoanalyze AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_autoanalyze_utc,
             s.autovacuum_count, s.autoanalyze_count
        FROM pg_stat_all_tables s
       WHERE s.schemaname NOT IN ('pg_catalog','information_schema','pg_toast')
       ORDER BY s.n_dead_tup DESC, s.relname
    `,
  },
  {
    id: 'T2',
    title: 'Per-table and per-index bytes',
    why: 'Claims A29–A32. The index-to-table ratio is the review gate the addendum asks for.',
    sql: `
      SELECT n.nspname                                              AS schema,
             c.relname                                              AS table_name,
             c.reltuples::bigint                                    AS planner_rows,
             pg_table_size(c.oid)                                   AS table_bytes,
             pg_indexes_size(c.oid)                                 AS index_bytes,
             pg_total_relation_size(c.oid)                          AS total_bytes,
             pg_size_pretty(pg_table_size(c.oid))                   AS table_size,
             pg_size_pretty(pg_indexes_size(c.oid))                 AS index_size,
             CASE WHEN pg_table_size(c.oid) = 0 THEN NULL
                  ELSE round(pg_indexes_size(c.oid)::numeric
                             / pg_table_size(c.oid), 3) END         AS index_to_table_ratio,
             c.relreplident                                         AS replica_identity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
       ORDER BY pg_total_relation_size(c.oid) DESC
    `,
  },
  {
    id: 'T3',
    title: 'The ten largest relations, and each one’s share of the database',
    why: 'Claims A26 and A28 — "the largest table in the database is a cron log, 76 MB of 135 MB".',
    sql: `
      SELECT n.nspname AS schema, c.relname AS relation, c.relkind::text AS kind,
             pg_total_relation_size(c.oid)                          AS total_bytes,
             pg_size_pretty(pg_total_relation_size(c.oid))          AS total_size,
             round(100.0 * pg_total_relation_size(c.oid)
                   / NULLIF(pg_database_size(current_database()),0), 2)
                                                                    AS pct_of_database
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r','m','p')
         AND n.nspname NOT IN ('pg_toast')
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT 10
    `,
  },
  {
    id: 'I1',
    title: 'Every index, with its scan count and size',
    why: 'The raw population behind I2. C-2 is a hard hold; the raw list is what will eventually reconcile it.',
    sql: `
      SELECT s.schemaname AS schema, s.relname AS table_name,
             s.indexrelname AS index_name,
             s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
             pg_relation_size(s.indexrelid)                         AS index_bytes,
             i.indisunique                                          AS is_unique,
             i.indisprimary                                         AS is_primary,
             i.indisvalid                                           AS is_valid,
             pg_get_indexdef(s.indexrelid)                          AS definition
        FROM pg_stat_all_indexes s
        JOIN pg_index i ON i.indexrelid = s.indexrelid
       WHERE s.schemaname NOT IN ('pg_catalog','information_schema','pg_toast')
       ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC
    `,
  },
  {
    id: 'I2',
    title: 'C-2 HARD HOLD — four named methods, four numbers, never one',
    why: 'Claim A39. The addendum records 79 / 78 / 298-of-which-125 / 188 and forbids any index being dropped until they reconcile. This probe reproduces the disagreement rather than picking a winner.',
    sql: `
      SELECT 'M1_public_idx_scan_zero'                              AS method,
             'pg_stat_all_indexes.idx_scan = 0, schema public only' AS definition,
             count(*)                                               AS n
        FROM pg_stat_all_indexes WHERE schemaname = 'public' AND idx_scan = 0
      UNION ALL
      SELECT 'M2_public_idx_scan_zero_excl_constraint',
             'as M1, excluding primary keys and unique constraints',
             count(*)
        FROM pg_stat_all_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
       WHERE s.schemaname = 'public' AND s.idx_scan = 0
         AND NOT i.indisprimary AND NOT i.indisunique
      UNION ALL
      SELECT 'M3_all_schemas_idx_scan_zero',
             'idx_scan = 0 across every non-system schema',
             count(*)
        FROM pg_stat_all_indexes
       WHERE schemaname NOT IN ('pg_catalog','information_schema','pg_toast')
         AND idx_scan = 0
      UNION ALL
      SELECT 'M4_all_schemas_idx_scan_zero_excl_constraint',
             'as M3, excluding primary keys and unique constraints',
             count(*)
        FROM pg_stat_all_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
       WHERE s.schemaname NOT IN ('pg_catalog','information_schema','pg_toast')
         AND s.idx_scan = 0 AND NOT i.indisprimary AND NOT i.indisunique
      UNION ALL
      SELECT 'M5_total_indexes_any_scan_count',
             'every index in every non-system schema, denominator for all of the above',
             count(*)
        FROM pg_stat_all_indexes
       WHERE schemaname NOT IN ('pg_catalog','information_schema','pg_toast')
    `,
  },
  {
    id: 'P1',
    title: 'Publications and their member tables',
    why: 'Claim A33. P3 corrects this "in both directions"; the parity check in Phase 3 compares it against D2’s subscription scan.',
    sql: `
      SELECT p.pubname                                              AS publication,
             p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,
             p.puballtables                                         AS all_tables,
             pt.schemaname                                          AS schema,
             pt.tablename                                           AS table_name
        FROM pg_publication p
        LEFT JOIN pg_publication_tables pt ON pt.pubname = p.pubname
       ORDER BY p.pubname, pt.schemaname, pt.tablename
    `,
  },
  {
    id: 'P2',
    title: 'REPLICA IDENTITY per published table',
    why: 'Claim A34, and the entire "before" side of P2. d = default (primary key), f = FULL, n = nothing, i = index.',
    sql: `
      SELECT n.nspname AS schema, c.relname AS table_name,
             c.relreplident                                         AS replica_identity,
             CASE c.relreplident WHEN 'd' THEN 'default (primary key)'
                                 WHEN 'f' THEN 'FULL (whole-row photocopy)'
                                 WHEN 'n' THEN 'nothing'
                                 WHEN 'i' THEN 'index' END          AS meaning,
             EXISTS (SELECT 1 FROM pg_publication_tables pt
                      WHERE pt.schemaname = n.nspname
                        AND pt.tablename  = c.relname)              AS in_a_publication,
             (SELECT s.n_tup_upd FROM pg_stat_all_tables s
               WHERE s.schemaname = n.nspname AND s.relname = c.relname) AS updates
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
         AND (c.relreplident <> 'd'
              OR EXISTS (SELECT 1 FROM pg_publication_tables pt
                          WHERE pt.schemaname = n.nspname AND pt.tablename = c.relname))
       ORDER BY c.relreplident DESC, n.nspname, c.relname
    `,
  },
  {
    id: 'S1',
    title: 'SECURITY DEFINER functions, classified trigger / guarded / unguarded',
    why: 'Claim A35, and the population P32 and P33 work through. SECURITY DEFINER bypasses RLS entirely — the WHERE clause is the only control — so anon-executable + volatile is the row that matters.',
    sql: `
      SELECT n.nspname                                              AS schema,
             p.proname                                              AS function_name,
             pg_get_function_identity_arguments(p.oid)              AS arguments,
             p.prosecdef                                            AS security_definer,
             p.provolatile::text                                    AS volatility,
             p.proconfig                                            AS config,
             has_function_privilege('anon',           p.oid, 'EXECUTE') AS anon_execute,
             has_function_privilege('authenticated',  p.oid, 'EXECUTE') AS authenticated_execute,
             has_function_privilege('service_role',   p.oid, 'EXECUTE') AS service_role_execute,
             length(p.prosrc)                                       AS body_length,
             -- The addendum's three classes, and the RULE that assigns them,
             -- emitted beside every row so the classification is re-derivable:
             --   trigger   → returns trigger; fired by the table, not callable
             --   guarded   → the body text contains an identity check
             --   unguarded → it does not. "Unguarded" is a statement about the
             --               source text, established by reading it, never by
             --               invoking the function (the addendum's own rule).
             CASE WHEN p.prorettype = 'trigger'::regtype THEN 'trigger'
                  WHEN p.prosrc ~* '(auth\\.(uid|role|jwt)\\(|is_admin|has_role|is_staff|is_judge|current_setting\\(''request\\.jwt|session_user|auth_user_id|require_(admin|auth|role|session))'
                       THEN 'guarded'
                  ELSE 'unguarded' END                              AS classification,
             'trigger = prorettype is trigger; guarded = prosrc matches auth.(uid|role|jwt)( | is_admin | has_role | is_staff | is_judge | current_setting(request.jwt | session_user | auth_user_id | require_*; unguarded = neither'
                                                                    AS classification_rule
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.prokind = 'f'
         AND n.nspname NOT IN ('pg_catalog','information_schema')
         AND p.prosecdef
       ORDER BY (has_function_privilege('anon', p.oid, 'EXECUTE')
                 AND p.provolatile = 'v') DESC, n.nspname, p.proname
    `,
  },
  {
    id: 'S1b',
    title: 'Function counts by class',
    why: 'The totals A35 is compared against, and the anon-volatile count P32 must drive to a justified number.',
    sql: `
      SELECT count(*)                                                            AS functions_total,
             count(*) FILTER (WHERE p.prosecdef)                                 AS security_definer,
             count(*) FILTER (WHERE p.provolatile = 'v')                         AS volatile,
             count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon_executable,
             count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
                                AND p.provolatile = 'v')                         AS anon_executable_volatile,
             count(*) FILTER (WHERE p.prosecdef
                                AND has_function_privilege('anon', p.oid, 'EXECUTE')) AS definer_and_anon,
             count(*) FILTER (WHERE p.prosecdef AND p.proconfig IS NULL)          AS definer_without_search_path,
             count(*) FILTER (WHERE p.prosecdef AND p.prorettype = 'trigger'::regtype) AS definer_trigger,
             count(*) FILTER (WHERE p.prosecdef AND p.prorettype <> 'trigger'::regtype
                                AND p.prosrc ~* '(auth\\.(uid|role|jwt)\\(|is_admin|has_role|is_staff|is_judge|current_setting\\(''request\\.jwt|session_user|auth_user_id|require_(admin|auth|role|session))')
                                                                                 AS definer_guarded,
             count(*) FILTER (WHERE p.prosecdef AND p.prorettype <> 'trigger'::regtype
                                AND p.prosrc !~* '(auth\\.(uid|role|jwt)\\(|is_admin|has_role|is_staff|is_judge|current_setting\\(''request\\.jwt|session_user|auth_user_id|require_(admin|auth|role|session))')
                                                                                 AS definer_unguarded,
             count(*) FILTER (WHERE p.prosecdef AND p.prorettype <> 'trigger'::regtype
                                AND has_function_privilege('anon', p.oid, 'EXECUTE')
                                AND p.prosrc !~* '(auth\\.(uid|role|jwt)\\(|is_admin|has_role|is_staff|is_judge|current_setting\\(''request\\.jwt|session_user|auth_user_id|require_(admin|auth|role|session))')
                                                                                 AS definer_unguarded_and_anon
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.prokind = 'f' AND n.nspname NOT IN ('pg_catalog','information_schema')
    `,
  },
  {
    id: 'S2',
    title: 'Triggers',
    why: 'Claim A36. Trigger count is part of why each schema-cache redraw is expensive.',
    sql: `
      SELECT count(*)                                               AS triggers_total,
             count(*) FILTER (WHERE NOT t.tgisinternal)             AS user_triggers,
             count(*) FILTER (WHERE t.tgisinternal)                 AS internal_triggers
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    `,
  },
  {
    id: 'S3',
    title: 'Policies, and the duplicate-permissive count with its method stated',
    why: 'Claim A37 (384 across 82 tables). "One permissive policy per table per action per role" is the standard; this counts every instance that breaks it, and states the counting rule in the output so the number is re-derivable.',
    sql: `
      WITH expanded AS (
        SELECT p.schemaname, p.tablename, p.cmd, p.permissive,
               unnest(CASE WHEN p.roles = '{0}' THEN ARRAY['public'] ELSE p.roles END) AS role_name,
               p.policyname
          FROM pg_policies p
      ), grp AS (
        SELECT schemaname, tablename, cmd, role_name, count(*) AS n
          FROM expanded WHERE permissive = 'PERMISSIVE'
         GROUP BY 1,2,3,4
      )
      SELECT 'permissive policies sharing (table, action, role); an instance is one policy beyond the first in such a group'
                                                                    AS counting_rule,
             (SELECT count(*) FROM pg_policies)                     AS policies_total,
             (SELECT count(DISTINCT schemaname||'.'||tablename) FROM pg_policies) AS tables_with_policies,
             (SELECT coalesce(sum(n), 0) FROM grp WHERE n > 1)      AS rows_in_duplicate_groups,
             (SELECT coalesce(sum(n - 1), 0) FROM grp WHERE n > 1)  AS duplicate_instances,
             (SELECT count(*) FROM grp WHERE n > 1)                 AS duplicate_groups,
             (SELECT count(DISTINCT schemaname||'.'||tablename)
                FROM grp WHERE n > 1)                               AS tables_affected
    `,
  },
  {
    id: 'S4',
    title: 'RLS state per table',
    why: 'P33 retires two leftover RLS tables. Which two is a measurement, not a memory.',
    sql: `
      SELECT n.nspname AS schema, c.relname AS table_name,
             c.relrowsecurity                                       AS rls_enabled,
             c.relforcerowsecurity                                  AS rls_forced,
             (SELECT count(*) FROM pg_policies p
               WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = 'public'
       ORDER BY c.relrowsecurity, c.relname
    `,
  },
  {
    id: 'S5',
    title: 'Policies whose expression calls auth.uid() without a select wrapper',
    why: 'Bare auth.uid() re-evaluates per row; (select auth.uid()) does not. This is the per-row tax X1/X2/P34 exist to remove, and the "before" count for it.',
    sql: `
      SELECT p.schemaname AS schema, p.tablename AS table_name,
             p.policyname AS policy, p.cmd, p.permissive,
             (p.qual        ~* 'auth\\.uid\\(\\)')                    AS qual_uses_auth_uid,
             (p.qual        ~* 'select\\s+auth\\.uid\\(\\)')          AS qual_wraps_in_select,
             (p.with_check  ~* 'auth\\.uid\\(\\)')                    AS check_uses_auth_uid,
             (p.with_check  ~* 'select\\s+auth\\.uid\\(\\)')          AS check_wraps_in_select
        FROM pg_policies p
       WHERE (p.qual ~* 'auth\\.uid\\(\\)' AND p.qual !~* 'select\\s+auth\\.uid\\(\\)')
          OR (p.with_check ~* 'auth\\.uid\\(\\)' AND p.with_check !~* 'select\\s+auth\\.uid\\(\\)')
       ORDER BY 1, 2, 3
    `,
  },
  {
    id: 'C1',
    title: 'Scheduled jobs',
    why: 'Claim A38, and the direct cause of the cron log in T3. The command text is redacted by the runner before it is written.',
    sql: `
      SELECT j.jobid, j.schedule, j.jobname, j.active, j.database, j.username,
             length(j.command)                                      AS command_length,
             left(regexp_replace(j.command, '\\s+', ' ', 'g'), 300)  AS command_prefix
        FROM cron.job j ORDER BY j.jobid
    `,
  },
  {
    id: 'C2',
    title: 'cron.job_run_details volume and retention',
    why: 'Claims A26 and A28. Seven days of history occupying 56 % of the database is the finding; this re-takes both halves of it.',
    sql: `
      SELECT count(*)                                               AS rows_held,
             to_char(min(start_time) AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS oldest_utc,
             to_char(max(start_time) AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS newest_utc,
             round(extract(epoch FROM (max(start_time) - min(start_time)))/86400.0, 2) AS days_retained,
             pg_total_relation_size('cron.job_run_details')          AS total_bytes,
             pg_size_pretty(pg_total_relation_size('cron.job_run_details')) AS total_size,
             round(100.0 * pg_total_relation_size('cron.job_run_details')
                   / NULLIF(pg_database_size(current_database()),0), 2) AS pct_of_database
        FROM cron.job_run_details
    `,
  },
];

// ── Argument parsing ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { target: null, outDir: 'docs/evidence/d1/baseline', printSql: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--out') out.outDir = argv[++i];
    else if (a === '--print-sql') out.printSql = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function wrap(sql) {
  return `
    SELECT coalesce(
             jsonb_agg(
               to_jsonb(t) || jsonb_build_object(
                 'measured_at_utc',
                 to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
             ),
             '[]'::jsonb)::text
      FROM (${sql}) t`;
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }

  if (args.help) {
    console.log('node scripts/db-baseline.mjs --target staging|production [--out <dir>] [--print-sql]');
    process.exit(0);
  }

  if (args.printSql) {
    // Connects to nothing. Exists so the probe set can be reviewed, diffed and
    // run by hand by whoever holds the credential — which is never this script's
    // author.
    for (const p of PROBES) {
      console.log(`-- ═══ ${p.id} · ${p.title}`);
      console.log(`-- ${p.why}`);
      console.log(`${wrap(p.sql).trim()};`);
      console.log('');
    }
    process.exit(0);
  }

  if (!args.target) {
    console.error('--target is required: staging or production.');
    process.exit(2);
  }

  let dsn;
  try {
    dsn = requireDsn();
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  let ref;
  try {
    ref = assertLane(args.target, dsn);           // control 1
  } catch (e) {
    console.error(scrub(e.message));
    process.exit(1);
  }
  console.log(`Lane OK: credential points at '${ref}', which matches target '${args.target}'.`);

  const controls = [];
  try {
    controls.push(proveReadOnly(dsn));            // control 2
    console.log('Read-only negative control fired as required (SQLSTATE 25006).');
    controls.push(proveFingerprint(dsn, args.target)); // control 3
    console.log(`Cluster fingerprint matches: ${LANES[args.target].system_identifier}.`);
  } catch (e) {
    console.error(scrub(e.message));
    process.exit(1);
  }

  const probes = [];
  for (const p of PROBES) {
    process.stdout.write(`  ${p.id} … `);
    let rows = null;
    let error = null;
    try {
      const res = psql(dsn, wrap(p.sql));
      rows = JSON.parse(res.stdout.trim() || '[]');
    } catch (e) {
      // A probe that cannot run is recorded as BLOCKED with its error. It is
      // not silently dropped, and it does not stop the other probes: a partial
      // baseline that says which part is missing is worth more than none.
      error = scrub(e.message);
    }
    probes.push({
      id: p.id,
      title: p.title,
      why: p.why,
      sql: p.sql.trim(),
      status: error ? 'BLOCKED' : 'MEASURED',
      error,
      row_count: rows ? rows.length : null,
      rows: rows ? redactSecrets(rows) : null,
    });
    console.log(error ? 'BLOCKED' : `${rows.length} row(s)`);
  }

  const finishedAt = new Date().toISOString();
  const artefact = {
    artefact: 'd1-phase0-baseline',
    schema_version: 1,
    gate: 'A committed baseline for every unit that claims a number, with the timestamp of measurement on every line.',
    unit: 'Phase 0 · D1 · baseline',
    owner: 'D1 · Database & Runtime',
    lane: args.target,
    project_ref: ref,
    instrument: {
      script: 'scripts/db-baseline.mjs',
      transport: 'psql (postgresql-client) over the session pooler, one statement per invocation',
      node: process.version,
      read_only:
        'Each read-only statement is sent wrapped as `BEGIN READ ONLY; <sql>; COMMIT;`, proved by a '
        + 'negative control that must come back SQLSTATE 25006. PGOPTIONS '
        + 'default_transaction_read_only=on is ALSO set, but F-78 measured that it does not survive '
        + 'the Supabase session pooler (a startup-packet parameter the pooler does not forward), so it '
        + 'is belt-and-braces for a direct connection and is not what enforces read-only here.',
    },
    run: { started_utc: startedAt, finished_utc: finishedAt },
    controls,
    probes,
    addendum_recheck: {
      note:
        'Phase 0 requires the addendum’s own 2026-09-01 figures to be re-taken and any disagreement '
        + 'RECORDED, NOT RESOLVED. Each claim below names the probe whose output answers it. This file '
        + 'states the claims and the measurements; it deliberately offers no explanation for any gap.',
      source_documents: [
        'claude/MASTER_PLAN_ADDENDUM_A_FORENSIC_2026-09-01.md',
        'claude/DB_LOAD_PART_2_WHAT_ACTUALLY_EATS_THE_DATABASE_2026-09-01.md',
      ],
      measured_by: 'Developer 2 / Session 2, read-only against production, 2026-09-01 10:44Z–11:22Z',
      counter_window_at_source: '2026-07-22T16:00:58Z onward, 41 days, 15,885,787 queries',
      claims: ADDENDUM_CLAIMS,
    },
  };

  const stamp = finishedAt.replace(/[:.]/g, '-');
  const outPath = join(args.outDir, args.target, `baseline-${stamp}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artefact, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${outPath}`);
  console.log(`Probes measured: ${probes.filter((p) => p.status === 'MEASURED').length}/${probes.length}`);

  const blocked = probes.filter((p) => p.status === 'BLOCKED');
  if (blocked.length > 0) {
    console.log(`BLOCKED probes (recorded in the artefact, not hidden): ${blocked.map((p) => p.id).join(', ')}`);
    process.exit(3); // distinct from a control failure, so CI can tell them apart
  }
}

// Exported so a test can import the probe set and the gate functions without
// running anything. `The failing test comes first` needs something to call.
export { PROBES, ADDENDUM_CLAIMS, wrap };
export { LANES, refParsedFromDsn, assertLane, scrub, scrubExternal } from './db-lane-guard.mjs';

// Only run when invoked directly, never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
