# 50mm Platform Master Plan — Addendum A

## Workstream P · Platform runtime, delivery and exposure
### 35 new units, 22 confirmations, 6 corrections

**Prepared for** Neil Basu · 50mm Retina World
**Date** 1 September 2026
**Extends** 50mm Platform Master Plan v4 · approval draft · 28 August 2026 (118 units, ten workstreams)
**Status** Proposed. Nothing here is approved; nothing here has been executed.

---

## How this document was produced — read this before the findings

**This is a forensic measurement report, not an opinion and not a checklist copied from best practice.**

Every number in this addendum was taken by me, from your own live systems, in a session on **1 September 2026 between 10:44 and 11:22 UTC**. Specifically:

| Source | What was done |
|---|---|
| Production database `jtdtehuqtinjxropkkcn` | Read-only SQL against the live catalogue and the live performance counters. `SELECT` only. |
| Performance counters | 41-day window, **2026-07-22 16:00:58Z → 2026-09-01 10:55Z**, covering 15,885,787 queries |
| Application source | Read at release candidate `a42b209e4f70a6efed4f3dcdb654e0f994416594`, in an isolated checkout |
| Vendor linter | Run against the same project; **every categorisation it produced was independently re-derived by my own query before being reported** |

**What was not done, deliberately:** no writes, no schema changes, no migrations, no deployments, no branch or commit or push. **No function was called** — where this document says a function is unguarded, it means *its source text contains no identity check*, established by reading its definition, not by invoking it against production.

**Every negative statement carries the time it was observed.** A measurement is only true at the moment it was taken, and this document says when.

**The reduction discipline.** Where an alarming reading had a boring explanation, I looked for the boring explanation first and report it in the same breath. Three findings in this addendum were *reduced* or *withdrawn* by that discipline, and one number is reported as an unresolved disagreement rather than as a fact. Those are marked. A report that only grows is not a measurement.

---

# PART A · NEW UNITS

Thirty-five units, none of which appear in the plan today. Each is written as the plan writes them — **ID · Work · Gate** — with the three things you asked for underneath: **what is now**, **why change it**, **what you get**.

---

## A1 · Runtime load — the system talking to itself

> **The headline this group exists to fix.** In 41 days your database performed **9 hours 26 minutes** of work. **6 hours 17 minutes of it — 66.7 % — was work no member asked for.** 15.9 million queries were run for roughly 106 members: about 387,000 a day. A member did not make 3,650 requests a day. The machine did. *(Measured 2026-09-01 10:48Z–10:57Z.)*

---

### P1 · Presence removed from the durable write path
**Gate — the evidence that closes it:** `profiles` receives no write from a client timer; presence is served from memory; `profiles` dead-row ratio measured below 10 % for seven consecutive days.
*Extends: nothing in the plan covers this.*

**WHAT IS NOW.** `src/hooks/core/useLastActive.ts` runs `setInterval(update, 5 * 60 * 1000)` in the browser and fires once more immediately on mount. `update` is a direct `UPDATE` on the `profiles` table. It is **per browser tab, not per member** — two tabs, two writes. Measured 2026-09-01 10:52Z: 12,740 such updates in the window, **averaging 72 milliseconds each** for a single-row update on a 106-row table. A single-row update on a 106-row table should take well under one millisecond.

**WHY I AM ASKING TO CHANGE IT.** Because of what each of those writes drags behind it, all measured:

1. `profiles` carries **184 kB of index on a 112 kB table**, so the write cannot take the cheap in-page path — **only 2,178 of 13,989 updates were efficient**. Its sibling `profiles_public_data` took the *same* 13,989 updates and **13,846 were efficient**. Same writes, entirely different cost.
2. `profiles` is set to **REPLICA IDENTITY FULL**, so a photocopy of the whole row goes into the change log every time (see P2).
3. The realtime engine then decodes that photocopy and security-checks it for every subscriber.
4. The old row copy is left as garbage: **`profiles` is 64.2 % dead rows** (106 live, 68 dead, measured 10:50Z).

Now the arithmetic you asked for. At **400 million members with just 1 % online** — 4 million tabs — that is 4,000,000 writes ÷ 300 seconds = **13,300 writes per second to a single table, forever**, each carrying the four consequences above. No Postgres table sustains that. It is not a question of a larger instance. **This is the single highest-risk line of code in the platform, and it exists to draw a green dot.**

**WHAT EXACTLY YOU GET.** The largest single write source in the system disappears. The `profiles` dead-row problem disappears with it, because the churn causing it is gone. The realtime engine stops decoding a full row photocopy every five minutes per tab. And the one line of code that would have stopped the platform at scale is no longer in the platform. The "last seen" feature survives — written once per session end, or batched server-side — so nothing visible to a member is lost.

---

### P2 · Replica identity corrected on published tables
**Gate:** no table in the realtime publication carries REPLICA IDENTITY FULL without a written justification; the realtime decode query's share of total database time is re-measured and recorded.
*Extends X5, which cuts the publication list but does not address row format.*

**WHAT IS NOW.** Measured 2026-09-01 10:52Z: **one single query — the realtime engine reading the change log — ran 1,440,771 times and consumed 17,271,544 milliseconds. That is 4 hours 48 minutes, and 50.9 % of every millisecond the database spent on anything.** Three published tables are set to REPLICA IDENTITY FULL: `profiles`, `scheduled_posts` and `competition_round_publish`. `profiles` is also the most-updated table in the publication, at 13,991 updates.

**WHY I AM ASKING TO CHANGE IT.** Normally a change writes a short note into the log — "row 47 changed, here is the new value". With FULL set, the database writes **a complete photocopy of the entire row, before and after, every single time**, and the realtime engine must read that whole photocopy and run every security rule against it for every connected member. The most expensive row format has been attached to the busiest table. This cost does not grow with members — it grows with **members × changes × subscribers**, which is multiplicative. You do not need 400 million to feel it; a few thousand simultaneously-online members saturates it, and no cache helps because it is write-side work.

**WHAT EXACTLY YOU GET.** The largest single consumer of your database — over half of it — is directly attacked at its cause. This is a configuration change, not code. Together with P1 and P3 it is the difference between paying for a platform that serves members and paying for one that talks to itself.

---

### P3 · Subscription-to-publication parity, enforced at build time
**Gate:** the build fails when the application subscribes to a table that is not published, or a table is published that nothing subscribes to. The current mismatch is resolved in both directions first.
*New. The plan's X5 and C11 shrink the publication; neither checks that the app and the database agree.*

**WHAT IS NOW.** Measured 2026-09-01 11:00Z–11:03Z. The app opens **56 `postgres_changes` subscriptions across 26 files**, covering 32 distinct tables. The database publishes **29**. I compared the two lists.

**Eleven tables the app listens to are not published at all** — and I confirmed all eleven *exist* in the database; they are simply not in the publication:

`ad_creative_reactions` · `admin_notifications` · `admin_vote_adjustments` · `badge_definitions` · `comments` · `judge_comments` · `judge_sessions` · `judge_tag_assignments` · `judging_preflight_log` · `role_display_config` · `site_settings`

**Eight tables are published that nothing listens to:**

`certificates` · `competitions` · `featured_artists` · `image_comments` · `image_reactions` · `journal_articles` · `photo_of_the_day` · `post_shares`

**WHY I AM ASKING TO CHANGE IT.** The eleven are **features that have never worked and never will.** The app opens a channel, registers a subscription, waits — and no event ever arrives. Nothing errors. Nothing logs. The screen quietly shows stale data until somebody reloads. That includes **`admin_notifications` — an admin alerting feature that silently does not alert.** This is the worst class of defect, because it looks like it works.

