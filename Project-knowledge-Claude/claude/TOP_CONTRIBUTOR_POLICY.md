# TOP CONTRIBUTOR POLICY — 50mm Retina World

> **This is the single authoritative policy for the Contributor Score and the Top
> Contributors list.** Where any older document disagrees with this one, **this one wins.**
>
> **Status:** Phase 1 and Phase 3 LIVE. Phase 2a (collection only) LIVE. Phase 2b and 2c NOT STARTED.
> **Last updated:** 2026-08-12
> **Superseded by this file:** `CONTRIBUTOR_SCORE_DESIGN_2026-08-11.md`, `CONTRIBUTOR_AUDIT_2026-08-11.md`,
> `CONTRIBUTOR_FINAL_DESIGN_2026-08-11.md`, `PHASE1_PLAN_TOP_CONTRIBUTORS_V2.md` —
> those remain useful as the *record of how the decisions were reached*, but this file is what is TRUE NOW.

---

## 0. THE ONE RULE EVERYTHING ELSE SERVES

> **The Contributor Score must always reflect the activity that currently exists in the database.**

Owner, 2026-08-11. Consequences, all of them deliberate:

- **No ledger. No stored score. No daily snapshot table. No queue. No triggers. No cache.**
- The score is **calculated live, on every call**, from rows that exist right now.
- Delete a photograph → the score **falls**. Delete a comment → it **falls**.
- Delete an account → the member **disappears** from every list on the next call.
- The score is **recalculable from scratch at any time**. There is nothing to reconcile,
  nothing to backfill, nothing that can drift.

An earlier design used an immutable append-only ledger with a never-decreasing score.
**The owner reversed that himself** and the reversal is the foundation of everything here.

---

## 1. THE SCORING MODEL

| Component | Weight | Status |
|---|---|---|
| **Posts (photographs)** | **45%** | ✅ LIVE |
| **Comments WRITTEN by the member** | **35%** | ✅ LIVE |
| **Active Engagement (time present)** | **20%** | ⏸️ **COLLECTING ONLY — NOT SCORED** |

⚠️ **The live score today is 45% + 35% = 80% of this model.** The 20% is deliberately inert.
Do not describe the score as "complete" — it is complete *for Phase 1*.

**Explicitly NOT part of the score, at the owner's instruction:**
❌ No AI · ❌ No quality score · ❌ No subjective evaluation · ❌ No likes-received ·
❌ No comments-received · ❌ No follower count

The score rewards **what a member does**, never what happens to them. A member cannot be
lifted by other people's reactions, and cannot be buried by their absence.

### Window

**Rolling 30 UTC days.** Not a calendar month. UTC is authoritative everywhere.

### Point tiers (per member, per UTC day — anti-spam by design)

**Posts:** first 3 × 10 pts · next 3 (4–6) × 5 pts · next 4 (7–10) × 2 pts · **nothing beyond 10**
→ a maximum of **53 raw post points** in one day.

**Comments written:** first 5 × 4 pts · next 10 (6–15) × 2 pts · next 15 (16–30) × 1 pt · **nothing beyond 30**
→ a maximum of **55 raw comment points** in one day.

### Normalisation

```
day_score = 3 × ( 450 × post_pts / 53  +  350 × comment_pts / 55 )
score     = SUM(day_score) over the last 30 UTC days
```

The ×3 and the 450/350 constants exist for one reason: the owner asked for scores that
**read like 5670 or 4590**, not like 47. They carry no meaning beyond shape.

### Private posts are worth exactly nothing

Verified on production without mutating a row: a private post produces a byte-identical score.

---

## 2. ELIGIBILITY — WHO GETS A SCORE

A member is scored when **all** of these hold:

- a `profiles` row exists (deleting an account removes it instantly), **and**
- a matching `auth.users` row exists, **and**
- `is_suspended = false`, **and**
- `is_banned = false`, **and**
- they do **not** hold the `admin` role.

### Only `admin` is excluded by role

Owner, 2026-08-11, verbatim:

> *"Only the admin role is excluded by account role. Do NOT automatically exclude judge,
> content_editor, registered_photographer, student, normal user."*

**Judges, content editors, registered photographers and students are all fully eligible.**
Verified live 2026-08-12: the platform's 1 judge account has a score.

### The admin account is excluded everywhere, unconditionally

`50mm Retina World` has **12 public posts and 4 comments** and receives **0 rows** from both
public functions. Verified live. This is not incidental — it is an explicit filter.

