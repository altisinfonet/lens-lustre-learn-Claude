# What the app itself is doing wrong — part 3 (UI, front end, backend wiring)

**Code measured at the release candidate `a42b209e4f70a6efed4f3dcdb654e0f994416594`, in my own checkout, on 2026-09-01 ~11:05Z.**
**Database counters measured against production `jtdtehuqtinjxropkkcn` on 2026-09-01 10:48Z–11:05Z; the counters cover 2026-07-22 16:00:58Z onward (41 days).**
Every negative below is stamped. Where the code is already doing the right thing, I say so — that section is at the end, and it is not short.

---

## 1. The write that will break the platform is four lines of front-end code

**What I measured (code, as of 2026-09-01 11:02Z):** `src/hooks/core/useLastActive.ts` does this, in the browser, for every signed-in member:

```
setInterval(update, 5 * 60 * 1000);   // and once immediately on mount
```

…where `update` is a direct `UPDATE` on the `profiles` table setting `last_active_at` and `last_platform`.

**Plain language.** Every open tab writes to your main member table every five minutes, forever, whether the member is doing anything or not. It is *per tab*, not per member — two tabs, two writes. It fires once immediately as well, so opening the app is a write before the member has touched anything.

**The arithmetic at 400 million members.** Suppose just **1 %** are online — 4 million tabs. 4,000,000 writes ÷ 300 seconds = **13,300 writes per second, to one table, forever.** And from part 2, each of those writes:

- cannot take the cheap in-page path (more index than table on `profiles` — measured 184 kB index / 112 kB heap);
- photocopies the whole row into the change log (`profiles` is REPLICA IDENTITY FULL);
- is decoded and security-checked by the realtime engine for every listener;
- leaves a dead row behind (measured 2026-09-01 10:50Z: **`profiles` is 64.2 % dead rows**).

A single Postgres table does not sustain 13,300 writes per second with that tail attached. It is not a matter of a bigger instance. **This is the single highest-risk line of code I have found in the system**, and it exists to draw a green dot.