The eight are pure waste: every change to them is written into the change log, decoded and security-checked by the engine already consuming half your database, then discarded because nobody is listening.

**A third fault, in the same place.** Among the 56 subscriptions are permanently-open live channels on **configuration** tables — `site_settings` (35 rows), `role_display_config`, `badge_definitions`, `courses` and `support_tickets`. These are settings. Badge definitions and role display config change when an administrator decides they should: a handful of times a year. Each nonetheless holds an open WebSocket channel, per member, per tab, for the whole session, waiting for an event that arrives once a quarter. Multiply that by millions of tabs and you are paying for a standing army to wait for a letter. **Settings should be fetched once at boot and refreshed on a version bump — never subscribed to.**

**WHAT EXACTLY YOU GET.** Eleven silently broken features start working, or are honestly removed. Waste leaves the most expensive component in the system. And the class of defect is closed permanently: a machine checks the two lists agree, in one second, on every build — this should never again depend on a human noticing.

---

### P4 · Configuration served from the edge, not the database
**Gate:** `site_settings` read count from the API falls by at least two orders of magnitude; no unfiltered full-table read of `site_settings` remains in any code path.
*New. Complements X8 (read/write separation) but is not covered by it.*

**WHAT IS NOW.** Measured 2026-09-01 11:04Z, over the 41-day window, for a table with **35 rows**:

| Query shape | Calls |
|---|---|
| one setting by key | 352,665 |
| one setting by key (other variants) | 40,505 |
| several keys at once (the batched path) | 173,996 |
| **the entire table, no filter** | 6,437 — mean **4.2 ms** each |
| newest-updated probe | 6,444 |
| **total** | **≈ 580,000** |

That is **≈14,100 requests a day, for 106 members, to read 35 rows of configuration.** Underneath: **165,543 whole-table scans reading 5,793,341 rows**, alongside 415,381 efficient index lookups — about a third of reads walk the whole table rather than jumping to the key.

**WHY I AM ASKING TO CHANGE IT — and this is not a criticism of the caching work.** `src/lib/siteSettingsCache.ts` is genuinely well built: it caches per key, coalesces every key requested within one frame into a single query, and `useSiteSetting` waits for a shared bootstrap before falling through. Its own header records the win — 23 requests down to 1 on the feed. **The 580,000 is what survives a good in-memory cache**, because that cache is per tab and starts cold on every page load, every new tab, every refresh. Configuration reads scale with *sessions*, not with data — so 14,100 a day at 106 members becomes tens of millions a day, for 35 rows that are identical for every member on earth.

**WHAT EXACTLY YOU GET.** Roughly 580,000 database requests become approximately zero. Settings arrive from the CDN edge, faster than the database could ever serve them, cached near the member. The database stops answering the same question fourteen thousand times a day.

---

### P5 · Polling replaced by events
**Gate:** no scheduled job runs more often than once a minute unless it is demonstrably saturated; queue workers are woken by an event; idle back-off is implemented and its effect measured.
*New. Nothing in the plan governs job cadence.*

**WHAT IS NOW.** Measured 2026-09-01 10:48Z. Sixteen active scheduled jobs. Two are hot:

- **every 5 seconds** — `process_post_jobs(100)`: **701,116 executions, 46 minutes of database time**
- **every 10 seconds** — an HTTP call to `process-email-queue`
- **every minute** — `publish-scheduled-posts`

The queue read those trigger ran **702,154 times**. The outbound HTTP helper ran **422,342 times**.

This is the complete explanation for the finding in my first report that an **empty** table — `email_send_state`, zero rows — had been read **351,031 times**. Nobody was doing anything. A robot asked "anything for me?" every ten seconds, around the clock, and was told no.

**WHY I AM ASKING TO CHANGE IT.** This is polling: checking the letterbox every ten seconds instead of having the postman ring the bell. It costs the same whether there is post or not. The polling loop itself is a fixed cost — that part is survivable. The problem is the ceiling underneath it: **at scale the queue is never empty, so every one of those 17,280 daily wake-ups does real work, in batches of 100, single-file, on the same database that is serving members.** You have chosen a design whose throughput is limited by a clock rather than by demand.

**WHAT EXACTLY YOU GET.** Work happens when there is work. The empty-table scans stop entirely. The job log stops growing at 28,800 rows a day (P6). And the throughput ceiling is removed *before* you meet it, rather than discovered on the day the queue backs up.

---

### P6 · Cron run-log retention and batched purge
**Gate:** `cron.job_run_details` retention set to 24–48 hours; purge runs in bounded batches; the table is no longer among the ten largest in the database.
*Extends X11, which names the audit, activity and email logs — but not this one.*

**WHAT IS NOW.** Measured 2026-09-01 10:53Z: `cron.job_run_details` holds **202,082 rows and 76 MB**. The entire database is 135 MB. **The diary of the scheduled jobs is 56 % of your database.** Oldest entry 2026-08-25 03:00Z, newest 2026-09-01 10:53Z — **seven days of history occupies 76 MB**, about 28,800 new rows a day, which matches the job schedule exactly.

Writing it is not free: **1,124,604 inserts and 1,124,604 updates**, 17 minutes of database time, **3.0 % of everything**, purely to record that a job ran. And the clean-up is worse than the mess: the purge runs as one enormous delete — **41 executions, 1,130,456 rows removed, averaging 6,436 milliseconds each.** Every few hours the database stops for six and a half seconds to take the bin out.

**WHY I AM ASKING TO CHANGE IT.** It is a fixed cost that does not scale with members — and that is exactly the point. **You are paying it today, at 106 members, and it already outweighs your entire real dataset.** When real data arrives, this log competes with it for memory and cache. Every page of job-diary held in memory is a page of member data not held in memory.

**WHAT EXACTLY YOU GET.** Roughly half your database back, immediately. The six-second stalls end. Member data gets the memory the job log is currently occupying.

---

### P7 · Schema-cache reload discipline
**Gate:** no schema-cache reload is triggered outside a deployment; the introspection queries' share of database time is re-measured and recorded.
*New.*

**WHAT IS NOW.** Measured 2026-09-01 10:52Z: three internal "what tables and functions exist?" queries together cost **58 minutes — 10.3 % of all database work**. The worst is `SELECT name FROM pg_timezone_names`: **2,744 executions averaging 798 milliseconds each**, returning 3.28 million rows in total. Another checks the publication list **28,624 times**.

**WHY I AM ASKING TO CHANGE IT.** Every time the database's shape changes — or something merely *tells* the API it changed — the API discards its map of your database and redraws it from scratch. Redrawing is expensive, and it is being redrawn thousands of times. Each redraw briefly stalls API requests. Today that is invisible; under load it becomes a periodic latency spike that will look like a random outage and be very hard to diagnose, because the cause is a maintenance action rather than traffic. It is made worse by the size of the surface being introspected — **387 functions, 329 of them SECURITY DEFINER, and 149 triggers across 52 tables.**

**WHAT EXACTLY YOU GET.** A tenth of your database's total work stops. And a future class of mystery outage — intermittent, traffic-independent, unattributable — never happens.

---

### P8 · Autovacuum tuned on the churning tables
**Gate:** each named table's dead-row ratio measured below 10 % across a full week under normal traffic.
*New.*

**WHAT IS NOW.** Measured 2026-09-01 10:50Z:

| Table | Live | Dead | Dead % | Last auto-tidy |
|---|---|---|---|---|
| `profiles` | 106 | 68 | **64.2 %** | — |
| `user_devices` | 333 | 75 | 22.5 % | **never** |
| `user_notifications` | 4,266 | 797 | 18.7 % | — |
| `activity_logs` | 8,778 | 1,278 | 14.6 % | 2026-08-19 |

`user_devices` has been written **6,781 times and has never been tidied at all**, as of 2026-09-01 10:50Z.