⚠️ **The deleted-profile trap.** `posts.user_id` has **no foreign key** to `auth.users`, so
deleting an account does **not** delete its posts. The `profiles` join is what makes a deleted
member vanish — it is load-bearing, not decoration. A previous session quoted a stale document
and named a member whose profile had already been deleted. **Never quote an old document as
the current leaderboard. Query it.**

---

## 3. WHERE THE SCORE APPEARS — AND HOW

Two different treatments. They are **not** interchangeable; the owner corrected this once
already.

### Home page — Top Contributors panel

- **Top 3 only.**
- Score sits to the **RIGHT of the name, on ONE line**.
- Label: **"Last 30 Days"**, translated across all 7 locales (`home.last30Days`).
- Rendered by `src/pages/Index.tsx` and `src/components/sidebar/SidebarTopContributors.tsx`
  (the second is the signed-out sidebar only).
- Format: `✦ 5,334` in a right-hand `shrink-0` span with `tabular-nums`.

### Feed and Wall — the badge

- **EVERY member's score is shown**, not just the top 3.
- Score sits **UNDER the name**, joining the existing quiet meta line rather than adding a
  third line:

```
Dipannita Sen
✦ 5,334 · 2h · 🌐
```

- Mounted **once**, in `src/components/post/PostCard.tsx` — which serves the feed *and* the
  wall, so the two surfaces cannot drift apart.
- **Counts up** from zero on first scroll into view: 700 ms, ease-out cubic, once per card.
  `prefers-reduced-motion: reduce` renders the final value instantly.
- A card below the fold correctly shows `0` until you reach it. **That is the animation
  working, not a bug** — this was nearly misreported twice.

### Where it must NOT appear

❌ Comments · ❌ Sidebars (other than the signed-out Top Contributors panel) · ❌ Notification rows

### A score of zero renders nothing

The RPC returns **no row** for an admin, a suspended member, a banned member, a deleted member,
or a genuine zero. Absent means *show nothing* — never a bare `0` sitting beside somebody
else's four figures.

---

## 4. WHAT IS LIVE — DATABASE

**Migration `20260811160000_top_contributors_v2.sql`** (commit `a57bb82`)

| Object | Purpose |
|---|---|
| `contributor_points_since(_since date)` | The calculation. STABLE, SECURITY DEFINER. |
| `get_top_contributors_v2()` | Home page top 3. |
| `get_contributor_scores(_user_ids uuid[])` | Batch lookup for the feed/wall badge. |
| `idx_post_comments_user_created` | Index on `(user_id, created_at)`. |

**`get_top_contributors_v1` was left untouched** as a rollback path.

**Live md5 of each function body — the fingerprint to check against:**

```
contributor_points_since   = 0fb5e020ab35f3345b9646c134300c80
get_contributor_scores     = d835a4edd4ae09f5d5e673ce99bf1af2
get_top_contributors_v2    = 74713575015ac6b56430482fade16590
```

If any of these change, **the scoring model changed** — deliberately or otherwise.
Re-confirmed unchanged 2026-08-12 after the Phase 2a migration.

### Honest performance note

