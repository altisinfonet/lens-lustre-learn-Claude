# Phase 2 — Active Engagement · AUDIT + DESIGN

**50mm Retina World · 2026-08-11 · NO CODE WRITTEN**

Scope agreed with the owner: items 1–5 were audited this morning and are restated with re-verified counts. Design effort goes to items 6–11, plus two gaps that were not on the list.

---

# PART A — ITEMS 1–5, CONFIRMED

Re-verified against production just now. Nothing has changed except normal growth.

| | This morning | Now |
|---|---|---|
| posts | 193 | **196** |
| post_comments | 162 | **164** |
| profiles | 90 | **90** |
| feed_events | 798 | **845** |
| activity_logs | 6,937 | **7,078** |

**1. Existing tracking — three mechanisms, none usable.**

- `feed_events` — `dwell_ms` is **computed in the browser and inserted by the client**; the RLS policy checks *who* inserts, never *what*, so a member can write 60,000 ms. It also carries `ON DELETE CASCADE` to `posts`, so the history evaporates when a photo is deleted. Feed-only.
- `activity_logs` — only 5 action types exist (login 4,983 / page_view 1,904 / logout 46 / +2). The page-view hook is mounted in **exactly one component**, `Feed.tsx`, and only 33 days of history exist.
- `judge_sessions` — real session data, but judging only, which is excluded anyway.

**2. `last_active_at` — cannot help. Agreed without reservation.**
A bare `setInterval` every 5 minutes that **overwrites a single column**. No history, and no visibility check, so a tab left open overnight keeps writing. It records *that* someone existed, never *how long*. It will not be used, referenced, or derived from.

**3. Web visibility / idle detection — none exists.**
Searched the whole tree for `visibilitychange`, `visibilityState`, `document.hidden`, `requestIdleCallback`. Every hit is ad code (`adSlots.ts` beacon flush, `AdZone`, `RewardedAd`). **Zero idle detection anywhere.**

**4. Capacitor — `appStateChange` is available at zero cost.**
`package.json` contains **no `@capacitor/*` packages at all**; Capacitor is installed only in the Android CI build, and `android-build.yml` line 51 **already installs `@capacitor/app`**. `src/lib/native/authDeepLink.ts` reaches it through a `window.Capacitor` runtime accessor, with a written rule at the top of the file against importing the package. `appStateChange` uses that same accessor — **no package.json change, no new CI install.**

**5. `/admin/*` and `/judge/*` — a single clean test.**
Of 57 routes in `src/App.tsx`, **exactly one** is administrative: `<Route path="/admin/*" element={<AdminPanel />} />`, with 50+ tabs beneath it. `/judge` is a separate exact path. No admin surfaces are embedded inside member pages.

---

# PART B — ITEM 6: WHAT COUNTS AS GENUINE ACTIVITY

This cannot be discovered by reading code — nothing there measures it. It is a product judgement, so here are the options and their costs.

## Two failure modes, in opposite directions

**Over-counting** — a tab left open, a phone in a pocket, a script pretending to be present.
**Under-counting** — someone reading a long Journal article or watching a course lesson is genuinely engaged, but touches nothing for minutes and looks idle.

## Proposed rule

A minute counts when **all** of these hold:

1. A member is signed in
2. `document.visibilityState === 'visible'`
3. On Android, Capacitor reports the app foregrounded (`appStateChange.isActive === true`)
4. A qualifying interaction happened within the idle window

**Qualifying interactions:** `pointerdown`, `keydown`, `touchstart`, `scroll`, and a route change.

**Deliberately excluded: `mousemove`.** A nudged desk or trackpad drift would hold a session "active" indefinitely. Excluding it is the single most effective anti-over-count measure, and it costs almost nothing because reading involves scrolling.

Conditions 2 and 3 are ANDed, so a webview quirk on either side fails **closed** — it stops counting rather than over-counting. That is the correct direction for a scoring input.

## The idle window — your decision

| Window | Over-counts by | Under-counts |
|---|---|---|
| 60 s | ≤1 min per lapse | readers, noticeably |
| **120 s** | ≤2 min per lapse | only very still readers |
| 180 s | ≤3 min per lapse | almost nobody |

