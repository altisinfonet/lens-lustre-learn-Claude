# PHASE 2A — CURRENT VERIFICATION REPORT

**Generated:** 2026-08-12 ~02:26 UTC
**Type:** Technical correctness only. **No judgement of engagement data quality** — there is nowhere near enough collection time for that.
**Collector state:** RUNNING. Not stopped, not reset, not altered. **Zero rows written to produce this report.**

**Method note:** production was queried **read-only**. Behavioural proofs that would have required writing rows were run instead against a **throwaway PostgreSQL 16** loaded with the identical migration file, then destroyed. Client-side proofs come from the 20-test suite. Every number below is measured, not remembered.

---

## 1. COLLECTION — ✅ RECORDS ARE BEING CREATED

| Metric | Value |
|---|---|
| Raw minute rows | **3** |
| Daily aggregate rows | **0** |
| Distinct members | **1** |
| First row (UTC) | `2026-08-12 02:13:00+00` |
| Last row (UTC) | `2026-08-12 02:18:00+00` |
| Table size on disk | 48 kB (mostly index overhead) |
| Bytes per row | **56** |

**Representative records** (member id replaced with an 8-char hash — the table itself stores a raw uuid):

| utc_minute_bucket | member_ref | surface | had_interaction | role | gets_a_score |
|---|---|---|---|---|---|
| 2026-08-12 02:13:00+00 | `7d367412` | **internal** | true | admin | 0 |
| 2026-08-12 02:17:00+00 | `7d367412` | public | true | admin | 0 |
| 2026-08-12 02:18:00+00 | `7d367412` | public | true | admin | 0 |

**There are no path details to redact.** See §11 — the path segment is never stored at all.

**Honest reading of these three rows:**

- The **02:13** row is the deliberate verification probe from the migration run (three pings, `feed` → `admin` → `feed`).
- The **02:17 and 02:18** rows were **not** manually triggered. They were produced naturally by the running collector during a visible browsing session on this account. Two consecutive minutes, `public`, `had_interaction = true`.
- All three belong to the **admin** account, and all three show `gets_a_score = 0`.

**Daily aggregate is 0 because the rollup has not run yet.** Cron `rollup-engagement-daily` fires at `20 0 * * *` — the next run is roughly 22 hours away. The rollup function itself is verified working in §13/§14.

**Only one distinct member so far.** The collector went live ~13 minutes before this report. This is a sample of one, on an admin account. **Nothing about real member behaviour can be concluded yet** — that is the later Data Quality Report.

---

## 2. CONTRIBUTOR SCORE ISOLATION — ✅ CONFIRMED, ZERO CONTRIBUTION

**Active Engagement is NOT contributing to Contributor Score.**

Live md5 of the three scoring function bodies, read from `pg_proc.prosrc` just now:

| Function | md5 | vs Phase 1 |
|---|---|---|
| `contributor_points_since` | `0fb5e020ab35f3345b9646c134300c80` | **identical** |
| `get_contributor_scores` | `d835a4edd4ae09f5d5e673ce99bf1af2` | **identical** |
| `get_top_contributors_v2` | `74713575015ac6b56430482fade16590` | **identical** |

Regex over the combined source of all three for `engagement|activity_minute|minutes_credited`:
**no match.** The scoring path does not reference the collector in any way.

Live top 3, and the page agrees with the database exactly:

```
🥇 Dipannita Sen  ✦ 5,334
🥈 Mainak Mridha  ✦ 3,922
🥉 Amit Baran Sen ✦ 3,820
```

The calculation remains **45% Posts + 35% Comments**, unchanged.

⚠️ **Say plainly:** that means the live score is **80% of your 45/35/20 model**. The 20% Active Engagement slice is collecting but is not scored — exactly as instructed. The score is not "complete", it is "complete for Phase 1".

---

## 3. THE 120-SECOND IDLE RULE — ✅ EXACTLY 120 SECONDS

`src/hooks/core/useEngagementHeartbeat.ts:63`

```
const IDLE_MS = 120_000;   // exactly 120 seconds
const TICK_MS = 15_000;    // how often we LOOK, not how often we send
```

The gate, line 132: `if (now - lastInputAt.current > IDLE_MS) return;`

Input events that reset the clock: `pointerdown`, `keydown`, `wheel`, `touchstart`, `scroll` — all registered `{ passive: true }`.

**Stops and resumes — proven behaviourally** (fake timers, real hook):

