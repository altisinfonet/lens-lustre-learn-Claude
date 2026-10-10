# D1 · Phase 0 · 0-D1-02 — the addendum's figures, re-taken

**Task (phase-wise plan 0-D1-02):** *"Re-run the Addendum's own queries behind every number a P-unit claims (P1, P2, P3, P4, P5, P6, P7, P8, P9, P19, P26, P27, P28, P32, P33, P34, P35) and record for each whether the 2026-09-01 figure still holds. Disagreements are recorded, not resolved."*

**Done when:** *"one row per figure — Addendum value, today's value, timestamp, holds / moved. A figure that moved is a finding, not an error to tidy."*

**Lane** production `jtdtehuqtinjxropkkcn` · **SELECT only** · no writes, no DDL, no DML, no function invoked.

---

## Instrument, and what this document is not

**Instrument for every *today* cell:** Supabase MCP `execute_sql`, `SELECT` statements only, against production, by D1, in two sittings on 2026-09-02 — **06:38Z–06:57Z** and **11:42Z–11:46Z**. Each row carries the UTC minute its reading was taken.

**Source of every *addendum* cell:** `claude/MASTER_PLAN_ADDENDUM_A_FORENSIC_2026-09-01.md` and `claude/DB_LOAD_PART_2_WHAT_ACTUALLY_EATS_THE_DATABASE_2026-09-01.md`, both by Developer 2 / Session 2, read-only against the same project, 2026-09-01 10:44Z–11:22Z. Those cells are **RELAYED**; I did not re-derive them.

**This is not the 0-D1-01 gate artefact.** That is the JSON `scripts/db-baseline.mjs` writes when run with the Environment credential, and it has not been produced: the script has never run end to end. **BLOCKED** on `SUPABASE_DB_URL` (H-4 — and the Auditor reports the staging credential now fails authentication after the ref gate passes). The 21 probes were validated one by one against staging with `SELECT`; nothing here is simulated.

**Counters are cumulative.** `pg_stat_statements` was not reset between the two readings — `stats_reset` = `2026-07-22T16:00:58Z` in both. Absolute counts one day later are expected to be larger; shares of total are the comparable figures. `dealloc` = **0** against a capacity of 5,000 (3,845 tracked), so every percentage divides by a complete denominator. That could have been false; it is not, and it should be re-checked on every baseline run (N-2).

**Verdict vocabulary.** `HOLDS` — the same reading, or the expected cumulative growth of an unreset counter. `MOVED` — a different reading, recorded and not explained. `NEW` — a reading the addendum did not take. `N/A` — not measurable by SQL from this lane. The word *resolved* does not appear in a verdict column.

---

## P1 · Presence removed from the durable write path

| figure | addendum · 2026-09-01 | today | measured (UTC) | verdict |
|---|---|---|---|---|
| presence-write statements · calls | 12,740 (two variants) | **39,823** (every statement matching `last_active_at`) | 06:54 | **MOVED** — my match rule is broader; the Auditor's R2 note reads it as probably more `pg_stat_statements` rows, not a 3× rise. Pin by fingerprint, not count (R2) |
| presence-write statements · total ms | 843,574 | **943,650** | 06:54 | HOLDS (cumulative) |
| presence write · slow variant mean | 72 ms | **73.0 ms** | 06:54 | **HOLDS** |
| `profiles` live / dead / dead % | 106 / 68 / **64.2 %** | **107 / 25 / 18.9 %** | 06:56 | **MOVED**. Adjacent measured fact, offered not as the reason: `last_autovacuum` = **2026-09-02 06:08Z**, 48 min before this reading |
| `profiles` HOT updates of total | 2,178 of 13,989 | **2,180 of 14,092** | 06:56 | **HOLDS** |
| `profiles_public_data` HOT of total | 13,846 of 13,989 | **13,949 of 14,092** | 06:56 | **HOLDS** |
| `profiles` table / index bytes | 112 kB / 184 kB | **152 kB / 184 kB** | 06:56 | index HOLDS; table MOVED |