**Recommendation: 120 seconds.**

### Why this matters less than it looks

**The 30-minute daily cap absorbs most of the error.** A member who is genuinely engaged will reach 30 credited minutes under any of these windows. The window only changes the outcome for members hovering near the boundary — and for a distracted tab, the maximum gain per lapse is one window's length, capped at 30 minutes total, inside a component worth 20%.

So this is worth getting roughly right, not perfectly right.

## Open question I cannot answer from the code

**Do course lessons contain video?** If a member watches a 10-minute lesson without touching the screen, no window short of 10 minutes counts it. If there is video, playback state should be a qualifying signal. Tell me and I will design for it.

---

# PART C — ITEM 7: MINUTE-BUCKET STORAGE

## `member_activity_minutes`

| Column | Type | Note |
|---|---|---|
| `user_id` | `uuid` | from `auth.uid()` — never a parameter |
| `minute_bucket` | `timestamptz` | `date_trunc('minute', now())` — **server clock, always** |
| `surface` | `text` | `'public'` or `'internal'` · CHECK constraint |
| **PRIMARY KEY** | `(user_id, minute_bucket)` | one row per member per minute, enforced by the database |

No surrogate `id` column — the natural key is the whole point, and a surrogate would permit duplicates.

**Strictest ping wins.** If a member touches `/feed` and then `/admin/users` inside the same minute, the row is upgraded to `internal` and never downgraded. Conservative by design: a minute that was partly administrative does not count, and admin time cannot be laundered by tapping a public page.

## The write path — and a privacy improvement over the earlier draft

`record_activity_minute(_segment text)` — `SECURITY DEFINER`, the only way a row can appear.

The earlier design had the client send `window.location.pathname`. **That is more than we need.** Paths carry member ids and slugs — `/profile/<uuid>`, `/journal/<slug>`, `/post/<uuid>`. Sending them would put a record of *what each member was looking at* into request logs.

**Revised: the client sends only the first path segment** — `"feed"`, `"journal"`, `"admin"`, `"judge"`. That is exactly enough to classify, and it carries no id, no slug, nothing about *which* photo or *whose* profile.

The server then:
1. `_user := auth.uid()` — returns silently if null
2. `_bucket := date_trunc('minute', now())` — the client cannot name a minute
3. `_surface := CASE WHEN _segment IN ('admin','judge') THEN 'internal' ELSE 'public' END`
4. `INSERT … ON CONFLICT` with strictest-wins

**The segment is used and discarded. It is never stored.** We record *that* a member was active, never *what they were reading*.

The client submits no duration, no timestamp, no user id, no count. The only thing it controls is the segment, and claiming `"admin"` only costs the caller credit.

---

# PART D — ITEM 8: DATABASE VOLUME

Measured, not guessed. Distinct members active per day over the last 14 days:

```
13  14  16  19  17  24  24  21  21  19  18  21  32  45
```

30-day average **12**, peak **45**, out of 90 profiles.

| Scenario | Rows/day |
|---|---|
| Typical — 20 members × 30 active min | **600** |
| Heavy — 45 members × 90 active min | **4,050** |

| Horizon | Raw rows |
|---|---|
| 40 days, typical | ~24,000 |
| 40 days, heavy | ~162,000 |
| No pruning, one year, typical | ~220,000 |

Row width is roughly 60 bytes plus the primary-key index — call it 100. **A year unpruned is about 22 MB.** At ten times the membership it is 220 MB. Neither is a problem.

**Network:** at most one request per minute per active member. Twenty members × 60 minutes = **1,200 requests/day**. Negligible.

**Battery:** one 15-second timer that does nothing unless the app is foreground *and* the member has touched the screen inside the idle window. At most one small `fetch` per minute.

---

# PART E — ITEM 11: HOW THE 20% JOINS THE SCORE

*(Taken before items 9 and 10 because it produces a finding that changes the storage design.)*

## The function change is one line

Live today:

```
daily_score = 3 × (450 × post_pts/53 + 350 × comment_pts/55)
```

Phase 2:

```
daily_score = 3 × (450 × post_pts/53 + 350 × comment_pts/55 + 200 × eng_pts/30)
```

