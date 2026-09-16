# What actually eats the database — part 2

**All figures measured by me against production `jtdtehuqtinjxropkkcn` on 2026-09-01 between 10:48Z and 10:57Z.**
The performance counters cover **2026-07-22 16:00:58Z → 2026-09-01 10:55Z (41 days)**, with roughly **106 real members** on the system.
Every negative statement below is stamped with the moment I looked. Nothing here is copied from the plan or from anyone's report — it is what the database says about itself.

---

## The headline, in one sentence

In 41 days the database did **9 hours 26 minutes** of actual work.
**Two thirds of it was the system talking to itself.** Almost none of it was a member asking for anything.

| What the work was | Time | Share of all database work |
|---|---|---|
| The live-updates ("realtime") engine reading the change log | **4 h 48 m** | **50.9 %** |
| The API re-learning the shape of your database over and over | 58 m | 10.3 % |
| Writing a diary entry for every scheduled-job run | 17 m | 3.0 % |
| "User is still online" heartbeat writes | 14 m | 2.5 % |
| — subtotal, work no member asked for — | **6 h 17 m** | **66.7 %** |

15.9 million queries were run in those 41 days. That is about **387,000 queries a day for 106 people**. A member did not make 3,650 requests a day. The machine did.

---

## 1. The live-updates engine is half your database bill — and it is set to its most expensive setting

**What I measured (as of 2026-09-01 10:52Z):** one single query — the one the realtime engine uses to read the change log — ran **1,440,771 times** and consumed **17,271,544 milliseconds**, i.e. **4 hours 48 minutes**, **50.9 % of every millisecond the database spent on anything**.

**Why it is that expensive.** 29 tables are published to realtime. One of them, `profiles`, is set to **REPLICA IDENTITY FULL**.

In plain language: normally, when a row changes, the database writes a short note in its change log — "row 47 changed, here is the new value". With FULL turned on, it instead writes **a complete photocopy of the entire row, before and after, every single time**. Then the realtime engine has to read that whole photocopy, run every security rule against it, and decide who is allowed to see it — for every connected user.

`profiles` is also the **most-updated table in the whole publication**: 13,991 updates. So the biggest, most expensive row format is attached to the busiest table. Two other tables are also on FULL (`scheduled_posts`, `competition_round_publish`), but they barely move.

**Why 400 million members breaks this.** This cost does not grow with members — it grows with **members × changes × subscribers**. Today 106 people produce 1.44 million decode operations. The relationship is multiplicative. You do not need 400 million to feel it; you need a few thousand simultaneously-online members before this alone saturates the database, and no amount of caching helps because it is write-side work.

**The better way.** Take `profiles` off REPLICA IDENTITY FULL (use the primary key, which is the default). Take tables off the realtime publication unless a screen genuinely needs live updating — a "courses" row that changed 3 times in 41 days does not need a live channel. For things that are genuinely live (notifications, new posts), send a small "something changed, id 47" signal and let the app fetch the detail, instead of streaming whole rows through the security engine.

---

## 2. The "is this user still online" write is quietly the most damaging small thing in the system

**What I measured (as of 2026-09-01 10:52Z):** an update that sets `last_active_at` (and sometimes `last_platform`) on the `profiles` table ran **12,740 times** across two variants and took **843,574 ms — 14 minutes**. The slow variant averages **72 milliseconds per single-row update**. On a table with 106 rows. A single-row update on a 106-row table should take well under a millisecond.

**What that write sets off, in order:**

1. It writes a new copy of the row (Postgres never edits in place).
2. Because `profiles` carries more index than table — 184 kB of indexes on a 112 kB table — the write also has to update the indexes, so it cannot use the cheap "in-page" shortcut. Measured: **only 2,178 of 13,989 updates were efficient**. Its twin table `profiles_public_data` had the *same* 13,989 updates and **13,846 of them were efficient**. Same number of writes, wildly different cost — the difference is the index and column layout on `profiles`.
3. Because `profiles` is REPLICA IDENTITY FULL (item 1 above), a full photocopy of the row goes into the change log.
4. The realtime engine then decodes it and security-checks it for every subscriber.
5. The old row copy is left behind as garbage. Measured **2026-09-01 10:50Z: `profiles` is 64.2 % dead rows** — 106 live rows and 68 dead ones.