## P2 · Replica identity corrected on published tables

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| realtime change-log read · calls | 1,440,771 | **1,471,424** | 06:54 | HOLDS (cumulative) |
| realtime change-log read · total ms | 17,271,544 | **17,590,801** | 06:54 | HOLDS (cumulative) |
| **realtime change-log read · share of all exec time** | **50.9 %** | **50.81 %** | 06:54 | **HOLDS** |
| tables on `REPLICA IDENTITY FULL` | `profiles`, `scheduled_posts`, `competition_round_publish` | **`competition_round_publish`, `profiles`, `scheduled_posts`** | 06:56 | **HOLDS** — same three, exactly |
| tables in `supabase_realtime` | 29 | **29** | 06:56 | **HOLDS** |

## P3 · Subscription-to-publication parity

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| tables published | 29 | **29** | 06:56 | **HOLDS** |
| tables the app subscribes to · unpublished (11) · unconsumed (8) | 32 · 11 · 8 | — | — | **N/A for D1** — the app-side count is D2's `scripts/web-subscription-scan.mjs` (Phase 3). The DB-side list is in the baseline probe P1 |

## P4 · Configuration served from the edge

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| `site_settings` statements · calls in window | ≈580,000 | **591,718** across 84 distinct statements | 11:42 | **HOLDS** |
| `site_settings` live rows | 35 | **35** | 11:42 | **HOLDS** |
| unfiltered full-table reads of `site_settings` | 6,437 calls at 4.2 ms | **13,211** calls with no `WHERE` in the statement text | 11:42 | **MOVED** — a different filter (`!~* 'WHERE'`) than the addendum's; recorded, not reconciled |
| `site_settings` seq / idx scans | not stated | **166,647 / 425,955** (28.1 % sequential) | 11:42 | NEW |

## P5 · Polling replaced by events

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| active scheduled jobs | 16 | **16** | 11:43 | **HOLDS** |
| `process-post-jobs` cadence | every 5 s | **`5 seconds`** (jobid 12) | 11:43 | **HOLDS** |
| `process-email-queue` cadence | every 10 s | **`10 seconds`** (jobid 3) | 11:43 | **HOLDS** |
| `publish-scheduled-posts` cadence | every minute | **`* * * * *`** (jobid 11) | 11:43 | **HOLDS** |
| `process_post_jobs(100)` · executions / time | 701,116 / 46 m | **715,447 / 47.3 m** | 06:54 | HOLDS (cumulative) |
| queue-read executions | 702,154 | **1,074,822** | 06:54 | **MOVED** — my category (`pgmq` ∪ `read_email_batch` ∪ `email_send_state`) is broader than the addendum's single statement |
| `email_send_state` (0 rows) reads | 351,031 | inside the 1,074,822 above; not isolated | 06:54 | not separately re-derived |

## P6 · Cron run-log retention

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| `cron.job_run_details` size | 76 MB | **77 MB** | 06:56 | **HOLDS** |
| share of the database | 56 % | **56.7 %** | 06:56 | **HOLDS** |
| rows | 202,082 | **193,024** (planner estimate `reltuples`; an exact `count(*)` on this table was not run from this transport) | 06:56 | HOLDS within estimate |
| purge · executions / mean ms | 41 / 6,436 | **42 / 6,426.6** | 06:54 | **HOLDS** |
| purge job schedule | not stated | **`purge-cron-history` at `0 3 * * *`** (jobid 13) | 11:43 | NEW — consistent with 41 runs over 41 days |
| cron-log write · calls / time / share | 2,249,208 / 17 m / 3.0 % | **5,737,989 / 12.4 m / 2.15 %** | 06:54 | **MOVED** — more calls, less time; category rule differs |
| whole database | 135 MB | **135 MB** | 06:56 | **HOLDS** |