Only `contributor_points_since` is replaced. `get_top_contributors_v2` and `get_contributor_scores` are untouched. Rollback is replacing that one function.

**No existing score changes retroactively.** Days before the collector launched have no engagement rows, so they contribute 0 — exactly as they do now. Only days from launch onward can gain. The daily maximum rises from 2,400 to 3,000.

**Rankings will shift** once engagement accrues, in favour of members who read and browse rather than only post. That is the intent of the 20 %.

**One structural care point:** `day_scores` currently FULL OUTER JOINs posts against comments on `(user, day)`. Engagement becomes a third arm of that join — a member with engagement but no posts or comments on a day must still score. Joined on `(user, day)` it stays 1:1, so no row multiplication, but it is the place a Cartesian could creep back in and will be checked explicitly.

## ⚠️ THE FINDING: engagement forces an aggregate table, unlike posts and comments

For Phase 1 you ruled: no daily aggregation tables, the current database state is the source of truth. That works for posts and comments because **each one is a permanent row that can be recounted forever**.

Engagement is different. A minute is not a durable artefact — it is 24,000 to 160,000 rows per 40 days that exist only to be counted. Two consequences:

- Computing the **lifetime** score live means counting every minute row that member ever produced, on every request.
- If raw minutes are ever pruned for privacy or size, **lifetime engagement is destroyed with them**.

So there is a genuine choice here, and it is not a technical one:

| | (a) Keep raw minutes indefinitely | (b) Prune raw at 40 days + keep a daily rollup |
|---|---|---|
| Recomputable from source | ✅ always | ❌ only within 40 days; after that the rollup is authoritative |
| Matches your Phase 1 rule | ✅ | ❌ this is the exception |
| Volume | ~220,000 rows/year (~22 MB) | ~24,000 raw + ~7,300 rollup rows/year |
| Privacy | ✗ a permanent minute-by-minute record of when each member was awake and on their phone | ✅ only a daily total survives |

**My recommendation is (b), and the reason is privacy, not size.** Size is a non-issue either way. But minute-level presence data about real people is not something to hoard, and a daily total is all the score has ever needed. The rollup table would be:

`contributor_engagement_daily (user_id, utc_date, minutes_actual, minutes_public, minutes_credited)` — about 20 rows a day, 7,300 a year.

I am flagging this rather than deciding it, because it is a deliberate exception to a rule you set clearly.

---

# PART F — ITEM 9: ADMIN USER TABLE REPORTING

`src/components/admin/AdminUsers.tsx` is 965 lines and is a **search box, not a paginated table** — you type a name or email and it returns matches. The row already carries roles, badges, last-seen and platform.

**In the row:** one compact cell — `Engagement 30d`, showing *actual* time, e.g. `4h 12m`.

**In a details drawer** (your §20 permits this):

```
Debjani Das                                        Member
───────────────────────────────────────────────────────────
ACTIVE ENGAGEMENT      Total     Public   Internal  Credited
  Today                1h 04m      38m       26m        30m
  Last 7 days          6h 41m    3h 30m    3h 11m     3h 30m
  Last 30 days        21h 18m   14h 30m    6h 48m    14h 30m
  Lifetime            21h 18m   14h 30m    6h 48m    14h 30m
      since 12 Aug 2026 — no engagement data exists before then
───────────────────────────────────────────────────────────
CONTRIBUTOR SCORE
  Contributor Score               2,480
  Last 30 days (internal)      1,204.50
  Eligible for Top Contributors:    Yes
```

Four columns rather than the two originally planned. Your clarification asked to *"accurately distinguish where time was spent"* — showing Internal separately means administrative work is legible as administrative work instead of vanishing into a total.

For the admin account the last line reads `No — admin role`.

Data comes from `admin_get_engagement(_user_ids uuid[])`, batched for the visible rows using the coalescing pattern already proven in `src/lib/ads/adEngagement.ts`.

**Lifetime is stated as "since <launch date>"**, not implied to cover the member's whole history — because it does not, and never will.

---

# PART G — ITEM 10: SECURITY AND RLS