> *"stops after 120 seconds without input, and resumes when touched"* — ✅
> Records across minutes 1 and 2, then sits untouched for 5 minutes and records **nothing**. A single `pointerdown` and the next tick records again.

Two supporting behaviours also proven:

> *"treats returning to the tab as an interaction, not as continued idleness"* — ✅ half an hour away, then return, and it records without needing a click.
> *"does not restart its countdown on every navigation"* — ✅ four page changes in 15 seconds still earn the minute.

---

## 4. FOREGROUND / BACKGROUND PROTECTION

| Condition | Records? | Status |
|---|---|---|
| Visible foreground page | **YES** | ✅ verified — rows at 02:17 and 02:18 |
| Hidden / background browser tab | **NO** | ✅ verified |
| Minimised window | **NO** | ✅ verified indirectly (see below) |
| Android background | **NO** | ⚠️ **not applicable yet — see below** |
| Screen lock | probably no | ⚠️ **NOT DIRECTLY VERIFIED** |

**Hidden tab — proven:**

> *"sends nothing while the tab is hidden and clears its timer"* — ✅
> On `visibilitychange` → hidden, `vi.getTimerCount()` drops to **0**. Ten minutes pass, nothing sent. On visible, the timer count rises again and the next tick records.

The timer is **destroyed**, not left to no-op. A backgrounded tab costs zero timers.

**Minimised window:** earlier in this session your Chrome window was minimised, and every tab reported `document.hidden = true`, `innerWidth = 0`. So minimising resolves to the hidden case above.

**⚠️ ANDROID — THE COLLECTOR IS NOT IN YOUR APP YET.**
`capacitor.config.ts` sets `webDir: 'dist'` with **no `server.url`** — the Android app ships a *bundled copy* of the web build taken at APK build time. No new APK has been built since this merged. **The installed Android app contains no collector and is recording nothing at all.** The `appStateChange` handling is written and unit-tested, but it is untested on a device because it has never run on one.

**⚠️ Screen lock — honest answer.** Not tested; I cannot lock your screen. Mechanically: on mobile browsers, locking fires `visibilitychange → hidden`, which destroys the timer. On desktop, locking does **not** reliably fire it — there the **120-second idle rule is the backstop**, so a locked desktop stops earning within two minutes regardless. I am not claiming more than that.

---

## 5. DUPLICATE-MINUTE PROTECTION — ✅ ENFORCED IN THE DATABASE

Primary key: **`user_id + minute_bucket`**.

Six separate signals inside one minute (`feed`, `feed`, `journal`, `profile`, `courses`, `feed`):

```
V5/V6 six_signals_one_minute → 1 row   (expected 1)   PASS
```

Also enforced client-side as a first line of defence — `minuteKey()` refuses to send twice in the same wall-clock minute, proven by *"records at most one ping per wall-clock minute"*. **But the database is the guarantee**, and the client is only an optimisation.

Already demonstrated on production too: the three pings at 02:13 collapsed to **one row**.

---

## 6. MULTIPLE-TAB PROTECTION — ✅ SAME MECHANISM, SAME GUARANTEE

The six signals above are indistinguishable from three tabs pinging twice each — the server sees six independent authenticated calls and stores **one row**.

**No client-side leader election is attempted, on purpose.** A "primary tab" that dies with its tab would lose minutes to buy a guarantee the primary key already provides for free.

Bonus, proven: when two tabs disagree about the surface, **the strictest wins**. A member on `/admin` in one tab and the feed in another gets that minute marked `internal`:

```
V9 admin_path_internal        → internal   PASS
V9 admin_minute_cannot_unwind → internal   PASS   (a later 'feed' ping cannot undo it)
```

---

## 7. UTC — ✅ SERVER-AUTHORITATIVE

| Check | Result |
|---|---|
| Column type | `timestamp with time zone` |
| Bucket format | `2026-08-12 02:13:00+00` — truncated to the minute, `+00` |
| Rows not truncated to a whole minute | **0** |
| Bucket source | `date_trunc('minute', now())` — **server clock, inside the function** |
| Rollup grouping | `(m.minute_bucket AT TIME ZONE 'UTC')::date` — explicit UTC |

**The browser's timezone is never used for scoring.** The client computes a local `minuteKey()` for one purpose only — to stop itself sending twice in the same minute. It is never transmitted and never stored. A member with a wrong system clock throttles themselves oddly and changes nothing else.

---

