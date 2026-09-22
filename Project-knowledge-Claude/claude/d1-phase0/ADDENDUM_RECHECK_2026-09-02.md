# D1 · Phase 0 — the addendum's 2026-09-01 figures, re-taken 2026-09-02

**Unit** Phase 0 · D1 · "Re-run the addendum's own queries and record whether each of its
2026-09-01 figures still holds. **Disagreements are recorded, not resolved.**"

**Lane** production `jtdtehuqtinjxropkkcn` · read-only · no writes, no DDL, no function calls.

---

## What this document is, and what it is not

**It is not the Phase 0 gate evidence.** The gate reads *"a committed baseline for every unit that
claims a number, with the timestamp of measurement on every line"*, and that artefact is produced by
`scripts/db-baseline.mjs` running through `.github/workflows/d1-baseline.yml` with the Environment
credential. **That script has never been run end to end**, because running it needs
`SUPABASE_DB_URL`, and D1 does not hold it. That is a BLOCKED item, stated here rather than worked
around.

**It is the "Also" half of Phase 0**, which is a different obligation and one I can discharge today.

**The instrument is named, and it is not the same instrument.** Every number in the *measured*
column below was read by me through the Supabase MCP `execute_sql` transport against production,
between **2026-09-02 06:38Z and 06:57Z**, with `SELECT` and `EXPLAIN` only. Every number in the
*addendum* column is **RELAYED** from two documents I did not produce:

- `claude/MASTER_PLAN_ADDENDUM_A_FORENSIC_2026-09-01.md`
- `claude/DB_LOAD_PART_2_WHAT_ACTUALLY_EATS_THE_DATABASE_2026-09-01.md`

both taken by Developer 2 / Session 2, read-only against the same project, 2026-09-01 10:44Z–11:22Z.

**A note on what "one day later" means.** `pg_stat_statements` was **not** reset between the two
readings — `stats_reset` is `2026-07-22T16:00:58Z` in both, which the addendum states and I measured
independently. So the counters are cumulative over 41.6 days, and a *larger* absolute number one day
later is expected. Shares of total are the comparable figures; absolute counts are not.

**One thing the addendum could not state and this reading can.** `pg_stat_statements_info.dealloc`
is **0**, with 3,845 statements tracked against a capacity of 5,000. Nothing has been evicted, so
every percentage below divides by a complete denominator. Had `dealloc` been non-zero, every share —
including the headline 50.9 % and 66.7 % — would have had an unknown denominator. It is worth
recording that it does not.

---

## 1 · The runtime load

Counter window `2026-07-22T16:00:58Z` → now, **41.62 days**.

| | addendum · 2026-09-01 | measured · 2026-09-02 06:54Z | verdict |
|---|---|---|---|
| counter window opened | 2026-07-22 16:00:58Z | **2026-07-22T16:00:58Z** | **HOLDS** (exact) |
| statements evicted | not stated | **0** of capacity 5,000; 3,845 tracked | **NEW** — the denominator is complete |
| total statements executed | 15,885,787 | **16,195,898** | HOLDS (+310,111 in ~20 h, cumulative counter) |
| total database execution time | 9 h 26 m | **9.618 h** = 9 h 37 m | HOLDS |
| realtime change-log read · calls | 1,440,771 | **1,471,424** | HOLDS |
| realtime change-log read · ms | 17,271,544 | **17,590,801** | HOLDS |
| **realtime change-log read · share** | **50.9 %** | **50.81 %** | **HOLDS** |
| `pg_timezone_names` · executions / mean | 2,744 / 798 ms | **2,798 / 798.5 ms** | **HOLDS** |
| cron purge · executions / mean ms | 41 / 6,436 | **42 / 6,426.6** | **HOLDS** |
| `process_post_jobs` · executions / time | 701,116 / 46 m | **715,447 / 47.3 m** | **HOLDS** |
| presence write · slow variant mean | 72 ms | **73.0 ms** | **HOLDS** |
| presence write · calls / ms | 12,740 / 843,574 | **39,823 / 943,650** | **DISAGREES** — see §1.1 |
| publication-list check · executions | 28,624 | **88,153** | **DISAGREES** — see §1.1 |
| queue read · executions | 702,154 | **1,074,822** | **DISAGREES** — see §1.1 |
| outbound HTTP helper · executions | 422,342 | **1,388,363** | **DISAGREES** — see §1.1 |
| cron log write · calls / time / share | 2,249,208 / 17 m / 3.0 % | **5,737,989 / 12.4 m / 2.15 %** | **DISAGREES** — more calls, less time |
| schema-cache group · time / share | 58 m / 10.3 % | **57.0 m / 9.89 %** | HOLDS in aggregate |
| "work no member asked for" | 66.7 % | **65.58 %** on the addendum's four categories | see §1.2 |

### 1.1 · The four disagreements, stated and not explained away