**WHY I AM ASKING TO CHANGE IT.** When Postgres changes a row it leaves the old copy behind and tidies later. "64 % dead" means that for every real profile the database is also carrying two-thirds of a stale one, and every read must step over them. Dead rows are the textbook scaling cliff: fine, fine, fine, then a wall, at the moment the tidy-up can no longer keep pace with the writes. The tables above are precisely the ones that will grow fastest.

**WHAT EXACTLY YOU GET.** The cliff is removed before you reach it. Note that P1 removes most of the churn causing this — these two units are best done together, and P8 is what proves P1 worked.

---

### P9 · Vault secret decrypted once per worker, not once per message
**Gate:** the outbound HTTP helper no longer performs an inline `vault.decrypted_secrets` lookup per call.

**WHAT IS NOW.** Measured 2026-09-01 10:52Z: `net.http_post` ran **422,342 times**, and each of those calls decrypts a secret from the vault inline, as part of the same statement.

**WHY I AM ASKING TO CHANGE IT.** Decryption is not free, and it is being done 422,342 times to send messages that could share one decryption. It also means the secret is materialised on every single outbound call rather than once per worker lifetime — more work and a wider window than necessary.

**WHAT EXACTLY YOU GET.** Several hundred thousand needless decryptions removed, and a smaller exposure surface for the secret. Small on its own; free when P5 is being done anyway.

---

### P10 · Client timer discipline
**Gate:** no timer fires more often than once a second; every repeating timer is cleared on `visibilitychange`; battery and jank measured on a mid-range Android device before and after.
*Extends U4 (scroll performance and memory soak), which measures jank but does not govern timers.*

**WHAT IS NOW.** Measured 2026-09-01 10:59Z: **21 `setInterval` timers** in the source.

- `src/components/ads/AdZone.tsx` — **every 200 ms**, five times a second
- **six timers at 1 second** — countdowns, session timers, phase banners
- `src/hooks/feed/useFeedEventTracker.ts` — flushes every 5 seconds
- `src/hooks/core/useLastActive.ts` — every 5 minutes, and it writes to the database (P1)
- four React Query `refetchInterval` polls at 30 s, 30 s, 60 s, and 90 s during voting

**WHY I AM ASKING TO CHANGE IT.** A timer firing five times a second keeps the phone's processor awake and re-renders part of the screen 300 times a minute, for as long as an ad is on screen. On a laptop nobody notices. On a mid-range Android phone — your growth market — that is measurable battery drain and visible stutter.

**The pattern to copy already exists in your codebase.** `useEngagementHeartbeat.ts` *destroys* its timer when the tab is hidden rather than letting it fire uselessly, and its own comments explain exactly why. That discipline needs applying to the other twenty.

**WHAT EXACTLY YOU GET.** Longer battery life and a smoother feed on the phones most of your members will actually use — with a pattern already written, tested and documented inside your own repository.

---

## A2 · Front-end delivery — the plan says the delay is in the app, and then stops

> The plan states on page 17, in item U2: **"The server answers in 19 ms; the delay is in the app."** It then commits to *measuring* that delay (U2, U11) but never names a single cause or cure. The words **bundle size, code splitting, lazy loading, Cache-Control, ETag, stale-while-revalidate, Brotli, gzip, compression, AVIF, server-side rendering, prerender, hydration, Core Web Vitals, Lighthouse, LCP, font** appear **nowhere in 33 pages**. Every absence in this group was confirmed by searching the full text of the plan on 2026-09-01 at 10:17Z, including hyphenation variants — an earlier sweep of mine produced false negatives on hyphenation and was corrected before anything was asserted.
>
> Your kitchen cooks in 19 milliseconds. The waiter carries the whole menu, all the plates and the furniture to the table before serving. **The plan buys the waiter a stopwatch. It does not say "carry less."**

---

### P11 · The fast image component wired in, and bare `<img>` forbidden
**Gate:** `OptimizedImage` used on feed, profile and gallery surfaces; a lint rule rejects a bare `<img>` in `src/components` and `src/pages`; feed bytes on a 3G profile measured before and after against M11's budget.
*Extends M3/M4 (the derivative ladder) and M11 (the image performance budget).*

**WHAT IS NOW.** Measured 2026-09-01 11:05Z. `src/components/OptimizedImage.tsx` exists — 3,134 bytes, default-exported. It renders a `<picture>` with a WebP source and a JPEG fallback, gates loading on an IntersectionObserver with a 200 px margin, and shows a 256 px low-quality placeholder until the real image arrives. **It is imported by nothing.** I searched the entire source tree: the only matches outside the file itself are a test that mentions the filename inside a string. **Zero call sites.** The app renders **158 raw `<img>` tags** instead.

**WHY I AM ASKING TO CHANGE IT.** Someone built the fast-loading image component the plan calls for, and it was never wired into a single screen. On a photography platform, images *are* the product and *are* the page weight — this is the highest-value unused asset in the codebase.

In fairness, the raw tags are not naive: **136 of the 158 carry `loading=` within their first six lines** and `decoding=async` appears 144 times. The basics are there. What is missing is exactly what the unused component provides — the WebP `<picture>` path, the placeholder, and the observer. Note also that only **4 components** use responsive `srcSet` (`PostMedia`, `OptimizedImage`, `EntryCard`, `GalleryImage`) — and each of those correctly pairs `srcSet` with `sizes`, which is the detail most codebases get wrong. **The pattern is right. It is used in four places out of a hundred and fifty-eight.**

**WHAT EXACTLY YOU GET.** The single largest reduction in page weight available to you, using code that is already written, already reviewed and already in the repository. It is connection work, not invention.

---

### P12 · One translation chunk per language
**Gate:** selecting a language downloads that language only; the entry bundle and per-language chunk sizes recorded.

**WHAT IS NOW.** Measured 2026-09-01 11:01Z. `src/i18n/translations.rest.ts` is **527,720 bytes** and *is* correctly loaded with a dynamic `import()` from `I18nContext.tsx`, so English visitors never download it. **That fix is real and it was done well** — its own header records that it removed about 322 KB from a 1.47 MB entry bundle. But all six non-English dictionaries live in **that one file**.

**WHY I AM ASKING TO CHANGE IT.** A Hindi speaker downloads Hindi *and* Bengali *and* Tamil *and* the other three — **half a megabyte to read one sixth of it.** Your growth is in exactly the markets those dictionaries serve, on exactly the devices and networks where half a megabyte is expensive.

**WHAT EXACTLY YOU GET.** Roughly 85 KB instead of 515 KB for a non-English member. This is a file split, not a rewrite — perhaps a day's work.

---

### P13 · Bundle-size budget, binding, with code splitting as a written rule
**Gate:** a byte ceiling on the entry bundle and per-route chunks; a build that exceeds it **fails, it does not warn**, in the same style as M11.
*Extends U2 and U11, which measure the delay but never name the cause.*

**WHAT IS NOW.** The plan identifies the symptom precisely — "the server answers in 19 ms; the delay is in the app" — and commits only to measurement. Meanwhile the practice already exists in your code but is not a rule: `AdminCertificates.tsx` uses `await import(...)` to load the heavy PDF code only when needed, and there are **84 lazily-loaded routes across 69 route definitions**. The routing is properly split. But `src/components/WallPosts.tsx` is a **121,661-byte single component**, and the largest files are not governed by anything.

**WHY I AM ASKING TO CHANGE IT.** Measuring without naming the cure means the cure depends on whoever happens to look. Your team is already doing the right thing by instinct in some places and not others. **Make it a written rule with a byte budget, and it happens everywhere, permanently.**