## 8. SERVER AUTHORITY — ✅ NOT VALIDATED, STRUCTURALLY IMPOSSIBLE

Function signature, live:

```
record_activity_minute(_segment text, _interacted boolean)
```

**There is no timestamp parameter, no duration parameter and no user parameter.** The member comes from `auth.uid()`; the minute from `date_trunc('minute', now())`. This is not a rule the server enforces — it is an argument the client cannot express.

Attempted live, from a real signed-in member session:

| Attempt | Result |
|---|---|
| `{_segment, _interacted, _bucket: "2020-01-01T00:00:00Z"}` | **404 PGRST202** — no such function signature |
| `{_segment, _interacted, _minutes: 500}` | **404 PGRST202** |
| `{_segment, _interacted, _user: "00000000-…"}` | **404 PGRST202** |

Future timestamps, historical timestamps and arbitrary durations are all rejected for the same reason: **there is no field to put them in.** The request is rejected before it reaches Postgres.

Confirmed on the harness too — the bucket written always equals the server's own `date_trunc('minute', now())`.

---

## 9. ADMIN EXCLUSION — ✅ BOTH HALVES CONFIRMED

**`/admin/*` → never contributor-credited:**

The surface is decided **server-side** from the segment, so no client build can bypass it:

```
V9 admin_path_internal         → internal   PASS
V9 admin_minute_cannot_unwind  → internal   PASS
```

Live evidence: the 02:13 production row reads `internal`.

Internal minutes are also excluded from the credited figure at rollup — see §14.

**Admin account → never eligible for Top Contributors:**

| Check | Result |
|---|---|
| Admin public posts | **12** |
| Rows returned by `get_contributor_scores` for admin | **0** |
| Admin rows in `get_top_contributors_v2` | **0** |
| Eligibility filter excludes `role = 'admin'` | ✅ |

Twelve public posts, zero score, zero ranking. The exclusion is real, not incidental.

---

## 10. JUDGE EXCLUSION — ✅ CORRECT ON BOTH SIDES

**`/judge/*` → never contributor-credited:**

```
V10 judge_path_internal → internal   PASS
```

**Judge account + public activity → still eligible:**

| Check | Result |
|---|---|
| Judge accounts on the platform | **1** |
| Judges returned by `get_contributor_scores` | **1** |
| Judge public minute retained after an internal minute | ✅ PASS |

The eligibility filter excludes **only** `role::text = 'admin'`.

> **A correction I owe you.** My first automated check regex-matched the word "judge" in the function source and reported *"EXCLUDED (bad)"*. I went and read the source rather than reporting it: the only occurrence of "judge" is inside a **comment** quoting your instruction — *"Do NOT automatically exclude judge, content_editor, registered_photographer, student, normal user."* The SQL filter itself matches `'admin'` only. The live data confirms it: the one judge account has a score. **My check was wrong, not the code.**

---

## 11. PRIVACY — ✅ STRONGER THAN YOU ASKED FOR

You asked that only the broad first path segment be stored. **The segment is not stored either.**

Actual columns in `member_activity_minutes`:

```
user_id          uuid
minute_bucket    timestamptz
surface          text      CHECK (surface IN ('public','internal'))
had_interaction  boolean
```

That is the whole table. `_segment` is a **parameter**, used to compute `surface` and then discarded. What survives is a **two-value flag**: `public` or `internal`.

So the table cannot reveal `feed` vs `journal` vs `courses`, let alone `/profile/<uuid>` or `/journal/<slug>`. No full URLs, no uuids, no slugs, no query strings, no content identifiers — **and no categories**.

The client is also careful about what it sends in the first place. `pathSegment()` matches against a fixed allow-list of declared routes and maps anything unrecognised to `other`:

| Input | Sent |
|---|---|
| `/journal/my-trip-to-ladakh` | `journal` |
| `/profile/9f1c-uuid-here` | `profile` |
| `/courses/street-photography/lessons/4` | `courses` |
| **`/dipannita-sen`** | **`other`** |

That last row is the one that matters. This app routes **`/:customUrl`** at the top level, so a naive "first path segment" would have transmitted **member usernames**. Six tests cover this, including one that asserts the output can never fall outside the fixed vocabulary — tried against `/../etc/passwd` and `/%2e%2e` among others.

⚠️ **Future decision this creates:** because the segment is discarded, Phase 2b **cannot** report "which sections members spend time in". If you want that later, it is a deliberate schema change and a deliberate privacy trade-off, not an oversight.