So a cosmetic green dot costs a table write, several index writes, a full-row log entry, and a fan-out to every listener.

**Why 400 million members breaks this.** This one is linear in *active* members and repeats on a timer. At 400 M members with even 1 % online, it is the single largest write source in the system, and each write drags the four consequences above behind it.

**The better way.** Presence does not belong in a durable table at all. Keep it in memory (Redis, or the realtime service's own presence feature), write it to the database at most every few minutes if you need it for reporting, and never put the presence column on a table that is published to realtime.

---

## 3. Over half the database is the log of the robots

**What I measured (as of 2026-09-01 10:53Z):** `cron.job_run_details` — the table that records every scheduled-job run — holds **202,082 rows and 76 MB**. The whole database is 135 MB. **The diary of the scheduled jobs is 56 % of your database.**

The oldest entry is 2026-08-25 03:00Z, the newest 2026-09-01 10:53Z: **seven days of history occupies 76 MB.** That is roughly **28,800 new rows a day**, which matches the schedule exactly — one job every 5 seconds, one every 10 seconds, one every minute.

Writing that diary is not free either: **1,124,604 inserts and 1,124,604 updates** to this table in the measurement window, **17 minutes** of database time, **3.0 % of everything**, purely to record that a job ran.

And the clean-up is worse than the mess. The purge runs as one enormous delete: **41 executions, 1,130,456 rows removed, averaging 6,436 milliseconds each**. Every few hours the database stops for six and a half seconds to take out the bin.

**Why 400 million members breaks this.** It doesn't scale with members — it is a fixed cost — but that is the point: **you are paying it today, at 106 members, and it already outweighs your entire real dataset.** When real data arrives, this log is competing with it for memory and disk cache. Every page of job-diary in memory is a page of member data not in memory.

**The better way.** Cut the retention to 24–48 hours, delete in small batches instead of one giant sweep, and — the real fix — stop the two hot polls (below), which is where 90 % of these rows come from.

---

## 4. The system polls itself 26,000 times a day for work that is almost never there

**What I measured (as of 2026-09-01 10:48Z):** 16 active scheduled jobs. Two of them are hot:

- **every 5 seconds** — `process_post_jobs(100)`. Measured **701,116 executions, 46 minutes** of database time.
- **every 10 seconds** — an HTTP call to `process-email-queue`.
- **every minute** — `publish-scheduled-posts`.

The queue-read that the 5-second job triggers ran **702,154 times**. The outbound HTTP helper ran **422,342 times**, and each of those calls **decrypts a secret from the vault inline, 422,342 times**.

This is the direct, complete explanation for the finding in my previous report that an **empty** table (`email_send_state`, 0 rows) had been read **351,031 times**. Nobody was doing anything. A robot was asking "anything for me?" every ten seconds, around the clock, and being told no.

**Plain language:** this is polling. It is the difference between checking your letterbox every ten seconds and having the postman ring the bell. The letterbox approach costs the same whether there is post or not.

**Why 400 million members breaks this.** The polling loop itself is a fixed cost — that part is fine. The problem is what sits underneath it: at 400 M members the queue is never empty, so every one of those 17,280 daily wake-ups now does real work, in batches of 100, single-file, on the same database that is serving members. You have chosen a design whose throughput ceiling is fixed by a clock rather than by demand.

**The better way.** Event-driven, not clock-driven: when something is queued, wake the worker (Postgres `LISTEN/NOTIFY`, or a real queue service). Where polling must stay, back it off when idle — 5 seconds when busy, 60 when empty. And decrypt the vault secret once per worker, not once per message.

---

## 5. The API keeps re-learning what your database looks like

**What I measured (as of 2026-09-01 10:52Z):** three internal "what tables and functions exist?" queries together cost **58 minutes — 10.3 % of all database work**. The worst single one is `SELECT name FROM pg_timezone_names`: **2,744 executions, averaging 798 milliseconds each**, returning 3.28 million rows in total. Another checks the realtime publication list **28,624 times**.

**Plain language:** every time the database's shape changes — or something *tells* the API it changed — the API throws away its map and redraws it from scratch. Redrawing the map is expensive. It is being redrawn thousands of times.

**Why 400 million members breaks this.** Each redraw briefly stalls API requests. Today that is invisible. Under load it is a periodic latency spike that will look like a random outage and will be extremely hard to diagnose, because the cause is a maintenance action, not traffic.

**The better way.** Stop triggering schema-cache reloads at runtime — no DDL, no `NOTIFY pgrst` outside deploys. This is closely related to the **329 SECURITY DEFINER functions** and **149 triggers** I reported earlier: a large, constantly-touched schema surface is what makes each redraw so costly.

---

## 6. Housekeeping that has never run

**What I measured (as of 2026-09-01 10:50Z):**

| Table | Live rows | Dead rows | Dead % | Last auto-tidy |
|---|---|---|---|---|
| `profiles` | 106 | 68 | **64.2 %** | — |
| `user_devices` | 333 | 75 | 22.5 % | **never** |
| `user_notifications` | 4,266 | 797 | 18.7 % | — |
| `activity_logs` | 8,778 | 1,278 | 14.6 % | 2026-08-19 |

**Plain language:** when Postgres changes a row it leaves the old copy behind and tidies up later, in the background. "64 % dead" means that for every real profile the database is also carrying two-thirds of a stale one — and reads have to step over them. `user_devices` has been written 6,781 times and **has never been tidied at all**, as of 2026-09-01 10:50Z.

**Why 400 million members breaks this.** Dead rows are the classic scaling cliff: performance is fine, fine, fine, then falls off a wall when the tidy-up can no longer keep pace with the writes. The high-churn tables here are exactly the ones that will grow fastest.

**The better way.** Make autovacuum more aggressive per-table on the churny tables (`profiles`, `user_devices`, `user_notifications`), and reduce the churn at source — items 2 and 4 above are most of it.

---

## 7. Indexes that cost more than the data they index

**What I measured (as of 2026-09-01 10:48Z):**

- `competition_entries` — **0 rows**, 48 kB of table, **712 kB of indexes**. Fifteen times more index than table, indexing nothing.
- `judge_decisions` — **0 rows**, 0 bytes of table, **208 kB of indexes**.
- `feed_events` — 216 kB of table, 544 kB of index.
- `ad_impressions` — 72 kB of table, 200 kB of index.
- `posts` — 576 kB of table, 944 kB of index.
- `email_send_log` — 1,320 kB of table, 1,656 kB of index.

This sits alongside the earlier finding of **188 indexes that have never been used once** (the plan states 79).

**Plain language:** an index is an extra copy of part of your data, kept sorted so lookups are fast. Every index makes reads faster and **every write slower**, because the write has to update every index too. An index nobody reads is pure cost — and it is the reason the `profiles` heartbeat write in item 2 cannot take the cheap path.

**Why 400 million members breaks this.** Write cost is multiplied by index count. On the write-heavy tables you are paying that multiplier on every single insert, forever, for lookups that never happen.

**The better way.** Drop the never-used indexes (concurrently, in production), and treat the index-to-table ratio as a review gate. `posts` and `email_send_log` carrying more index than data is a warning sign that will get much louder at scale.

---

## The one thing to take from this

Everything above shares a single shape: **the system is doing work on a timer instead of in response to a member.**

A clock-driven system has a cost floor it pays at 3 a.m. with nobody logged in, and a throughput ceiling it cannot exceed at noon with everybody logged in. Right now, with 106 members, you are paying the floor — two thirds of your database. The ceiling is the part that will hurt at 400 million.

In rough order of what to fix first:

1. `profiles` off REPLICA IDENTITY FULL, and prune the realtime publication. *(fixes half the load)*
2. Presence out of the database. *(fixes the worst write, and the dead-row problem with it)*
3. The 5-second and 10-second polls become event-driven. *(fixes the job log, the empty-table scans and the vault churn together)*
4. Cron log retention down to 24–48 hours, batched deletes.
5. Drop the 188 unused indexes; tune autovacuum on the four churny tables.
6. Stop runtime schema-cache reloads.

None of these is a rewrite. Items 1, 4, 5 and 6 are configuration. Items 2 and 3 are a few days of work each. Together they remove about two thirds of your current database load before a single new member arrives.

---

*Measured by Developer 2 / Session 2, read-only, against production, 2026-09-01 10:48Z–10:57Z. Counter window 2026-07-22 16:00:58Z onward. No writes, no schema changes, no deployments were made. Status of every row above: VERIFIED (measured personally).*