**WHAT EXACTLY YOU GET.** The plan's own headline performance problem gets an owner and a number, and a regression cannot ship — which is precisely the standard the plan already applies to images in M11.

---

### P14 · Caching rules written down and enforced
**Gate:** `Cache-Control`, `ETag` and `stale-while-revalidate` policy stated per asset class and verified by fetch; the cache-hit target in M13 and V5 traced to the rules that produce it.

**WHAT IS NOW.** The plan sets a **cache-hit target** as a number to hit (M13, V5) but never says how caching is configured to hit it. The words `Cache-Control`, `ETag` and `stale-while-revalidate` appear nowhere in 33 pages. Your platform already runs a `fix-cache-headers` function in production — **so the code exists and the plan does not govern it.**

**WHY I AM ASKING TO CHANGE IT.** Caching is what stops a phone downloading the same picture twice. A target without a mechanism is a hope. This is the cheapest item in this entire addendum to close.

**WHAT EXACTLY YOU GET.** M13's and V5's targets become achievable rather than aspirational, bandwidth cost falls, and repeat page views become near-instant.

---

### P15 · Transfer compression verified
**Gate:** Brotli or gzip confirmed active on every text response, measured, recorded once.

**WHAT IS NOW.** Compression is standard — text is squeezed before sending and unsqueezed on arrival, typically 70–80 % smaller. It may well already be enabled. **Nothing in the plan checks.**

**WHY I AM ASKING TO CHANGE IT.** An unverified assumption about a 70–80 % saving is not an assumption worth carrying.

**WHAT EXACTLY YOU GET.** Either confirmation (an afternoon, closed forever) or a very large, very cheap win.

---

### P16 · AVIF added to the derivative ladder
**Gate:** AVIF produced alongside WebP at each rung, served by content negotiation with WebP fallback; bytes-per-feed-screen re-measured against M11.
*Extends M3 and M4.*

**WHAT IS NOW.** The plan builds a four-rung ladder — 600, 1080, 1440 and original (M3, M4). **That is genuinely the single biggest speed win in the document.** But it stays with WebP. The word AVIF appears nowhere.

**WHY I AM ASKING TO CHANGE IT.** AVIF is roughly **30 % smaller again for the same visual quality**, and every current phone and browser reads it. The work of building the ladder is the expensive part and you are already committed to it; adding a second output format to a pipeline you are building anyway is marginal cost.

**WHAT EXACTLY YOU GET.** About 30 % off your largest single category of bytes, for a fraction of the effort of the ladder itself. Extra profit on work already approved.

---

### P17 · First-paint strategy decided, and an SEO owner named
**Gate:** a written decision on server-side rendering or prerendering for public pages, with first-paint measured on a mid-range device; SEO given an owner and a gate.

**WHAT IS NOW.** `Server-side rendering`, `prerender` and `hydration` appear nowhere. When someone opens your website, does the server send a finished page, or an empty page plus a large program that then builds the page on the phone? The second is slower and worse for search. **And there is no SEO workstream in the plan at all**, though your platform already runs SEO functions in production.

**WHY I AM ASKING TO CHANGE IT.** This is the item most likely to affect **how many new people find you at all.** A photography platform that search engines cannot read well is a platform whose growth depends entirely on paid acquisition. Everything else in this addendum makes the platform better for members you already have; this one decides how many members you get.

**WHAT EXACTLY YOU GET.** Faster first paint for every new visitor, and a discoverable platform. Ten workstreams currently have owners and gates; the one that determines your inbound growth has neither.

---

### P18 · Core Web Vitals adopted as the external yardstick
**Gate:** LCP, INP and CLS measured on real devices, reported per release beside the plan's own budgets.
*Extends U11.*

**WHAT IS NOW.** The plan invents its own performance budgets, which is honest and fine. But `Core Web Vitals`, `Lighthouse` and `LCP` appear nowhere.

**WHY I AM ASKING TO CHANGE IT.** Your own ruler tells you whether you improved. It does not tell you whether you are slow **compared with everyone else** — and these are the public scores Google actually uses, and by which your competitors are judged.

**WHAT EXACTLY YOU GET.** A free, external, industry-standard measurement alongside the internal one. It costs a build step.

---

### P19 · A read-through cache tier before the 10-million milestone
**Gate:** hot read paths identified and served from a memory cache with a stated invalidation rule; database read volume measured before and after.

**WHAT IS NOW.** The plan mentions "cache tiers" **exactly once**, at the 10-million-member milestone. Before that, every read goes to the database.

**WHY I AM ASKING TO CHANGE IT.** A small memory cache in front of common reads is normally among the cheapest speed wins available, and this addendum has just measured what it would absorb: 580,000 settings reads (P4), 234,546 role-check scans (see Part B, X1/X2), and the read side of everything in A1. Deferring the cache tier to 10 million means paying the full database cost for the whole journey to 10 million. The same shape appears on small, hot, rarely-changing tables right across the database — measured 2026-09-01 10:47Z: `stories` (37 rows, 23,650 scans, 86 % of all its reads), `competitions` (0 rows, 22,964 scans, 97 %), `competition_votes` (0 rows, 19,304 scans, 99.5 %), `image_comments` (0 rows, 18,339 scans, 96 %), `gift_announcements` (2 rows, 15,945 scans, 100 %). Every one of those is a question the database is answering from scratch that a cache would answer instantly.

**WHAT EXACTLY YOU GET.** The measured waste in A1 has somewhere to go, years earlier, at low cost.

---

### P20 · A search engine named
**Gate:** the search technology chosen and its index built; C4's latency budget met at 1 million seeded posts, not at today's volume.
*Extends C4, which sets a target without a method.*

**WHAT IS NOW.** C4 asks for "search relevance, speed and privacy" with a latency budget. **No search technology is named anywhere in the plan** — no full-text index, no search engine.

**WHY I AM ASKING TO CHANGE IT.** At 288 posts, anything works, which is why nobody has noticed. At 1 million posts, ordinary database search is slow — and C4's budget will then be a target with no method behind it and no time to build one.

**WHAT EXACTLY YOU GET.** C4 becomes deliverable rather than aspirational, and the decision is made when it is cheap instead of urgent.

---

### P21 · Font loading policy
**Gate:** font strategy stated — subset, preload, `font-display` — and first-paint text measured with the network throttled.

**WHAT IS NOW.** The word "font" appears nowhere in the plan.

**WHY I AM ASKING TO CHANGE IT.** Custom fonts are among the most common reasons a page looks blank for a second on a slow connection. Small, but it is a second of blankness on exactly the networks your growth markets use.

**WHAT EXACTLY YOU GET.** Text appears immediately instead of after the font arrives. A few hours of work.

---

## A3 · Reach, inclusion and the certificate you asked for

---

### P22 · Web offline — a decision, not a silence
**Gate:** either a service worker delivering the O-workstream's read cache on the web, or a written, dated decision that web offline is out of scope.
*Extends the O workstream.*

**WHAT IS NOW.** The offline workstream (O1–O14) is the largest and best-considered part of the plan — but it is **for the phone app only**. `Service worker`, `PWA` and `progressive web app` appear nowhere. Someone using your site in a browser on a weak connection receives none of the benefit.

**WHY I AM ASKING TO CHANGE IT.** Not necessarily because web offline must be built — but because **fourteen units of excellent thinking currently stop at the app boundary by accident rather than by decision.** If it is out of scope, that should be written down and dated, so that the next person does not have to guess.

**WHAT EXACTLY YOU GET.** Either the same resilience for web members, or a recorded decision that stops the question being re-asked.

---

### P23 · Accessibility, as a workstream
**Gate:** WCAG level chosen; automated checks in CI; keyboard and screen-reader walkthrough of the ten primary surfaces.