---

## 12. SECURITY / RLS — ✅ VERIFIED AGAINST A REAL MEMBER SESSION

Both tables: **RLS enabled with `0` policies**, and table grants revoked from `anon` and `authenticated`.

Attempted live through a genuine signed-in session (**your own account, which is an admin**):

| Attempt | Result |
|---|---|
| `SELECT` raw activity table | **403** `42501 permission denied` |
| `SELECT` other members' minutes | **403** |
| `INSERT` minutes for own user_id | **403** |
| `DELETE` rows | **403** |
| `SELECT` daily aggregate | **403** |
| `rpc/rollup_engagement_daily` | **403** |
| `rpc/prune_activity_minutes` | **403** |
| `rpc/engagement_collector_health` | **403** |
| `rpc/engagement_probe_report` | **403** |
| `rpc/record_activity_minute` | **204** ← the only thing a member can do |

**A member cannot read anyone's timeline, including their own.** They cannot award themselves minutes: the only writable path is a `SECURITY DEFINER` function that ignores everything about identity and time that the client might assert.

Not even an admin can read the raw table over the API. Admin reporting is Phase 2b and must go through a function that decides what to expose.

---

## 13. RETENTION — ✅ 40 DAYS RAW, AGGREGATE PERMANENT

`prune_activity_minutes(_dry_run boolean DEFAULT true)` — cutoff `now() - interval '40 days'`.

| Check | Result |
|---|---|
| Dry run is the default | ✅ PASS |
| Refuses to delete a day not yet rolled up | ✅ PASS (returned 0) |
| Aggregate exists after rollup | ✅ PASS |
| Deletes the raw rows once rolled up | ✅ PASS (returned 1) |
| **Aggregate still present after the prune** | ✅ **PASS** |

**Raw records are temporary; the daily aggregate is permanent.** `contributor_engagement_daily` keeps `minutes_actual`, `minutes_public`, `minutes_internal`, `minutes_credited`, `minutes_interacted`, `minutes_carried` per member per UTC day — so lifetime engagement survives the prune. This is a deliberate exception to the Phase 1 "current state is the source of truth" rule, taken for privacy: a permanent minute-by-minute record of when each member is awake is not something worth keeping.

**No prune job is scheduled.** Retention is 40 days and Phase 2a is two weeks, so it would have nothing to do. Scheduling a destructive job that cannot be observed working is worse than running it by hand later.

---

## 14. DAILY CAP — ✅ 30 MINUTES, AND NOT ACTIVE

`LEAST(COUNT(*) FILTER (WHERE m.surface = 'public'), 30)`

| Scenario | actual | credited |
|---|---|---|
| 90 real public minutes in one UTC day | **90** | **30** ✅ |
| 20 public + 80 internal minutes | 100 | **20** ✅ |

Both PASS. Two things this proves:

1. **Real usage is recorded uncapped** — your Admin Users table can show true time. Only the *credited* figure is capped.
2. **Internal minutes neither consume nor contribute to the cap.** 80 minutes in `/admin` did not eat into the 30, and did not add to it.

**This scoring is NOT active.** `minutes_credited` is computed and stored; **nothing reads it.** Confirmed in §2 — the scoring functions do not reference it.

---

## 15. COURSE / VIDEO — ⚠️ VIDEO EXISTS, AND THIS NEEDS A DECISION LATER

**Yes, lessons contain video.** `src/pages/LessonView.tsx:236`:

```jsx
{lesson.video_url && (
  <div className="aspect-video bg-black">
    <iframe src={lesson.video_url} allowFullScreen ... />
```

It is an **`<iframe>`** — an embedded third-party player, not a native `<video>` element. That single fact drives everything below.

**The collector is entirely media-unaware.** Grep for `video|media|play|audio` in both collector files: **no matches**. It has no concept of playback.

Current behaviour, reported as-is:

| Situation | What happens today | Why |
|---|---|---|
| **Foreground + video playing** | Records for ~2 minutes, then **stops** | Clicks and scrolls **inside a cross-origin iframe do not fire the parent page's events**. With nothing touched outside the player, the 120s idle rule expires. |
| **Foreground + video paused** | **Identical** — records ~2 min, then stops | The collector cannot tell playing from paused. Same-origin policy blocks it. |
| **Background + video playing** | **Records nothing** | Tab hidden → timer destroyed. (Embedded players typically keep playing audio, so the member *is* consuming content while earning nothing.) |