All four are in the same direction — my number is larger — and all four are categories where **my
matching rule is broader than the addendum's**. I am recording that as an observation about the two
instruments, not as a resolution: I did not see the addendum's queries, only its numbers, so I
cannot assert that the populations differ. **Two instruments that disagree have not been
reconciled until someone compares them per-item, and nobody has.** (Standing rule 5: matching totals
are never evidence of agreement — and neither are differing ones evidence of a change.)

What can be said with certainty is what my categories are, because they ship in the instrument
(`scripts/db-baseline.mjs`, probe R3) with the matched `queryid`s beside every total, so the
categorisation is auditable rather than trusted.

### 1.2 · The 66.7 % has no subject in the execution master

`docs/ADDENDUM_A_EXECUTION_MASTER.md` §5 names four headline figures — 66.7 %, 50.9 %, 580,000
requests, 64.2 % dead rows — and **defines none of them in that document**. 50.9 % is attached to
Phase 2 and 580,000 to Phase 3 by proximity; 66.7 % and 64.2 % appear once each, in the sentence
above, with no referent. Their subjects exist only in the two source documents, which are project
docs and not in the repository. **Recorded as a documentation finding for the Auditor**, not fixed
by me — `docs/` under the execution master is not mine to edit.

Summing the addendum's own four categories on today's reading gives **65.58 %**
(realtime 50.81 + schema-cache 9.89 + cron log 2.15 + presence 2.73). Adding the three polling
categories the addendum discusses but did not include in that subtotal — job poll 8.20, queue read
5.97, outbound HTTP/vault 4.14 — gives **83.89 %**. Both numbers are in this file deliberately. Which
one the programme should track is a decision, not a measurement.

### 1.3 · One reading nobody has recorded before

The `outbound_http_and_vault` category's slowest statement has a **mean execution time of 26,672.8
ms** — twenty-six seconds, averaged over the window. That is not a percentage of anything; it is a
single statement that takes half a minute every time it runs. It is adjacent to P9 (vault secret
decrypted once per worker) and P5 (polling), and it is **not** in the addendum. Raised here for the
Auditor to route; not investigated, because investigating it is not a Phase 0 task.

---

## 2 · Tables, dead rows and churn

Measured 2026-09-02 06:56Z.

| table | addendum · live/dead/% | measured · live/dead/% | last autovacuum (measured) | verdict |
|---|---|---|---|---|
| `profiles` | 106 / 68 / **64.2 %** | **107 / 25 / 18.9 %** | **2026-09-02 06:08Z** | **DISAGREES** — see below |
| `user_devices` | 333 / 75 / 22.5 %, never tidied | **334 / 83 / 19.9 %** | **never (NULL)** | HOLDS — never tidied, confirmed |
| `user_notifications` | 4,266 / 797 / 18.7 % | **4,314 / 825 / 16.1 %** | 2026-08-28 12:06Z | HOLDS |
| `activity_logs` | 8,778 / 1,278 / 14.6 % | **8,855 / 1,314 / 12.9 %** | **2026-08-19 15:00Z** | **HOLDS** (date exact) |
| `profiles` HOT updates | 2,178 of 13,989 | **2,180 of 14,092** | — | **HOLDS** |
| `profiles_public_data` HOT | 13,846 of 13,989 | **13,949 of 14,092** | — | **HOLDS** |

**On the 64.2 %.** An adjacent measured fact, offered as an observation and **not** as a resolution:
`profiles` was autovacuumed at **2026-09-02 06:08Z**, forty-eight minutes before I read it. A
dead-row ratio is a point-in-time reading between vacuums, not a steady state, and the two readings
were taken at different points in that cycle. Whether 64.2 % was a peak or a change is a question a
single pair of readings cannot answer — it needs the ratio sampled repeatedly, which is exactly what
**P1's gate already requires**: *"the `profiles` dead-row ratio measured below 10 % for seven
consecutive days."* One reading below 10 % would not close that gate, and this one is 18.9 % anyway.

---

## 3 · Sizes

| | addendum | measured 2026-09-02 06:56Z | verdict |
|---|---|---|---|
| whole database | 135 MB | **135 MB** | **HOLDS** |
| `cron.job_run_details` | 76 MB, 56 % of the database | **77 MB, 56.7 %** | **HOLDS** |
| `profiles` table / index | 112 kB / 184 kB | **152 kB / 184 kB** | index HOLDS; table larger |
| `competition_entries` | 0 rows, 48 kB / 712 kB | **0 live, 20 dead, 176 kB / 712 kB** | **index HOLDS exactly** |
| `judge_decisions` | 0 rows, 0 B / 208 kB | **0 live, 24 kB / 208 kB** | **index HOLDS exactly** |
| `feed_events` | 216 / 544 kB | **256 / 568 kB** | close |
| `ad_impressions` | 72 / 200 kB | **104 / 200 kB** | index HOLDS |
| `posts` | 576 / 944 kB | **616 / 944 kB** | **index HOLDS exactly** |
| `email_send_log` | 1,320 / 1,656 kB | **1,360 / 1,656 kB** | **index HOLDS exactly** |