**WHAT IS NOW.** `Accessibility`, `WCAG` and `screen reader` appear **nowhere in 33 pages.**

**WHY I AM ASKING TO CHANGE IT.** This is the most surprising absence in an otherwise extremely careful document. It covers members who use a screen reader, who cannot distinguish colours well, or who cannot use a mouse. In many countries it is also a **legal requirement for a public platform** — so it is both a quality exposure and a regulatory one.

**WHAT EXACTLY YOU GET.** Members you currently exclude can use the platform, and a legal exposure that is currently unowned becomes owned. Retro-fitting accessibility late costs several times what building it in costs.

---

### P24 · Language and localisation, governed
**Gate:** the supported-language list, the translation source of truth and the fallback rule written into the plan.

**WHAT IS NOW.** No mention of translation or local languages anywhere in the plan — although your platform already ships **six non-English dictionaries** (P12) and runs a `translate-text` function in production.

**WHY I AM ASKING TO CHANGE IT.** For an Indian photography platform this is a business decision that should be written down, not left out. Something this material to your market should not exist only as code.

**WHAT EXACTLY YOU GET.** The market decision is visible, owned and reviewable — and P12's chunking has a policy to serve.

---

### P25 · Certificates rendered once, stored in R2, served by owner-only link
**Gate:** one immutable PDF per certificate in R2; the database holds a private reference only; delivery through the S2 worker; a member cannot fetch another member's certificate by address; L6's forgery-resistance requirement met against a fixed document.
*Extends S2 and L6. This is the item you asked for by name.*

**WHAT IS NOW — and this corrects what you believed.** Measured 2026-09-01 10:44Z–10:47Z. **Certificates are NOT stored as base64 in the database.** The `certificates` table holds **1 row**, its `file_url` column is **NULL**, and no column anywhere in the database holds base64 certificate data.

What actually happens: the PDF is **built fresh inside the member's browser every single time**, by `src/lib/generateCertificatePdf.ts` using jsPDF. It fetches your logo, the signature image and builds a QR code on each render. **The file's own comment states this costs "12 network round trips."**

So the situation is different from what you thought — better in one way, worse in another:

- Nothing is stored, so **there is no fixed certificate document.** Two downloads on two different days can differ if an admin changed a logo in between.
- **L6 requires "forgery resistance."** That is very hard to demonstrate for a document that is rebuilt on demand and never saved. There is nothing to hash, nothing to sign, nothing to compare against.
- Every view costs 12 round trips on the member's phone.

**WHY I AM ASKING TO CHANGE IT.** **Your instinct was right, for better reasons than you had.** Render once, store the PDF in R2, keep only a private reference in the database, and serve it through the S2 worker so only the owner can open it. The plan already contains the exact machine for this — **item S2: "a worker in front of the bucket: private bytes denied anonymously, allowed paths served to the owner."** Certificates are simply not inside S2's scope. This should be a new row beside S2, not a new project.

**And there is a matching security half** (see P31): `search_certificates(_name, _course_title, _issued_date)` is executable by unauthenticated callers and takes a **person's name**. That is the opposite of owner-only. When the R2 migration happens, **make the object key itself the unguessable token** — then "owner-only link" and "publicly verifiable" stop being in conflict, because verification uses the token and browsing by name is no longer possible.

**WHAT EXACTLY YOU GET.** One fixed, immutable file per certificate. A fast download instead of 12 round trips. Something you can actually prove has not been altered — which is what L6 asks for and cannot currently have. And the owner-only privacy you specified, enforced by a worker the plan is already building.

---

## A4 · Data lifecycle

---

### P26 · Audit-log scope and retention
**Gate:** audit triggers limited to money, permissions and deletions; the change stored rather than two full row copies; rows older than a stated window moved out of the live database.
*Extends X11.*

**WHAT IS NOW.** Measured 2026-09-01 10:44Z–10:47Z. `db_audit_logs` is **86.6 % oversized-value storage**, because it keeps a full copy of every row **before** and **after** each change (`old_data` and `new_data`). There are **149 triggers across 52 tables, 17 of them audit or logging triggers.**

**WHY I AM ASKING TO CHANGE IT.** Every time a member likes a post, the database also writes two copies of that row into a log. **You pay three times for one action.** As the plan itself observes, the largest tables in your database are already logs rather than content — and at 1 million members this log grows faster than your actual product.

**WHAT EXACTLY YOU GET.** Audit where audit matters, at a fraction of the write cost, with the live database holding live data.

---

### P27 · Leftover tables and backups retired
**Gate:** each named table dropped or given a written reason to exist, with a rollback recorded.

**WHAT IS NOW.** Thirteen leftover tables from old migrations are still in production, measured 2026-09-01 10:47Z:

`wallet_ledger_v2_diff_log` (1,253 rows, 1.4 MB) · `v3_mirror_log` (119) · `round_snapshots` (30) · `wallet_ledger_v2_rows` · `wallet_ledger_v2_shadow_log` · `judging_preflight_log` · **`posts_dead_host_backup_20260812`** · `_v3_preflight_snapshot_competition_entries` · `_v3_preflight_snapshot_judging_tags` · `_v3_preflight_snapshot_judge_decisions` · `_v3_preflight_snapshot_judge_tag_assignments` · `_v3_quarantine_tag_assignments` · `_v3_quarantine_decisions`

**WHY I AM ASKING TO CHANGE IT.** This is scaffolding left standing after the building was finished. Small today — but it gets backed up, restored, migrated and scanned forever unless someone removes it. **`posts_dead_host_backup_20260812` is a copy of your posts table taken on 12 August, still sitting in production.** It is correctly locked down, but it is member content living past its purpose: **data you keep is data you are responsible for.** Note that `wallet_ledger_v2_diff_log` is the shadow the plan's own item **W4** says should be closed out rather than run indefinitely.

**WHAT EXACTLY YOU GET.** A smaller backup, a faster restore, a shorter migration, and one fewer copy of member data to be answerable for.

---

### P28 · Index-to-table ratio as a review gate
**Gate:** no table ships with more index than heap without a written reason; the ratio checked at review.
*Extends X3.*

**WHAT IS NOW.** Measured 2026-09-01 10:48Z:

- `competition_entries` — **0 rows**, 48 kB of table, **712 kB of indexes** — fifteen times more index than table, indexing nothing
- `judge_decisions` — **0 rows**, 0 bytes of table, **208 kB of indexes**
- `feed_events` — 216 kB table, 544 kB index
- `ad_impressions` — 72 kB table, 200 kB index
- `posts` — 576 kB table, **944 kB index**
- `email_send_log` — 1,320 kB table, **1,656 kB index**

**WHY I AM ASKING TO CHANGE IT.** Every index makes reads faster and **every write slower**, because each write must update every index. An index nobody reads is pure cost — and it is precisely why the `profiles` heartbeat write in P1 cannot take the cheap path. `posts` and `email_send_log` carrying more index than data is a warning that gets much louder at scale, because write cost is multiplied by index count.

**WHAT EXACTLY YOU GET.** Every insert on your write-heavy tables gets cheaper, permanently, and the ratio is caught at review rather than discovered under load.

---

### P29 · N+1 audit and a materialized-view policy
**Gate:** the ten heaviest screens traced for repeated per-row queries; a stated policy on where pre-computed views are used and how they refresh.

**WHAT IS NOW.** `N+1 queries` and `materialized views` — two standard database performance problems and cures — are named nowhere in the plan. Measured 2026-09-01 10:47Z: exactly **one materialized view** exists in the database. (The plan does cover indexes, pagination and policy cleanup, which are the larger wins — this is the remainder.)

**WHY I AM ASKING TO CHANGE IT.** An N+1 is when a screen fetches a list and then makes one more query per item — 50 posts becomes 51 queries. It is invisible at 106 members and ruinous later. Pre-computed views are the standard tool for heavy read pages, and you have one.