**The better way.** Presence never belongs in a durable, published, indexed table. Move it to memory (the realtime service's own presence feature, or Redis). If a "last seen" timestamp is genuinely needed for admin reporting, write it once per session end, or batch it server-side every few minutes — not once per tab per five minutes.

---

## 2. Eleven live-update subscriptions in the app can never fire. Not once.

**What I measured (as of 2026-09-01 11:00Z):** the app opens **56 `postgres_changes` subscriptions across 26 files**, covering 32 distinct tables. The database publishes changes for **29** tables. I compared the two lists.

**Eleven tables the app is listening to are not published at all:**

`ad_creative_reactions` · `admin_notifications` · `admin_vote_adjustments` · `badge_definitions` · `comments` · `judge_comments` · `judge_sessions` · `judge_tag_assignments` · `judging_preflight_log` · `role_display_config` · `site_settings`

I confirmed all eleven tables **exist** in the database (checked 2026-09-01 11:03Z) — they are simply not in the realtime publication. So the app opens a WebSocket channel, registers a subscription, waits… and no event will ever arrive, for any of them, ever.

**Plain language.** Eleven screens have a "this updates by itself" feature that has never worked and never will. Nothing errors. Nothing logs. The screen just quietly shows stale data until someone reloads. This is the worst kind of bug: it looks like it works, because there is nothing on screen that says it doesn't.

That includes `admin_notifications` — an admin alerting feature that silently does not alert.

**And the reverse: eight tables are published to realtime that no part of the app listens to:**

`certificates` · `competitions` · `featured_artists` · `image_comments` · `image_reactions` · `journal_articles` · `photo_of_the_day` · `post_shares`

Every change to those eight is written into the change log, decoded, and security-checked by the engine that is already consuming 50.9 % of your database — and then discarded, because there is no listener.

**The better way.** Fix the mismatch in both directions: publish the tables that are genuinely needed live, and unpublish the eight that nobody listens to. Then add a build-time check that fails the deploy when the app subscribes to a table that is not published. This is a check a machine can run in a second; it should never have been left to a human to notice.

---

## 3. Configuration tables are being treated as live data

**What I measured (as of 2026-09-01 11:00Z):** among the 56 subscriptions are live channels on `site_settings`, `role_display_config`, `badge_definitions`, `courses` and `support_tickets`.

**Plain language.** These are settings. `site_settings` has **35 rows**. Badge definitions and role display config change when an administrator decides they should — a handful of times a year. Each one nonetheless gets a permanently-open WebSocket channel, per member, per tab, held open for the entire session, waiting for an event that comes once a quarter.

**Why 400 million members breaks this.** A WebSocket channel is not free at either end. Multiply "a channel per settings table per tab" by millions of tabs and you are paying for a standing army to wait for a letter that arrives four times a year.

**The better way.** Settings should be fetched once at boot and refreshed on a long timer or a version bump — never subscribed to.

---

## 4. Your 35-row settings table was fetched 580,000 times

**What I measured (as of 2026-09-01 11:04Z):** counting every API statement that reads `site_settings`, over the 41-day window:

| Query shape | Calls |
|---|---|
| one setting by key | 352,665 |
| one setting by key (other variants) | 40,505 |
| several keys at once (the batched path) | 173,996 |
| **the entire table, no filter** | 6,437 (mean **4.2 ms** each) |
| newest-updated probe | 6,444 |
| **total** | **≈ 580,000** |

That is roughly **14,100 requests a day, for 106 members, to read 35 rows of configuration.**

Underneath, the table shows **165,543 whole-table scans that read 5,793,341 rows** alongside 415,381 efficient index lookups — so about a third of the reads walk the entire table instead of jumping to the key.

**This is not a criticism of the caching work.** `src/lib/siteSettingsCache.ts` is genuinely well built — it caches per key, coalesces every key requested within one frame into a single query, and `useSiteSetting` waits for a shared bootstrap before falling through. Its own header documents the fix: 23 requests down to 1 on the feed. **The remaining 580,000 is what survives a good in-memory cache**, because that cache is per tab and starts cold on every page load, every new tab, and every refresh.

**Why 400 million members breaks this.** Configuration reads scale with *sessions*, not with data. 14,100 a day at 106 members becomes tens of millions a day — all for 35 rows that are identical for every member on earth.

**The better way.** Configuration that is the same for everyone should not come from the database on a per-session basis at all. Serve it from the CDN edge as a small cached JSON document with a version stamp, or bake it into the deployed bundle and invalidate on change. That takes 580,000 database requests to approximately zero. Separately, find the 6,437 unfiltered full-table reads and the 165,543 scans — those are code paths that ask for everything.

---

## 5. Permission checking is scanning a table on nearly every request — and it is invisible

**What I measured (as of 2026-09-01 11:04Z):** `user_roles` shows **234,546 whole-table scans reading 5,018,424 rows**. But the API statements that read `user_roles` directly account for only about **11,000 calls in total**.

So the scans are not coming from your app's queries. They are coming from **inside** — the row-security policies and the 329 SECURITY DEFINER functions I reported earlier, which check "is this person allowed?" on every row of every request. That work is nested inside other statements, so it never appears as its own line in any performance view. **You cannot see it. It just makes everything slightly slower.**

**Why 400 million members breaks this.** Today `user_roles` has 108 rows, so scanning it is nearly free and the fault is invisible. At 400 million members that table has hundreds of millions of rows, and a scan of it is not "slow" — it is impossible. Every request that triggers one stops working. This is the classic scaling cliff: no warning, no gradual degradation, and the profiler will not point at it because the cost is hidden inside statements attributed to something else.

**The better way.** Every role check inside a policy must be an indexed single-row lookup on `(user_id, role)` — the unique index already exists, so the fix is to make the policies and helper functions actually use it. Wrap `auth.uid()` in a scalar subselect so it is evaluated once per query instead of once per row (this ties to the **28 policies with per-row `auth.uid()`** and **688 total policies** from my earlier report). Then re-measure: `user_roles` seq scans should approach zero.

---

## 6. A fast-image component was built, and then never used

**What I measured (as of 2026-09-01 11:05Z):** `src/components/OptimizedImage.tsx` exists — 3,134 bytes, default-exported. It renders a `<picture>` with a WebP source and a JPEG fallback, gates loading on an IntersectionObserver with a 200 px margin, and shows a 256 px low-quality placeholder until the real image arrives. It is a good component.

**It is imported by nothing.** I searched the whole source tree: the only two matches outside the file itself are a test that mentions the filename inside a string. **Zero call sites.**

Meanwhile the app renders **158 raw `<img>` tags** directly.

**Plain language.** Someone built the fast-loading image component the plan calls for, and it was never wired into a single screen. For a photography platform, images *are* the product and *are* the page weight — this is the highest-value unused asset in the codebase.

To be fair, the raw tags are not naive: **136 of the 158 carry `loading=` within their first six lines**, and `decoding=async` appears 144 times. The basics are there. What is missing is the WebP/`<picture>` path, the placeholder, and the observer — precisely what the unused component provides.

**The better way.** Wire `OptimizedImage` in, starting with the feed and profile pages, and add a lint rule that forbids a bare `<img>` in `src/components` and `src/pages`. Note that only **4 components** currently use responsive `srcSet` (`PostMedia`, `OptimizedImage`, `EntryCard`, `GalleryImage`) — and I checked, each of those correctly pairs `srcSet` with `sizes`, which is the part most codebases get wrong. The pattern is right. It is used in four places out of a hundred and fifty-eight.

---

## 7. Six languages ship as one 515 KB download

**What I measured (as of 2026-09-01 11:01Z):** `src/i18n/translations.rest.ts` is **527,720 bytes** and is correctly loaded with a dynamic `import()` from `I18nContext.tsx` — so English visitors never download it. That fix is real and its header documents it: it removed ~322 KB from a 1.47 MB entry bundle.

**What is still wrong:** all six non-English dictionaries live in **that one file**. A Hindi speaker downloads Hindi *and* Bengali *and* Tamil *and* the other three — half a megabyte to read five sixths of which they will never see.

**Why this matters for 400 million members.** Your growth is in exactly the markets those dictionaries serve, on exactly the devices and networks where half a megabyte is expensive.

**The better way.** One chunk per language. A member downloads roughly 85 KB instead of 515 KB. This is a file split, not a rewrite.

---

## 8. Twenty-one repeating timers, one firing five times a second

**What I measured (as of 2026-09-01 10:59Z):** 21 `setInterval` timers in the source. The notable ones:

- `src/components/ads/AdZone.tsx` — **every 200 ms** (five times a second).
- Six timers at **1 second** (countdowns, session timers, phase banners).
- `src/hooks/feed/useFeedEventTracker.ts` — flushes tracking events **every 5 seconds**.
- `src/hooks/core/useLastActive.ts` — every 5 minutes, and it writes to the database (item 1).
- Four React Query `refetchInterval` polls: 30 s, 30 s, 60 s, and 90 s during voting.

**Plain language.** A timer firing five times a second keeps the phone's processor awake and re-renders part of the screen 300 times a minute. On a laptop nobody notices; on a mid-range Android phone that is measurable battery drain and visible jank, and it runs for as long as an ad is on screen.

**Credit where it is due:** `useEngagementHeartbeat.ts` gets this exactly right — it *destroys* its timer when the tab is hidden rather than letting it fire uselessly, and its own comments explain why. That discipline should be applied to the other twenty.

**The better way.** Countdowns should use `requestAnimationFrame` or recompute on render from a timestamp, not tick a state variable every second. `AdZone`'s 200 ms tick should be event-driven or slowed to 1 s. Every remaining timer should be cleared on `visibilitychange`, following the pattern already in `useEngagementHeartbeat`.

---

## What the code already does well

This is not a bad codebase, and the report would be dishonest without this section. All verified in the same checkout, 2026-09-01 ~11:05Z:

- **Images go through Cloudflare's resizing service** (`/cdn-cgi/image/width=…` in `PostMedia.tsx`), with a documented history of why. Bandwidth is being taken seriously.
- **Media is not in the database.** The storage `objects` table holds 2 rows; photos live in object storage behind the CDN, exactly as they should.
- **84 lazily-loaded routes** across 69 route definitions — the app is properly code-split at the route level.
- **A 25-second read timeout** on every API call, with uploads deliberately exempt so a slow photo post does not become a failed one. That exemption is a subtle, correct decision.
- **The site-settings batching cache** (item 4) and the profile-map cache follow one shared pattern rather than two competing ones.
- **The engagement heartbeat** measures attention rather than uptime, refuses to earn minutes from a backgrounded tab, and resolves the two-tab problem in the database rather than with fragile client-side leader election.
- **`srcSet` is always paired with `sizes`** in all four places it appears — the detail almost everyone gets wrong.
- **The translation split** has already been done once, correctly, with the reasoning recorded.

The pattern across all of it: **the hard thinking has been done and written down; the wiring has not been finished.** The fast image component exists but is not used. The realtime publication exists but does not match what the app subscribes to. The settings cache exists but the settings still come from the database. Most of what is left is connection work, not invention.

---

## Order I would fix these in

1. **Presence out of `profiles`** (item 1) — highest risk in the system, smallest change.
2. **Reconcile the realtime publication with the app's subscriptions** (items 2 and 3) — fixes eleven silently-broken features *and* removes waste from the engine using half your database.
3. **Index-only role checks in policies** (item 5) — invisible today, fatal at scale.
4. **Settings to the CDN edge** (item 4) — removes ~580,000 database requests outright.
5. **Wire in `OptimizedImage`** (item 6) — the work is already written.
6. **One chunk per language** (item 7), **tame the timers** (item 8).

Items 1, 2 and 4 are days of work, not weeks, and between them they remove more load than everything else on this list combined.

---

*Measured by Developer 2 / Session 2. Code read at RC `a42b209e4f70a6efed4f3dcdb654e0f994416594`; production read-only. No writes, no schema changes, no deployments. Status of every row above: VERIFIED (measured personally). One correction I caught in my own working: an initial count of "64 `srcSet` against 9 `sizes`" was wrong — it counted test files. The corrected figure, 7 against 9 with every file paired, is the one reported in item 6.*