| Threat | Defence |
|---|---|
| Client submits a fake duration | It cannot. The payload is one path segment. |
| Client claims the same minute twice | `PRIMARY KEY (user_id, minute_bucket)`. Physically impossible. |
| Client backdates or forward-dates | The bucket is `date_trunc('minute', now())` on the server. |
| Client claims another member's time | `user_id := auth.uid()`. Not a parameter. |
| Admin time laundered as public | Strictest-ping-wins; any internal ping makes the minute internal, permanently. |
| A member reads their own or others' raw minutes | `member_activity_minutes`: **RLS on, zero policies — nobody**. Reads go through `admin_get_engagement`, gated by `has_role`. |
| Raw time leaked to the public leaderboard | `get_top_contributors_v2` returns a user id, a position and one number. No minutes exist in its output. |
| Scripted presence | Bounded by the 30-minute cap → at most 200 points/day, inside a 20 % component. Posts and comments cannot be forged at all — they are real rows other members can see. |
| RPC flooding | Every call after the first in a minute is a no-op `ON CONFLICT`. Beyond that, Supabase platform limits. |

**Stated plainly: this is tamper-resistant, not tamper-proof.** Foreground attention cannot be measured without some client signal. What makes it acceptable is the cap, and that the other 80 % of the score cannot be faked.

---

# PART H — THE TWO GAPS

## H1. Retention and disclosure

The security section covers who can *read* it. This covers what we *keep* and whether anyone is told.

**Retention** — the decision in Part E: keep raw minutes indefinitely, or prune at 40 days with a daily rollup. I recommend pruning.

**Disclosure** — the platform would begin recording, for every member, which minutes of which days they were awake and using their phone. That is meaningfully more personal than a post count, and no existing policy text covers it.

Recommendation: one plain sentence in the privacy policy — that active time is recorded to calculate the Contributor Score, that it is visible only to administrators, and how long it is kept.

**I would not offer an opt-out.** Opting out would mean forfeiting 20 % of your own score, which is not a real choice. Disclosure, yes; a toggle, no.

## H2. How would we know if the collector is lying?

Once live, an over- or under-counting bug is invisible — the number looks plausible either way. Four checks, run nightly, reporting violations to the existing admin error log:

1. **`credited ≤ 30`** for every member-day. A violation means the cap is broken.
2. **`public + internal = actual`** for every member-day. A violation means surface classification is losing rows.
3. **Minutes ≤ minutes elapsed.** Nobody can have 700 active minutes in a day that is 600 minutes old. A violation means duplicate buckets — which the primary key should make impossible, so it would indicate something worse.
4. **The cross-check that actually catches silent under-counting.** If a member posted a photo or wrote a comment at 14:32 UTC, they were unambiguously active at 14:32 — so there **must** be an activity bucket for that minute. Posts and comments carry exact `created_at` timestamps, entirely independent of the collector.

   Every content row is therefore a free, unfakeable probe. If a meaningful share of them have no matching bucket, the collector is missing time and we know before it has fed a public score for long.

Check 4 is the one I would not ship without.

---

# PART I — PROPOSED PHASING

Each stage is independently reversible and nothing reaches a member's score until the last one.

**2a — Collect only.** Table, RPC, client hook on web and Android. Nothing scored, nothing displayed. Let it run about two weeks, then look at real data with the four checks above. This is the stage that answers "is 120 seconds right?" with evidence instead of opinion.

**2b — Admin reporting.** Column and drawer in Admin → Users. You can see actual member usage. Still not scored.

**2c — Turn on the 20 %.** One function replaced. Only then does engagement affect anyone's Contributor Score or the leaderboard.

Rollback at 2c is replacing one function; at 2a and 2b it is removing additive objects.

---

# DECISIONS NEEDED BEFORE ANY CODE

1. **Idle window** — 60 s, **120 s (recommended)**, or 180 s?
2. **Do course lessons contain video?** If so, playback should be a qualifying signal.
3. **Retention** — keep raw minutes indefinitely (fully recomputable, more invasive), or **prune at 40 days with a daily rollup (recommended, less invasive, and a deliberate exception to your Phase 1 no-aggregates rule)**?
4. **Disclosure** — add a line to the privacy policy?
5. **Phasing** — 2a → 2b → 2c with a pause after each, as above?

Nothing is built until these are answered.