v2 is **slower** than v1: **v1 = 8.58 ms, v2 = 16.48 ms** on production. I had predicted the
opposite and was wrong. (The no-Cartesian-join claim did hold — v1 explodes 137 posts into
1,047 intermediate rows; v2's aggregates total 195. It is simply not the dominant cost.)

---

## 5. WHAT IS LIVE — FRONTEND

| File | Role |
|---|---|
| `src/hooks/useTopContributors.ts` | Calls `get_top_contributors_v2`, key `['top-contributors-v2']`, `staleTime` 5 min |
| `src/lib/contributorScore.ts` | **Batched** fetch — ids asked for in the same microtask become ONE query |
| `src/components/ContributorScore.tsx` | The badge, animation, reduced-motion, cleanup |
| `src/components/post/PostCard.tsx` | The single mount point (feed + wall) |
| `src/pages/Index.tsx` · `src/components/sidebar/SidebarTopContributors.tsx` | Home treatment |
| `src/i18n/home.ts` | `home.last30Days` across en/hi/bn/mr/gu/ta/te |

⚠️ **The batching is not optional.** A feed screen renders ~20 cards. Un-batched that is 20
requests before anything is on screen. The ad engagement bar shipped exactly that bug on
2026-08-11 and had to be fixed the same day. If you touch `contributorScore.ts`, keep the
microtask coalescing and keep the test that pins it.

---

## 6. ACTIVE ENGAGEMENT — PHASE 2A (COLLECTING, NOT SCORED)

**Migration `20260811180000_phase2a_activity_collector.sql`**, applied to production
**2026-08-12 02:13 UTC**. Merged as PR #69, commit `564209b`.

### What a recorded minute means

All four must hold when the 15-second timer fires:

1. somebody is signed in;
2. the tab is **visible** (and inside the app, Capacitor reports active);
3. there was a **real input event within the last 120 seconds** — `pointerdown`, `keydown`,
   `wheel`, `touchstart`, `scroll`;
4. no ping has already gone out for this wall-clock minute.

A left-open tab stops earning after two minutes. A phone in a pocket earns nothing.

> **Owner instruction, absolute: DO NOT use `last_active_at` as Active Engagement.**
> `profiles.last_active_at` is a 5-minute heartbeat that fires regardless of attention. It
> measures uptime. This measures attention. They are not interchangeable.

### Objects

| Object | Purpose |
|---|---|
| `member_activity_minutes` | One row per member per UTC minute. RLS **ON, zero policies**. |
| `contributor_engagement_daily` | Daily rollup. Survives the 40-day prune. Same RLS posture. |
| `record_activity_minute(_segment text, _interacted boolean)` | The **only** write path. `authenticated` only. |
| `rollup_engagement_daily(_utc_date date)` | Idempotent DELETE+INSERT. Applies the 30-min cap. |
| `prune_activity_minutes(_dry_run boolean DEFAULT true)` | 40-day retention. Refuses un-rolled days. |
| `engagement_probe_report(_days int)` | Correctness probe from post/comment timestamps. |
| `engagement_collector_health()` | Aggregate diagnostics + 3 invariants that must read zero. |
| cron `rollup-engagement-daily` | `20 0 * * *` UTC. **No prune job scheduled.** |

### The rules baked into the server

- **The client cannot name the time, the duration, or the user.** The function signature has
  no such parameters — `auth.uid()` and `date_trunc('minute', now())` decide both. Forged
  `_bucket`, `_minutes` and `_user` fields all return **404 PGRST202**: there is no field to
  put a lie in.
- **`/admin` and `/judge` → `internal`, strictest-ping-wins, never unwinds.** A member who
  touches `/admin` and then glances at the feed in the same sixty seconds gets an internal
  minute. Administrative time cannot be laundered into credit.
- **Judges keep their public minutes.** Only `/judge/*` *paths* are internal — the judge
  *account* is fully eligible.
- **30-minute daily cap** applies to **public** minutes only. Internal minutes neither consume
  nor contribute to it. Real usage is stored **uncapped** (`minutes_actual`) so admin
  reporting can show the truth; only `minutes_credited` is capped.
- **Duplicate minutes and multiple tabs are impossible** — primary key `(user_id, minute_bucket)`.
  No client-side leader election is attempted; a leader that dies with its tab would lose
  minutes to buy a guarantee the primary key already gives free.
- **No retry, no offline queue, by design.** A buffer replays a duration the *client* asserts
  happened, which is precisely the claim this design refuses to trust. A dropped ping is a
  lost minute, and that is the correct outcome. Under-counting is the safe error.

### Privacy — stronger than requested

The instruction was *"record only the broad first path segment."*
**The segment is not stored at all.** It is a parameter, used to compute a two-value
`public` / `internal` flag, then discarded. The whole table is:

```
user_id uuid · minute_bucket timestamptz · surface text · had_interaction boolean
```

No paths, no uuids, no slugs, no query strings, no categories.

> Owner: *"a normal member should never be able to query: User X was active at 10:31, 10:32,
> 10:33..."* — RLS is ON with **zero policies**, for members *and* admins, and table grants are
> revoked from `anon` and `authenticated`. Verified live: a signed-in admin gets
> **403 `42501` permission denied** on SELECT, INSERT and DELETE.

⚠️ **The client still needs care.** `pathSegment()` matches an allow-list of declared routes
and maps anything unknown to `other`. Taken literally, "first path segment" would have been a
privacy bug: this app routes **`/:customUrl`** at the top level, so `/dipannita-sen` has a
first segment that **is a member's name**. A new route added later under-reports as `other`
until it is added to the list — recoverable. Leaking a username is not.

⚠️ **Consequence for Phase 2b:** because the segment is discarded, per-section usage
("how much time in Journal vs Courses") **cannot** be reported without a deliberate schema and
privacy change.

### Known blind spots — carry these into the Data Quality Report

1. **Video lessons.** `LessonView.tsx` embeds video in a cross-origin `<iframe>`. Clicks inside
   the player never reach the page, so a member watching a 20-minute lesson attentively is
   credited **about 2 minutes**. The collector cannot tell playing from paused. This is the
   largest known under-count.
2. **Android has no collector yet.** `capacitor.config.ts` sets `webDir: 'dist'` with no
   `server.url` — the app ships a bundled copy of the web build taken at APK build time.
   **Until a new AAB is cut, app users record nothing** and the Android background/battery
   behaviour is unverified on a device.
3. **Screen lock on desktop** does not reliably fire `visibilitychange`. The 120-second idle
   rule is the backstop there. Untested.
4. **The probe detects under-counting, not over-counting.** `had_interaction` and the
   `carried_per_interacted` ratio (bounded near 2.0 by the 120s window) are the over-count
   signal.

---

## 7. WHAT IS EXPLICITLY NOT DONE

- ❌ Active Engagement is **not** part of the Contributor Score.
- ❌ Top Contributors ranking is **not** affected by engagement.
- ❌ No 20% weighting is active.
- ❌ No conclusion has been drawn about engagement data quality.
- ❌ **Phase 2b** (admin reporting / per-member engagement surface) — not started.
- ❌ **Phase 2c** (activating the 20% weight) — not started.
- ❌ Android app carries none of the Top Contributor work — needs an AAB.

**Phase 2b must not start automatically.** The owner will request an *Active Engagement Data
Quality Report* after sufficient collection time, and **that report decides** whether the
120-second rule, the collection behaviour and the 20% model are approved at all.

---

## 8. HOW TO VERIFY ANY CLAIM IN THIS FILE

```sql
-- the live leaderboard (never quote a document for this)
SELECT pr.full_name, round(t.contributor_score), t.rank_position
FROM public.get_top_contributors_v2() t
JOIN public.profiles pr ON pr.id = t.user_id
ORDER BY t.rank_position;

-- has the scoring model changed?
SELECT proname, md5(prosrc) FROM pg_proc
WHERE proname IN ('contributor_points_since','get_top_contributors_v2','get_contributor_scores');

-- is engagement leaking into the score? (must return NO)
SELECT CASE WHEN (SELECT string_agg(prosrc,'') FROM pg_proc
  WHERE proname IN ('contributor_points_since','get_top_contributors_v2','get_contributor_scores'))
  ~* 'engagement|activity_minute|minutes_credited' THEN 'YES' ELSE 'NO' END;

-- collector health, and the three invariants (all must read 0)
SELECT * FROM public.engagement_collector_health();

-- independent accuracy probe (needs real collection time first)
SELECT * FROM public.engagement_probe_report(14);
```

Tests that pin the behaviour:
`src/__tests__/topContributorsV2.test.ts` (14) ·
`src/__tests__/contributorScoreBadge.test.ts` (14) ·
`src/__tests__/engagementHeartbeat.test.ts` (20, 7 mutations all caught).

---

## 9. RELATED DOCUMENTS

| File | What it holds |
|---|---|
| `PHASE1_VERIFICATION_REPORT_2026-08-11.md` | Phase 1 database proof |
| `PHASE3_REPORT_2026-08-11.md` | Frontend rollout |
| `PHASE2_AUDIT_DESIGN_2026-08-11.md` | The Active Engagement audit and design |
| `PHASE2A_COLLECTOR_SHIPPED_2026-08-11.md` | Collector build + migration record |
| `PHASE2A_VERIFICATION_REPORT_2026-08-12.md` | **The 18-point technical verification** |
| `CONTRIBUTOR_FINAL_DESIGN_2026-08-11.md` | How the decisions were reached (history) |

---

## 10. THREE MISTAKES ON THIS FEATURE, RECORDED SO THEY ARE NOT REPEATED

1. **A production bug was diagnosed from a symptom without testing the mechanism**, and the
   false explanation was merged into `main` as a code comment (PR #67). The premise was then
   tested, found false, and corrected in PR #68. **A symptom is a hypothesis, not a finding.**
2. **v2 was claimed to be faster than v1 without measuring.** It is roughly twice as slow.
   **Never state a performance property you have not measured.**
3. **A three-week-old migration comment was quoted as the current leaderboard**, naming a
   member whose profile had already been deleted. The owner caught it. **Query the database;
   never quote a document for live data.**