⚠️ **Concrete consequence:** a member watching a 20-minute lesson attentively and without fidgeting is currently credited **about 2 minutes**. This is the collector's largest known blind spot.

**No change made, as instructed.** The future decision is whether video watching should count, and if so how — player-API events (`postMessage` from the embed) would be the honest route, and that is a real piece of work, not a flag.

---

## 16. ACCURACY PROBE — ⚠️ FUNCTION WORKS, NOT ENOUGH DATA YET

`engagement_probe_report(14)` is installed and executes. It returns **no rows**.

**That is the correct answer, not a failure.** The probe compares post/comment timestamps against activity minutes, and the comparison window starts at the **first collected row — `2026-08-12 02:13 UTC`**, thirteen minutes before this report. No posts or comments have been created since. Zero probes, therefore zero rows.

I cannot report examples because **none exist yet**. Fabricating a coverage figure from three admin rows would be worse than useless.

How to read it in two weeks:

```sql
SELECT * FROM public.engagement_probe_report(14);
```

Two caveats when you do:

- Posts published by the **scheduled-posts cron** have no browser behind them and will always look like misses.
- Content created before `02:13 UTC today` cannot be covered — the window starts at the first row.

⚠️ Note the probe's structural limit: it detects **under-counting** (member was provably present, no minute recorded). It is **blind to over-counting**. That is what the `had_interaction` diagnostic column exists for — the `carried_per_interacted` ratio in `engagement_collector_health()` is the over-counting signal, and it is bounded near 2.0 by the 120s window.

---

## 17. PERFORMANCE

| Measure | Value |
|---|---|
| **Request frequency** | **At most 1 per wall-clock minute per active member.** The 15s timer only *checks*; it sends only on a new minute, only if visible and non-idle. |
| **Request payload** | **38 bytes** — `{"_segment":"feed","_interacted":true}` |
| **Response** | `204 No Content` — empty body |
| **Records per active user/day** | Theoretical ceiling 1,440. Realistically = minutes of genuine attentive use. The 120s idle rule is what keeps this near real usage, not uptime. |
| **Row size** | **56 bytes** |
| **DB write volume estimate** | 50 active members × 60 min/day ≈ 3,000 rows/day ≈ **170 kB/day** raw + index. Over the 40-day retention ≈ 120,000 rows ≈ **7 MB**. |
| **Current table size** | 48 kB (3 rows — almost entirely index/page overhead) |
| **Indexes** | `member_activity_minutes_pkey`, `idx_member_activity_minutes_bucket` |

**Frontend impact:** one `setInterval` at 15s, five `{ passive: true }` listeners, no re-render (all state in refs), and the timer is **destroyed** when hidden. Tests confirm nothing leaks on unmount. No measurable impact.

**Android battery/network:** **not measurable — the collector is not in the installed APK** (§4). Design intent is that a backgrounded app holds zero timers and sends nothing, but that is unverified on a device. It must be measured after the first APK build that includes it.

---

## 18. WHAT IS **NOT** BEING DONE YET — ALL CONFIRMED

- ❌ **Active Engagement is NOT part of Contributor Score.** Verified by md5 — all three scoring functions byte-identical to Phase 1, and no reference to engagement anywhere in their source.
- ❌ **Top Contributors ranking is NOT affected.** Live top 3 identical to the database, computed from posts and comments only.
- ❌ **No 20% weighting is active.** The live score is 45% Posts + 35% Comments = 80% of your model.
- ❌ **No conclusion drawn about engagement data quality.** 3 rows, 1 member, 13 minutes, admin account. Nothing can be concluded and nothing is.
- ❌ **No Phase 2b.** Not started.
- ❌ **No Phase 2c.** Not started.

**Nothing was reset, deleted or altered. No rows were written to produce this report. The collector is still running.**

---

## THREE THINGS TO CARRY FORWARD

1. **Android has no collector.** Until you build an APK from `main`, app users contribute nothing and the Android background/battery behaviour stays unverified.
2. **Video lessons are the biggest blind spot.** Cross-origin iframe → a 20-minute attentive watch earns ~2 minutes. Needs a decision, not a patch.
3. **The segment is discarded, by design.** Phase 2b cannot report per-section usage without a deliberate schema and privacy change.

**STOPPING HERE.** Collector continues. Awaiting your later request for the Active Engagement Data Quality Report.