Five of six index sizes are byte-identical to the addendum's a day later, which is what one expects
of indexes on tables nobody has re-indexed — and it is a useful cross-check that the two readings
are of the same database.

The second-largest relation is `public.db_audit_logs` at 7,592 kB (5.5 %), which the addendum does
not mention. `net._http_response` is fourth at 3,928 kB (2.8 %).

---

## 4 · Publication, replica identity, security surface

| | addendum | measured 2026-09-02 06:56Z | verdict |
|---|---|---|---|
| tables in `supabase_realtime` | 29 | **29** | **HOLDS** |
| `REPLICA IDENTITY FULL` | `profiles`, `scheduled_posts`, `competition_round_publish` | **`competition_round_publish`, `profiles`, `scheduled_posts`** | **HOLDS — same three, exactly** |
| `SECURITY DEFINER` functions | 329 | **332** | **DISAGREES** (+3) |
| triggers | 149 | **157** | **DISAGREES** (+8) |
| anon-executable volatile functions | "eight" (P32) | **188** in `public` | **DISAGREES** — different population, see below |

The 188 is every `public` function that is `VOLATILE` **and** on which the `anon` role holds
`EXECUTE`. P32's "eight unauthenticated volatile functions" is evidently a narrower set — probably
those additionally reachable without a session, which is a property of the API layer and not of
`has_function_privilege`. **I am not resolving which is right.** P32's population must be defined
before its SQL is written, and defining it is Phase 1 work with D2's call-site inventory in hand.

The +3 functions and +8 triggers are the kind of drift that either means something landed between
the two readings or means the two counts were scoped differently. `git log` shows no migration
applied to production in that window, which makes the second explanation the boring one — and the
boring one is the one to look at first. Recorded, not resolved.

---

## 5 · C-2 — the hard hold. Four numbers, one population, two axes.

The execution master records C-2 as a **hard hold**: *"Four methods produced four numbers
(79 / 78 / 298-of-which-125 / 188). No index is dropped by anyone until those reconcile."*

Five counting methods, each named, run against production at **2026-09-02 06:56Z**:

| method | definition | n |
|---|---|---|
| **M1** | `pg_stat_all_indexes.idx_scan = 0`, schema `public` only | **188** |
| **M2** | as M1, excluding primary keys and unique constraints | **78** |
| **M3** | `idx_scan = 0` across every non-system schema | **298** |
| **M4** | as M3, excluding primary keys and unique constraints | **125** |
| **M5** | every index in every non-system schema — the denominator | **594** |

**Three of the four disputed numbers, and the fourth's "of which", fall out of one population
counted on two axes: schema scope (`public` only vs all non-system) × constraint indexes included or
excluded.**

- 188 = M1 · public, everything
- 78 = M2 · public, excluding constraints
- 298 = M3 · all schemas, everything
- 125 = M4 · all schemas, excluding constraints — exactly the addendum's "298-of-which-125"

**The fifth number, 79, is not reproduced.** It differs from M2 by one. That is a one-index question
— an index that was scanned once between the two readings, an invalid index counted differently, or
a boundary in the original query — and it is a much smaller question than a four-way disagreement.

**⚠ C-2 IS NOT CLOSED BY THIS DOCUMENT AND CANNOT BE.** I am D1. The execution master makes the
reconciliation *"its own Phase 4 unit with its own gate"*, and §25.4 discipline is that a developer
does not close what a developer measured. What is offered here is a candidate reconciliation, with
its methods named so the Auditor can re-run them, and the one residual isolated. **No index is
dropped by anyone. Any PR that drops one before the Auditor rules is closed.**

---

## 6 · Status of every line above

| class | meaning | count |
|---|---|---|
| **VERIFIED** | measured personally, through the named instrument, at the stated time | every *measured* column |
| **RELAYED** | taken from D2's 2026-09-01 documents; not re-derived by me | every *addendum* column |
| **BLOCKED** | `scripts/db-baseline.mjs` has never been run end to end — no credential | the gate artefact |
| **NEW** | measured here, absent from the addendum | `dealloc = 0`; the 26.7-second statement; `db_audit_logs` |

*Measured by D1 (Database & Runtime), read-only against production `jtdtehuqtinjxropkkcn`,
2026-09-02 06:38Z–06:57Z, through the Supabase MCP `execute_sql` transport. No writes, no schema
changes, no migrations, no deployments, no function invocations. Repository state at the time of
writing: `origin/main` `950e6dd6`, `origin/staging` `f648533c`, `compare/main..staging` = 0/0/0.*