## P7 · Schema-cache reload discipline

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| three introspection queries · time / share | 58 m / 10.3 % | **57.0 m / 9.89 %** (timezones 37.2 m + introspection 10.1 m + publication 9.7 m) | 06:54 | **HOLDS** in aggregate |
| `pg_timezone_names` · executions / mean | 2,744 / 798 ms | **2,798 / 798.5 ms** | 06:54 | **HOLDS** |
| publication-list check · executions | 28,624 | **88,153** | 06:54 | **MOVED** — my pattern (`pg_publication_tables` ∪ `pg_publication `) is broader |

## P8 · Autovacuum tuned on the churning tables

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| `profiles` dead % | 64.2 % | **18.9 %** | 06:56 | **MOVED** (see P1) |
| `user_devices` live / dead / %; last autovacuum | 333 / 75 / 22.5 %; **never** | **334 / 83 / 19.9 %; NULL** | 06:56 | **HOLDS** — never tidied, confirmed |
| `user_notifications` | 4,266 / 797 / 18.7 % | **4,314 / 825 / 16.1 %**; last autovac 2026-08-28 12:06Z | 06:56 | HOLDS |
| `activity_logs`; last autovacuum | 8,778 / 1,278 / 14.6 %; 2026-08-19 | **8,855 / 1,314 / 12.9 %; 2026-08-19 15:00Z** | 06:56 | **HOLDS** — date exact |

## P9 · Vault secret decrypted once per worker

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| outbound HTTP helper · executions | 422,342 | **1,388,363** (category `net.http_` ∪ `vault.decrypted_secrets`) | 06:54 | **MOVED** — broader category |
| slowest statement in that group · mean | not stated | **26,672.8 ms** | 06:54 | **NEW** — routed by the Auditor to P9 (R2); not investigated |

## P19 · Read-through cache tier — the hot read paths

| table | addendum · seq-scan share | today · seq / idx · share | live rows | measured | verdict |
|---|---|---|---|---|---|
| `stories` | 86 % | **24,160 / 4,231 · 85.1 %** | 38 | 11:42 | **HOLDS** |
| `competitions` | 97 % | **23,552 / 641 · 97.4 %** | 0 | 11:42 | **HOLDS** |
| `competition_votes` | 99.5 % | **19,802 / 102 · 99.5 %** | 0 | 11:42 | **HOLDS** — exact |
| `image_comments` | 96 % | **19,061 / 754 · 96.2 %** | 0 | 11:42 | **HOLDS** |
| `gift_announcements` | 100 % | **16,816 / 3 · 100.0 %** | 2 | 11:42 | **HOLDS** |

## P26 · Audit-log scope and retention

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| audit triggers | 17 of 149 | **13** user triggers whose function name contains `audit` (of 157 user triggers) | 11:43 | **MOVED** — both numerator and denominator differ; my selector is a name match, the addendum's is not stated |
| audit row shape | two full row copies | `db_audit_logs` columns: `id, table_name, operation, row_id, old_data, new_data, changed_by, created_at` | 11:43 | **HOLDS** — `old_data` and `new_data` both present |
| `db_audit_logs` size | not stated | **7,592 kB, 5.5 % of the database** — the second-largest relation | 06:56 | NEW |

## P27 · Leftover tables and backups retired

| figure | addendum / plan | today | measured | verdict |
|---|---|---|---|---|
| the thirteen named tables + `categories_migration_dropped` | 13 (+1 from P33) | **13 present, 1 ABSENT: `wallet_ledger_v2_shadow_log`** | 11:42 | **MOVED** — the plan's list names a table that does not exist on production today. Present, with sizes: `_v3_preflight_snapshot_competition_entries` 8 kB · `_v3_preflight_snapshot_judge_decisions` 8 kB · `_v3_preflight_snapshot_judge_tag_assignments` 0 B · `_v3_preflight_snapshot_judging_tags` 16 kB · `_v3_quarantine_decisions` 16 kB · `_v3_quarantine_tag_assignments` 16 kB · `categories_migration_dropped` 8 kB · `judging_preflight_log` 64 kB · `posts_dead_host_backup_20260812` 24 kB · `round_snapshots` 128 kB · `v3_mirror_log` 168 kB · `wallet_ledger_v2_diff_log` 1,504 kB · `wallet_ledger_v2_rows` 80 kB |