**WHAT EXACTLY YOU GET.** The heavy screens get cheaper before they get busy, and there is a written rule for the next heavy screen.

---

## A5 · Exposure surface

> **Read the reduction before the findings.** The vendor linter reports **1,046 issues** — 546 security, 500 performance. That number will frighten anyone who sees it, and it should not. The largest block reads "**248 SECURITY DEFINER functions executable by `anon`**". Written that way it sounds like 248 open doors. I classified all 248 with my own query rather than sampling (2026-09-01 11:12Z):
>
> | What the 248 actually are | Count |
> |---|---|
> | **Trigger functions** — no arguments, return `trigger`; not usefully callable through the API | **115** |
> | **Callable, and the source does check identity** | **71** |
> | **Callable, and the source never mentions identity** | **62** |
>
> And of the 62, **most are meant to be public** — `verify_certificate`, `username_available`, `resolve_custom_url`, `global_search`, `get_top_contributors`, `suggest_username`. That is a working public website, not a hole. I then read the bodies of the nine most alarming-looking names (11:10Z): **eight of nine guard themselves correctly**, opening with `has_role(auth.uid(), 'admin')` and either raising or returning nothing — `admin_search_users`, `search_profiles_admin`, `get_profile_admin`, `admin_set_photo_rejected`, `admin_rewind_stage`, `get_judge_collusion_admin` and `wallet_ledger_v2_diff_report` among them. **Whoever wrote those did it correctly.**
>
> **1,046 advisories collapse to the four units below.** I report the reduction as prominently as the findings, because publishing "248 admin functions open to the internet" would have been alarming, quotable and wrong.

---

### P30 · Account enumeration closed
**Gate:** `email_exists` removed from the `anon` role; signup and password-reset responses are identical whether or not the address is registered.

**WHAT IS NOW.** `public.email_exists(_email text)` is SECURITY DEFINER, executable by `anon`, with no identity check in its body (read 2026-09-01 11:09Z).

**WHY I AM ASKING TO CHANGE IT.** With nothing but the public API key — which sits in your website's JavaScript, visible to everyone — a stranger can ask "does this address have a 50mm Retina World account?" and get a yes or no, repeatedly, as fast as they like. This is **account enumeration**. An attacker takes a million leaked email addresses, asks your site which are members, and walks away with a **verified list of your members' email addresses**. That list is what phishing campaigns and credential-stuffing runs are built from. The member has done nothing wrong and will never know. The value of that answer scales directly with your membership.

**WHAT EXACTLY YOU GET.** Your member list stops being a question your own API answers for free. Minutes of work.

---

### P31 · Certificate and staff-ID search surface narrowed
**Gate:** name-based certificate search removed from `anon`; verification by token retained and tested; `verify_staff_id` placed behind a session or a rate limit.

**WHAT IS NOW.** `search_certificates(_name text, _course_title text, _issued_date date)`, `verify_certificate(_cert_id text)`, `verify_certificate_by_token(_token text)` and `verify_staff_id(_id_number text)` are all SECURITY DEFINER and `anon`-executable with no identity check (read 2026-09-01 11:09Z).

**WHY I AM ASKING TO CHANGE IT.** **Verify by ID or token being public is correct** — that is how certificate verification is supposed to work, and I would not change it. **Search by a person's name is a different thing**: it turns a verification tool into a browsable directory of who has won what. That is the direct opposite of what you specified: *"visible only the certificate owner itself."* `verify_staff_id` applies the same shape of problem to your staff.

**WHAT EXACTLY YOU GET.** The privacy you asked for in P25 actually holds, rather than being undone by a search function on the other side of the system. Minutes of work, and it must be done in the same change as P25 or the two will contradict each other.

---

### P32 · Unauthenticated write and compute endpoints closed
**Gate:** every anon-executable VOLATILE function either requires a session, or sits behind a rate-limited edge function, or has a written justification with a test.
*Extends S8 (rate limiting and abuse, per endpoint), which asks for a systematic review — this names the eight.*

**WHAT IS NOW.** Of the 62 unguarded callable functions, **8 are VOLATILE**, meaning they may write (measured 2026-09-01 11:14Z):

| Function | What concerns me |
|---|---|
| `recompute_entry_from_tag_assignments(uuid)` | anyone may trigger an expensive recomputation, for any entry, as often as they like |
| `recompute_entry_public_status(uuid)` | same |
| `increment_managed_page_view(text)` | anyone may inflate any page's view count without limit |
| `_gen_competition_order_no()` | anyone may burn competition order numbers |
| `set_write_path(text)` | sets a write path, unauthenticated — the name alone warrants a look |
| `get_broadcast_feed(...)` (two forms) | a feed reader marked VOLATILE, so it may write during a read |
| `record_test_agent_run(p_token text, …)` | takes a shared secret as its **first SQL argument** rather than a header |

**WHY I AM ASKING TO CHANGE IT.** Most attacks on a large platform are not clever — they are **amplification**: find a request that is cheap for the attacker and expensive for you, then repeat it. One HTTP call to `recompute_entry_public_status` costs an attacker nothing and costs your database a full recomputation. No login, no cost, and no rate limit visible from the catalogue: that is a denial-of-service lever handed out with the public key. `record_test_agent_run` is defensible — it authenticates by token, which is a real decision rather than an oversight — but a secret passed as an SQL argument lands in query logs and in `pg_stat_statements` in a way a header does not.

**WHAT EXACTLY YOU GET.** The cheapest way to hurt your platform stops being available, before you are large enough to be worth attacking.

---

### P33 · Compromised-password protection enabled, and the remaining catalogue tidied
**Gate:** leaked-password protection on; the four definer views read, justified and each covered by a cross-member test; the two leftover RLS-enabled tables retired; `plpgsql_check` moved out of `public`; `get_primary_admin_user_id` either closed or its exposure written down.
*Overlaps S7, which already names the four views and the nine search paths.*

**WHAT IS NOW.** Measured 2026-09-01 11:07Z–11:20Z:

- **Compromised-password checking is disabled.** A member may set a password that is already circulating in a public breach dump, and nothing stops them.
- **Four views are `SECURITY DEFINER`** — `entry_public_status`, `judge_decisions_owner_safe`, `judge_tag_assignments_owner_safe`, `judge_comments_owner_safe` — the **only ERROR-level findings in the entire security set**. Such a view runs as its creator, so row security on the underlying tables does not apply. Three are named `_owner_safe`, so the intent was clearly to return only the owner's rows — **but that intent now lives entirely inside each view's own WHERE clause.** I have not read the four bodies; that should be done deliberately, by someone who knows what each must return.
- **Seven tables have RLS enabled and no policy.** For five of them — `client_errors`, `push_delivery_log`, `member_activity_minutes`, `contributor_engagement_daily`, `media_repair_audit` — **this is correct and deliberate, and no action is needed.** The two that stand out are `categories_migration_dropped` and `posts_dead_host_backup_20260812`, which belong to P27.
- **`get_primary_admin_user_id()`** is SECURITY DEFINER, `anon`-executable, with no check — it returns the platform owner's user id to anyone who asks. **But the boring explanation mostly holds:** the neighbouring `get_public_role_user_ids(_role)` deliberately permits exactly `'admin'` and `'judge'` to be enumerated and raises for anything else. Somebody decided, on purpose, that admin and judge ids are public. A user id is not a credential, so this is not a breach — it is a targeting aid. **If admin ids must be enumerable, write that decision down where the next developer will find it. If they need not be, close both.**
- **Nine functions carry a mutable `search_path`.** I checked whether any are SECURITY DEFINER: **none are** (verified 11:08Z, count = 0). **That removes the privilege-escalation risk this warning normally signals.** Worth tidying; not urgent.
- **`plpgsql_check` is installed in the `public` schema** and should be moved.

**WHY I AM ASKING TO CHANGE IT.** The password toggle is, of everything in this addendum, **the best ratio of safety gained to effort spent** — it prevents the most common way ordinary accounts are taken over, and it costs one switch. The views matter because if anyone ever edits an `_owner_safe` WHERE clause carelessly, every member sees every judge's decisions and **no policy anywhere will stop it** — so each needs a test that proves a member cannot see another member's rows.

**WHAT EXACTLY YOU GET.** The single cheapest security improvement available, plus a safety net under the four places where row security has been deliberately bypassed.

---

### P34 · Role checks made index-only, and the invisible cost made visible
**Gate:** `user_roles` sequential scans measured at approximately zero after the change; every role check in a policy or helper function demonstrably uses the `(user_id, role)` index; the measurement repeated on seeded data at 1 million rows.
*Extends X1 and X2, which fix the policy shape. This unit is about what the policies then call.*

**WHAT IS NOW.** Measured 2026-09-01 11:04Z: `user_roles` shows **234,546 whole-table scans, reading 5,018,424 rows**. But the API statements that read `user_roles` directly account for only about **11,000 calls in total**.

**WHY I AM ASKING TO CHANGE IT — and this is the part that makes it dangerous.** The scans are not coming from your application's queries. They come from **inside**: the row-security policies and the 329 SECURITY DEFINER functions, asking "is this person allowed?" on every row of every request. That work is nested inside other statements, so **it never appears as its own line in any performance view. You cannot see it. It simply makes everything slightly slower.**

Today `user_roles` holds 108 rows, so scanning it is nearly free and the fault is invisible. At 400 million members that table holds hundreds of millions of rows, and a scan of it is not "slow" — it is impossible. Every request that triggers one stops working. This is the classic scaling cliff: no warning, no gradual degradation, and **the profiler will point at the query rather than at the policy**, because the policy's cost is charged to whatever statement triggered it. It is the same hiding place as the introspection cost in P7.

**WHAT EXACTLY YOU GET.** The unique index on `(user_id, role)` **already exists** — the work is making the policies and helper functions actually use it, and wrapping `auth.uid()` as a scalar subselect so it is computed once per query rather than once per row. Then a hidden, unmeasurable, cliff-shaped cost becomes a measured near-zero. Do this in the same change as X1 and X2, and re-measure `user_roles` afterwards: that measurement is the gate.

---

### P35 · Primary keys and remaining catalogue hygiene
**Gate:** every table has a primary key or a written reason not to; the duplicate index pairs dropped; `post_hashtags.author_id` indexed.
*Completes X3.*

**WHAT IS NOW.** Measured 2026-09-01 11:18Z: **six tables have no primary key.** Alongside them sit the two duplicate index pairs and the one unindexed foreign key that X3 already names — confirmed today and listed in Part B.

**WHY I AM ASKING TO CHANGE IT.** A table without a primary key cannot be replicated efficiently, cannot be safely de-duplicated, and cannot be reliably referenced. Item **X9** commits you to replica readiness at the 10-million milestone — a table with no primary key is a direct obstacle to that, discovered at the worst moment. The duplicate index pairs mean **every write updates both copies** for a lookup that only needs one.

**WHAT EXACTLY YOU GET.** X9's replica path stops having a blocker hidden in it, and every write to `feed_events` and `judge_decisions` gets cheaper. Hours of work, not days.

---

# PART B · EXISTING PLAN ITEMS THIS MEASUREMENT CONFIRMS OR UPDATES

**These are already yours.** I re-measured them independently on 1 September 2026 and they still stand. Where my number differs from the plan's, both are shown.

| Plan item | What the plan says | What I measured, 2026-09-01 | Verdict |
|---|---|---|---|
| **X1** RLS policy consolidation | 384 duplicate permissive policies across 82 tables | **384 confirmed**, out of **688 row-security policies in total**, with 19 tables carrying duplicate overlapping rules. Worst tables: `post_tags` 11 policies, `newsletter_subscribers` 10, then `comments`, `posts`, `post_comments`, `image_comments`, `profiles` at 9 each | **Confirmed. In my judgement the highest-value performance work in the database.** |
| **X2** Per-row `auth.uid()` fixed | 29 policies across 13 tables | **29 confirmed** by the linter; my own earlier count said 28. Either way it stands | Confirmed |
| **X3** Index hygiene | 79 unused indexes, 2 duplicate pairs, one unindexed FK | Duplicate pairs confirmed and named: `feed_events` (`idx_feed_events_post`, `idx_feed_events_post_id`) and `judge_decisions` (`judge_decisions_entry_judge_round_photo_unique`, `judge_decisions_unique_per_judge_round_photo`). Unindexed FK confirmed: `post_hashtags.author_id`. **Unused count disputed — see Part C** | Partly confirmed |
| **X5** Realtime firehose replaced | 29 tables publish every change | **29 confirmed**, and now quantified: **50.9 % of all database time.** P2 and P3 extend this | Confirmed and quantified |
| **X7** Counter integrity | denormalised counts reconcile | **31 counter columns** measured | Confirmed |
| **X11** Log-table growth controlled | audit, activity and email logs | Confirmed — and **the cron run-log, at 56 % of the database, is not in X11's scope.** P6 adds it | Confirmed, scope extended |
| **X14** Service objectives, RPO/RTO | — | The only backup job today is a **weekly reminder email**. S10 and X14 both stand | Confirmed |
| **S5** Security counter reconciled | "132 versus 248" | **248 confirmed**, and now **classified**: 115 trigger + 71 guarded + 62 unguarded. The reconciliation S5 asks for is in Part C | Confirmed and advanced |
| **S6** Legacy definer function sweep | close or justify one by one | **329 SECURITY DEFINER functions of 387 total (85 %)**; 248 anon-executable, 275 authenticated-executable. The 62 unguarded are the real work | Confirmed and scoped |
| **S7** Definer views and search paths | 4 views, 9 mutable search paths | **Both confirmed exactly.** New: **none of the nine are SECURITY DEFINER**, which lowers their urgency | Confirmed, one risk reduced |
| **S8** Rate limiting and abuse, per endpoint | systematic review | Confirmed and **named**: P32 lists the eight unauthenticated volatile functions | Confirmed and specified |
| **S10** Backup restore proof | only a weekly reminder email exists | Confirmed | Confirmed |
| **W10** Money endpoints reachable by anonymous callers | `request_withdrawal` and both ledger diff reports | Confirmed — and **`wallet_ledger_v2_diff_report` does guard itself** with an admin check. W10's "prove its internal guard with a test" is the right disposition | Confirmed, and the guard exists |
| **W4** Ledger v2 shadow closed out | 1,180 diff rows accumulated | **1,253 rows / 1.4 MB today** — still growing. P27 lists it among the thirteen | Confirmed, still growing |
| **C11** Realtime streams scoped | per-recipient topics replace the firehose | Confirmed; P3 adds the parity gate C11 needs to be provable | Confirmed |
| **C4** Search relevance, speed, privacy | latency budget | Confirmed — **and no engine is named.** P20 | Confirmed, method missing |
| **M3 / M4** Derivative ladder and backfill | 600/1080/1440/original | Confirmed as **the single biggest speed win in the plan.** P16 adds AVIF; P11 wires up the component that consumes it | Confirmed, strengthened |
| **M11** Image performance budget, binding | a build that exceeds it fails | Confirmed — and **P13 asks for the same discipline applied to JavaScript**, where the plan currently only measures | Confirmed, pattern to copy |
| **M13** Media cost budget | with a cache-hit target | Confirmed — **the target has no caching rules behind it.** P14 | Confirmed, mechanism missing |
| **L6** Certificates audited | forgery resistance | Confirmed — **and forgery resistance is not achievable while the PDF is rebuilt in the browser and never saved.** P25 gives L6 the fixed document it needs | Confirmed, blocked on P25 |
| **U2 / U11** Performance budgets | "the server answers in 19 ms; the delay is in the app" | Confirmed exactly. **The cause is never named.** P11, P12, P13, P17, P18 | Confirmed, cure missing |
| **S1 / S2 / S4** Media authorization | private post publicly fetchable; worker in front of the bucket | Confirmed as the correct machine — **and P25 asks for certificates to be brought inside S2's scope** | Confirmed, scope extended |