## P28 · Index-to-table ratio as a review gate

| table | addendum · table / index | today | measured | verdict |
|---|---|---|---|---|
| `competition_entries` | 0 rows, 48 kB / 712 kB | **0 live (20 dead), 176 kB / 712 kB** | 06:56 | index HOLDS exactly; table MOVED |
| `judge_decisions` | 0 rows, 0 B / 208 kB | **0 live, 24 kB / 208 kB** | 06:56 | index HOLDS exactly |
| `feed_events` | 216 / 544 kB | **256 / 568 kB** | 06:56 | close |
| `ad_impressions` | 72 / 200 kB | **104 / 200 kB** | 06:56 | index HOLDS |
| `posts` | 576 / 944 kB | **616 / 944 kB** | 06:56 | index HOLDS exactly |
| `email_send_log` | 1,320 / 1,656 kB | **1,360 / 1,656 kB** | 06:56 | index HOLDS exactly |

## P32 · Unauthenticated write and compute endpoints

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| the eight named VOLATILE anon-executable functions | 8 (`get_broadcast_feed` "both forms") | **9 signatures, all `vol=v secdef=true anon=true`**: `_gen_competition_order_no()`, `get_broadcast_feed` × **3** overloads (2-, 3- and 4-argument), `increment_managed_page_view(text)`, `recompute_entry_from_tag_assignments(uuid)`, `recompute_entry_public_status(uuid)`, `record_test_agent_run(…15 args)`, `set_write_path(text)` | 11:43 | **MOVED** — "both forms" is three forms on the catalogue |
| all anon-executable VOLATILE functions in `public` | not stated as a total | **188** | 06:56 | NEW — the named eight are a subset; the population P32 must define is the Phase 1 question |

## P33 · Compromised-password protection, and the catalogue

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| leaked-password protection | OFF | — | — | **N/A** — an Auth dashboard setting, not readable by SQL; the Auditor verifies in a real browser (1-AU-05) |
| the four definer views | `entry_public_status`, `judge_decisions_owner_safe`, `judge_tag_assignments_owner_safe`, `judge_comments_owner_safe` | all four exist; **`security_invoker` false/off on every one** — they are definer views | 11:43 | **HOLDS** |
| `plpgsql_check` schema | `public` | **`public`** | 11:43 | **HOLDS** |
| two leftover RLS-enabled tables | `categories_migration_dropped`, `posts_dead_host_backup_20260812` | both present, both `rls=true`. Grants: `categories_migration_dropped` anon SELECT **false**, authenticated **false**; `posts_dead_host_backup_20260812` anon SELECT **true**, authenticated **true** | 11:43 | **HOLDS** that they exist; **NEW** — the grant asymmetry is recorded for 1-D1-07, not chased here (RLS is on; a grant alone does not read rows) |
| `get_primary_admin_user_id()` | anon-callable | **`vol=s secdef=true anon=true`** | 11:43 | **HOLDS** |
| `email_exists`, `search_certificates`, `verify_staff_id` (P30/P31 adjacent) | anon-callable | **all three `anon=true`** | 11:43 | **HOLDS** — the Phase 1 "before" |
| `SECURITY DEFINER` functions | 329 | **332** | 06:56 | **MOVED** (+3). Classified today: **118 trigger · 92 guarded · 122 unguarded**, of which **66 unguarded and anon-executable** — rule stated in probe S1 |
| triggers | 149 | **157** user triggers | 06:56 | **MOVED** (+8) |

## P34 · Role checks made index-only

| figure | addendum | today | measured | verdict |
|---|---|---|---|---|
| `user_roles` sequential scans | 234,546 | **235,524** (idx 194,063 · 54.8 % sequential) | 11:42 | **HOLDS** (+978 in ~25 h) |
| statements in `pg_stat_statements` touching `user_roles` | — | **53 statements, 13,855 calls** | 11:42 | NEW — 235,524 scans against 13,855 visible calls is the addendum's point measured: the scans come from inside policies, where the profiler cannot see them |
| duplicate permissive policy instances / tables | 384 / 82 | not re-counted in this sitting — the counting rule is in probe S3 and runs with the baseline | — | **DEFERRED to the 0-D1-01 artefact** |
| policies re-evaluating bare `auth.uid()` per row | 29 | staging reads **63** rows from probe S5; production not run in this sitting | — | **DEFERRED to the 0-D1-01 artefact** |