---

# PART C · CORRECTIONS TO NUMBERS STATED IN THE PLAN

Six. Each stamped. Where I cannot resolve a disagreement, I say so rather than choosing the number that reads best.

**C-1 · Certificates are not base64 in the database.** Measured 10:44Z–10:47Z: the `certificates` table holds **1 row**, `file_url` is **NULL**, and no column anywhere holds base64 certificate data. The PDF is generated in the browser on every view, at a self-documented **12 network round trips**. This corrects a belief you held, and it makes P25 *more* necessary, not less — because there is no fixed document for L6 to certify.

**C-2 · Unused indexes: three numbers, unreconciled — do not act on any of them yet.** The plan states **79** (Appendix A, and item X3). The vendor linter reports **78** today. My own query today reports **298 indexes never scanned, of which 125 are droppable** — the other 173 back primary keys or unique constraints and must stay — totalling 2,336 kB. My own earlier report to you said **188**. Four figures, from four methods, at different times, with different filters. **I have not reconciled them, and I would not drop a single index on any of these numbers until I had.** This is the same class of disagreement the plan itself flags in item S5, and it deserves the same treatment.

**C-3 · The definer-function count is settled, and now classified.** The plan records the disagreement "132 versus 248" and asks for one agreed measurement (S5). **248 is correct today**, verified by my own query, not merely relayed from the linter. More usefully, it is now **115 trigger functions + 71 that check identity + 62 that do not** — which turns S6 from a 248-item sweep into a **62-item sweep**, most of whose members are legitimately public.

**C-4 · The largest table in the database is not an audit log — it is the cron run log.** The plan says "the three largest tables in a 132 MB database are logs, not content." Measured today: the database is **135 MB**, and **`cron.job_run_details` alone is 76 MB — 56 % of everything**, larger than `db_audit_logs`, `activity_logs` and every content table combined. The plan's observation was right; its subject was wrong. X11 does not cover this table.

**C-5 · The per-row `auth.uid()` count is 29, not 28.** My earlier report to you said 28; the linter says 29 and the plan says 29. **The plan is right and I was one out.** X2 is unchanged.

**C-6 · Nine mutable search paths, none of them privileged.** S7 groups "four SECURITY DEFINER views at error level and nine functions with a mutable search path". Both counts confirmed — but **none of the nine functions is SECURITY DEFINER** (verified 11:08Z, count = 0). The privilege-escalation risk this warning usually signals is **not present**. The four views keep their ERROR severity; the nine functions should be downgraded to routine tidying.

---

# PART D · WHAT IS ALREADY RIGHT

An addendum that only lists faults is not a measurement, and this report would be dishonest without this section. All verified in the same checkout and the same database session.

- **The `profiles`/`profiles_public_data` split works.** Same 13,989 updates; 13,846 of them efficient on the public table against 2,178 on `profiles`. The pattern is correct — it just needs applying to the write in P1.
- **Media is not in the database.** The storage `objects` table holds 2 rows; photos live in object storage behind the CDN, exactly as they should.
- **Images already go through Cloudflare's resizing service** (`/cdn-cgi/image/width=…` in `PostMedia.tsx`), with the reasoning documented in the file. Bandwidth is already taken seriously.
- **84 lazily-loaded routes across 69 route definitions.** The app is properly code-split at the route level.
- **A 25-second read timeout on every API call, with uploads deliberately exempt** so a slow photo post does not become a failed post. That exemption is a subtle and correct decision.
- **`srcSet` is always paired with `sizes`** in all four places it appears — the detail almost every codebase gets wrong.
- **The site-settings batching cache and the profile-map cache follow one shared pattern**, not two subtly different ones, and the reasoning is written into the file header.
- **The engagement heartbeat measures attention rather than uptime**, refuses to earn minutes from a backgrounded tab, destroys its timer on hide, and resolves the two-tab problem in the database rather than with fragile client-side leader election. **It is the model for P10.**
- **The translation split has already been done once, correctly**, with the reasoning recorded. P12 is the second half of a job already started well.
- **Eight of the nine most alarming-looking admin functions guard themselves properly.** Whoever wrote those did it correctly.
- **The plan itself already contains the three largest structural fixes** — X1, X2 and X5. This addendum quantifies them; it does not discover them.

**The pattern across all of it: the hard thinking has been done and written down. The wiring has not been finished.** The fast image component exists but is not used. The realtime publication exists but does not match what the app subscribes to. The settings cache exists but the settings still come from the database. S2 exists but certificates are not inside it. **Most of what remains is connection work, not invention** — which is why the effort estimates below are days rather than quarters.

---

# PART E · IF YOU APPROVE ONLY SEVEN

| | Unit | What it removes | Effort |
|---|---|---|---|
| 1 | **P33** — compromised-password protection | the most common route to account takeover | **one toggle** |
| 2 | **P30 + P31** — close `email_exists` and certificate name-search | your member list; the contradiction with your own privacy requirement | **minutes** |
| 3 | **P1** — presence out of `profiles` | the highest-risk line of code in the platform | **days** |
| 4 | **P2 + P3** — replica identity, and publication parity | attacks the 50.9 %; fixes eleven silently broken features | **days** |
| 5 | **X1 + X2 + P34** *(X1/X2 already yours)* — policy consolidation and index-only role checks | the invisible per-row tax that becomes fatal at scale | **days** |
| 6 | **P4** — configuration to the edge | ≈580,000 database requests | **days** |
| 7 | **P25** — certificates to R2, owner-only | the thing you asked for; and it unblocks L6 | **days** |

Items 1 and 2 can be done this afternoon. Items 3, 4 and 6 together remove **roughly two thirds of your current database load before a single new member arrives.**

---

## Honest word about 400 million

Your plan is engineered for **1 million** members, designed so that **10 million** is added capacity rather than a rewrite, with **100 million** as a far milestone reached through gates. **400 million is four times beyond the furthest point this plan describes.** At that size it is a different kind of system — many databases split by region, separate services for feed, media and identity, and a cost model designed before it is built. No honest plan reaches that on one Postgres database, and this addendum does not pretend to.

**But that is not this year's problem.** This year's problem is that **every finding above is free at 106 members and fatal at 1 million** — and every one of them is cheaper to fix now than later.

---

*Prepared by Developer 2 / Session 2 as an independent measurement session. All figures read-only against production `jtdtehuqtinjxropkkcn` and the repository at `a42b209e4f70a6efed4f3dcdb654e0f994416594`, on 2026-09-01 between 10:44Z and 11:22Z. Counter window 2026-07-22 16:00:58Z onward, 41 days, 15,885,787 queries. No writes, no schema changes, no migrations, no deployments, no functions called. Status of every measured row: **VERIFIED** (measured personally). Vendor-linter categorisations are **RELAYED** except where independently re-derived, which is stated at each point. Three findings were reduced or withdrawn by seeking the boring explanation first; one number (C-2) is reported as an unresolved disagreement rather than as a fact.*