## P35 · Primary keys and catalogue hygiene

| figure | addendum / plan | today | measured | verdict |
|---|---|---|---|---|
| tables without a primary key | 6 | **6**: `_v3_preflight_snapshot_competition_entries`, `_v3_preflight_snapshot_judge_decisions`, `_v3_preflight_snapshot_judge_tag_assignments`, `_v3_preflight_snapshot_judging_tags`, `categories_migration_dropped`, `posts_dead_host_backup_20260812` | 11:42 | **HOLDS** — exact list |
| duplicate index pairs | `idx_feed_events_post` / `idx_feed_events_post_id`; `judge_decisions_entry_judge_round_photo_unique` / `judge_decisions_unique_per_judge_round_photo` | **all four present** | 11:42 | **HOLDS** |
| `post_hashtags.author_id` indexed | not indexed | one index mentions it: `idx_post_hashtags_author ON post_hashtags (hashtag_id, author_id)` — **`author_id` is the second column**, so no index leads on it | 11:42 | **HOLDS** for a lookup by `author_id` alone; recorded so the Phase 4 unit does not build a second composite |

## C-2 · Hard hold H-1 — reproduced, not released

| method | scope | n | measured |
|---|---|---|---|
| M1 | `public`, `idx_scan = 0`, every index | **188** | 06:56 |
| M2 | `public`, excluding primary-key and unique-constraint indexes | **78** | 06:56 |
| M3 | every non-system schema, every index | **298** | 06:56 |
| M4 | every non-system schema, excluding PK/unique | **125** | 06:56 |
| M5 | denominator — every index in every non-system schema | 594 | 06:56 |

Four of the addendum's five numbers fall out of one population on two axes; **79 does not** — off by one from M2. The Auditor has recorded this as `EVIDENCE FILED`, not `VERIFIED`, and **the hold stands: no index is dropped by anyone.**

---

## Readings the addendum did not take

| reading | value | measured | routed to |
|---|---|---|---|
| `pg_stat_statements_info.dealloc` | **0** of 5,000 capacity, 3,845 tracked | 06:54 | N-2 — re-check on every baseline |
| a statement in the outbound-HTTP/vault group · mean exec | **26,672.8 ms** | 06:54 | P9 (Auditor's R2 routing) |
| second-largest relation | `public.db_audit_logs` 7,592 kB · 5.5 % | 06:56 | P26 |
| fourth-largest relation | `net._http_response` 3,928 kB · 2.8 % | 06:56 | P9 / P5 |
| Postgres patch level, both lanes | staging `17.6.1.155` · production `17.6.1.141`; production **aarch64**, staging **x86_64** | 06:38 | N-1 — and the architecture difference is new: a timing taken on staging is taken on a different CPU family than production's |
| cluster fingerprints | production `7656985631720456337` · staging `7666007964130682852` | 06:38 | N-3 |

---

## Status of every line

| class | applies to |
|---|---|
| **VERIFIED** | every *today* cell — measured personally through the named instrument at the stated UTC minute |
| **RELAYED** | every *addendum* cell |
| **N/A** | P3's app-side count (D2's), P33's Auth toggle (dashboard) |
| **DEFERRED** | P34's policy counts, which the 0-D1-01 artefact carries and which were not re-counted in this sitting |
| **BLOCKED** | the 0-D1-01 gate artefact itself — no credential |

*D1 · Database & Runtime · production `jtdtehuqtinjxropkkcn` · SELECT only · 2026-09-02 06:38Z–06:57Z and 11:42Z–11:46Z. Repository at the time of writing: `origin/staging` `ef5d4a37`, `origin/main` `a9f1e862`.*
