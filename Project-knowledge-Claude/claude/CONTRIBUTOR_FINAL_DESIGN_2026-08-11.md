# Contributor Score — FINAL IMPLEMENTATION DESIGN

**50mm Retina World · 2026-08-11 · FOR APPROVAL — NO CODE WRITTEN**

Built on your 17 decisions. Everything factual below was verified against the live database or `origin/main` at `5b7874f`.

---

## 0. THE ONE THING TO READ FIRST

**Nothing existing gets modified. `get_top_contributors_v1` stays exactly where it is.**

I add `get_top_contributors_v2` alongside it. The switch-over is **one line** in `src/hooks/useTopContributors.ts`. If anything is wrong, reverting that line restores today's behaviour instantly — no migration to undo, no data to restore.

The only changes to anything that already exists are **two new indexes** (additive, harmless) and **three AFTER-DELETE triggers** that do nothing but enqueue a message.

---

## 1. FINAL DATABASE SCHEMA

Five new tables. No existing table gains or loses a column.

```
  posts ─┐
post_comments ─┼─► [AFTER DELETE triggers] ─► pgmq.q_post_jobs ─► recompute
image_comments ─┘         │                    (existing queue, 5s)
                          │
                          ▼
            contributor_preserved_comments      ← fairness (Decision 6)
                          │
  member_activity_minutes │                     ← the only NEW raw data
            │             │
            └──────┬──────┘
                   ▼
        contributor_daily_metrics               ← derived, RECALCULABLE
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
 contributor_scores    contributor_top_cache
 (lifetime + 30d,      (3 rows, 15-min refresh)
  per member)                 │
        │                     ▼
        ▼               Home page top 3
  Score badge under name
```

---

## 2. EXACT COLUMNS AND DATA TYPES

### 2.1 `member_activity_minutes` — presence (the only genuinely new raw data)

| Column | Type | Null | Note |
|---|---|---|---|
| `user_id` | `uuid` | no | from `auth.uid()`, never from the client |
| `minute_bucket` | `timestamptz` | no | `date_trunc('minute', now())` — **server time only** |
| `surface` | `text` | no | `'public'` or `'internal'` · CHECK constraint |
| **PRIMARY KEY** | `(user_id, minute_bucket)` | | one row per member per minute, enforced by the database |

**`surface` classification is done by the server**, from the path the client reports:

```
path starts with '/admin'  →  'internal'
path starts with '/judge'  →  'internal'
everything else            →  'public'
```

**The strictest ping wins.** If a member is on `/feed` and then `/admin/users` inside the same minute, the row is upgraded to `'internal'` and never downgraded:

```
ON CONFLICT (user_id, minute_bucket) DO UPDATE
  SET surface = 'internal'
  WHERE member_activity_minutes.surface = 'public'
    AND EXCLUDED.surface = 'internal'
```

This is deliberately conservative. Your §10 says Admin Panel activity must **never** contribute; a minute that was partly administrative therefore does not count. It is impossible to launder admin time into contributor credit by touching a public page.

Retention: pruned after **40 days**. Daily rollups are permanent, so lifetime engagement survives the prune.

---

### 2.2 `contributor_daily_metrics` — derived, recalculable

| Column | Type | Null | Note |
|---|---|---|---|
| `user_id` | `uuid` | no | |
| `utc_date` | `date` | no | UTC calendar day |
| `posts_count` | `integer` | no, default 0 | qualifying posts that day |
| `comments_count` | `integer` | no, default 0 | qualifying comments **written** |
| `active_minutes_actual` | `integer` | no, default 0 | every minute, any surface — **admin reporting** |
| `active_minutes_public` | `integer` | no, default 0 | public-surface minutes only |
| `active_minutes_credited` | `integer` | no, default 0 | `LEAST(active_minutes_public, 30)` — **scoring** |
| `post_points` | `integer` | no, default 0 | after tiers, max 53 |
| `comment_points` | `integer` | no, default 0 | after tiers, max 55 |
| `engagement_points` | `integer` | no, default 0 | = `active_minutes_credited`, max 30 |
| `daily_score` | `numeric(10,2)` | no, default 0 | weighted, max 1000.00 |
| `computed_at` | `timestamptz` | no, default `now()` | |
| **PRIMARY KEY** | `(user_id, utc_date)` | | |

**This table is a cache, never a ledger.** Any row can be deleted and rebuilt from source at any moment and must produce the identical result. That property is what makes Decisions 4, 16 and test 25 all true simultaneously.

Three engagement columns rather than one — this is your §13 made physical. `actual` is what the Admin User Table shows. `credited` is what scoring uses. They can never be confused because they are different columns.

---

### 2.3 `contributor_preserved_comments` — Decision 6, the fairness rule

| Column | Type | Null | Note |
|---|---|---|---|
| `comment_id` | `uuid` | no | **PRIMARY KEY** — the destroyed comment's own id |
| `source` | `text` | no | `'post_comments'` or `'image_comments'` · CHECK |
| `user_id` | `uuid` | no | the author who keeps the credit |
| `utc_date` | `date` | no | `(created_at AT TIME ZONE 'UTC')::date` of the original comment |
| `reason` | `text` | no | `'post_deleted'` or `'parent_comment_deleted'` · CHECK |
| `preserved_at` | `timestamptz` | no, default `now()` | |

**Why the comment's own id is the primary key:** it makes preservation idempotent and makes double-counting structurally impossible. Section 13 explains the mechanism.

---

### 2.4 `contributor_scores` — materialised per member

| Column | Type | Null | Note |
|---|---|---|---|
| `user_id` | `uuid` | no | **PRIMARY KEY** |
| `lifetime_score` | `integer` | no, default 0 | `ROUND(SUM(daily_score))` over all dates — **the public badge** |
| `score_30d` | `numeric(10,2)` | no, default 0 | last 30 UTC days — internal ranking, not public |
| `is_eligible` | `boolean` | no, default true | live, not suspended/banned, not `admin` |
| `updated_at` | `timestamptz` | no, default `now()` | |

The badge appears next to names throughout the feed. Summing `contributor_daily_metrics` on every render would be wasteful, so it is materialised here and refreshed whenever a day is recomputed.

---

### 2.5 `contributor_top_cache` — 3 rows, that is all

| Column | Type | Null | Note |
|---|---|---|---|
| `position` | `smallint` | no | **PRIMARY KEY** · CHECK between 1 and 3 |
| `user_id` | `uuid` | no | |
| `score_30d` | `numeric(10,2)` | no | never exposed publicly (your §5) |
| `refreshed_at` | `timestamptz` | no, default `now()` | |

The Home page reads three rows by primary key. Nothing else.

---

## 3. INDEXES

| Index | Table | Status |
|---|---|---|
| `(user_id, created_at)` | `post_comments` | **NEW — REQUIRED.** Audit Finding I1: every existing index is keyed by `post_id`. Counting comments *written by a member* has nothing to use today. |
| `(user_id, created_at)` | `image_comments` | **NEW — REQUIRED.** Same reason. |
| `(user_id, minute_bucket)` | `member_activity_minutes` | new table primary key |
| `(minute_bucket)` | `member_activity_minutes` | new — for the 40-day prune |
| `(user_id, utc_date)` | `contributor_daily_metrics` | new table primary key |
| `(utc_date)` | `contributor_daily_metrics` | new — for the rolling 30-day sweep |
| `(user_id, utc_date)` | `contributor_preserved_comments` | new |
| `(user_id, created_at)` | `posts` | ✅ **already exists** as `idx_posts_user_id_created_at` — nothing to add |

Two new indexes on existing tables. At 162 and 0 rows respectively they build instantly and are invisible to the running site.

---

## 4. RLS POLICIES

| Table | RLS | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|---|
| `member_activity_minutes` | **ON** | **no policy — nobody** | **no policy — nobody** |
| `contributor_daily_metrics` | **ON** | **no policy — nobody** | **no policy — nobody** |
| `contributor_preserved_comments` | **ON** | **no policy — nobody** | **no policy — nobody** |
| `contributor_scores` | **ON** | `authenticated` + `anon`: eligible rows only | **no policy — nobody** |
| `contributor_top_cache` | **ON** | `authenticated` + `anon`: all 3 rows | **no policy — nobody** |

**RLS on with zero write policies means the write is refused, full stop.** There is no "admin can write" escape hatch, because there is no legitimate reason for a human to write a score. Every write happens inside a `SECURITY DEFINER` function, which bypasses RLS by design.

Admins read raw engagement through `admin_get_engagement()`, not through the table. That is deliberate: the function can enforce `has_role()` and shape the output; a table policy cannot.

`contributor_scores` is the one table members can read directly, and only for eligible members — so the badge cannot leak a score for the admin account or a suspended member.

---

## 5. RPCs AND FUNCTIONS

All `SECURITY DEFINER`, all `SET search_path = 'public'`, following the pattern already used across your migrations.

### 5.1 Write path (one function, one entry point)

**`record_activity_minute(_path text) RETURNS void`**

The **only** way a row can enter `member_activity_minutes`.

1. `_user := auth.uid()` — returns silently if null (signed out).
2. `_bucket := date_trunc('minute', now())` — **server clock, always**. The client cannot name a minute.
3. `_surface := CASE WHEN _path LIKE '/admin%' OR _path LIKE '/judge%' THEN 'internal' ELSE 'public' END`
4. INSERT … ON CONFLICT, strictest-wins (section 2.1).

The client sends **a path and nothing else**. No duration, no timestamp, no user id, no count. There is nothing in the payload worth forging: naming `/admin` only harms the caller.

Grants: `REVOKE ALL FROM public, anon` · `GRANT EXECUTE TO authenticated`.

### 5.2 The scoring core

**`recompute_contributor_day(_user uuid, _date date) RETURNS void`**

The single source of scoring truth. Called by the queue, by the nightly rollup and by the backfill — never by a client.

```
posts_count    ← posts where user_id = _user
                   and privacy = 'public'
                   and (created_at at time zone 'UTC')::date = _date

comments_count ← (live post_comments by _user on _date)
               + (live image_comments by _user on _date, is_flagged = false)
               + (contributor_preserved_comments for _user on _date)
                 — counted DISTINCT by comment id

active_minutes_actual   ← count(*) from member_activity_minutes, any surface
active_minutes_public   ← count(*) where surface = 'public'
active_minutes_credited ← LEAST(active_minutes_public, 30)

post_points       ← tier ladder (section 11)
comment_points    ← tier ladder (section 11)
engagement_points ← active_minutes_credited

daily_score ← ROUND( 450 * post_points/53.0
                   + 350 * comment_points/55.0
                   + 200 * engagement_points/30.0 , 2)

DELETE the (user, date) row, INSERT the fresh one, then refresh contributor_scores.
```

**Idempotent by construction** — it deletes and rewrites, never increments. Run it a thousand times, get the same row. That is test 25, satisfied structurally rather than by care.

### 5.3 The rest

| Function | Purpose | Grants |
|---|---|---|
| `is_contributor_eligible(_user uuid) → boolean` | section 6 | internal |
| `pj_handle_recompute_contributor_day(_msg jsonb)` | new pgmq handler, wired into the **existing** `process_post_jobs` | internal |
| `rollup_contributor_daily()` | nightly safety net | scheduler only |
| `refresh_contributor_recent()` | 15-min: recompute today for members who pinged recently | scheduler only |
| `refresh_top_contributors()` | rebuild the 3-row cache | scheduler only |
| `get_top_contributors_v2()` | Home page. **Returns user_id and position only — no score, no minutes** (your §5, §19) | `anon`, `authenticated` |
| `get_contributor_scores(_user_ids uuid[])` | badge, batched | `anon`, `authenticated` |
| `admin_get_engagement(_user_ids uuid[])` | actual minutes + breakdown | `authenticated` only, `has_role()` check inside |
| `backfill_contributor_history()` | one-off, section 16 | scheduler only |
| `prune_activity_minutes()` | 40-day retention | scheduler only |

---

## 6. ELIGIBILITY — DECISION 1, EXACTLY AS YOU WROTE IT

```
is_contributor_eligible(_user) =
      account exists in auth.users
  AND profiles.is_suspended = false
  AND profiles.is_banned    = false
  AND NOT EXISTS (SELECT 1 FROM user_roles
                  WHERE user_id = _user AND role = 'admin')
```

**`admin` is the only role excluded. Nothing else.** `judge`, `content_editor`, `registered_photographer`, `student` and `user` are all eligible.

I am **not** writing a generic "internal roles" rule, exactly as you instructed. The exclusion list is one literal value, so a role added to the enum in future cannot silently become excluded.

Verified live: `is_banned` and `is_suspended` both exist on `profiles`; 0 accounts suspended today. Role counts: `admin`=1, `judge`=1, `user`=90.

**Note the consequence:** the single live `judge` account becomes eligible for Top Contributors the day this ships. That follows directly from your decision and is intended — but the top 3 can change because of it.

### Account eligibility and activity eligibility are separate — as you specified

| Case | Engagement credited? | Eligible for top 3? |
|---|---|---|
| admin on `/admin/*` | **No** (internal surface) | **No** (admin role) |
| admin on `/feed` | Yes, recorded as public | **No** (admin role) |
| judge on `/judge` | **No** (internal surface) | **Yes** |
| judge on `/feed` | **Yes** | **Yes** |
| member on `/admin/*` | **No** (internal surface) | Yes |
| member on `/feed` | **Yes** | Yes |

Rows 3 and 4 are the ones your clarification exists to make unambiguous, and they are what this design implements.

---

## 7. ACTIVE ENGAGEMENT COLLECTOR — ARCHITECTURE

```
CLIENT                                    SERVER
──────                                    ──────
visible?         ─┐
recent input?    ─┼─► once per minute ──► record_activity_minute('/feed')
foreground?      ─┘        │                        │
                           │              user_id  ← auth.uid()
                    sends ONLY a path     bucket   ← now()  ← SERVER CLOCK
                                          surface  ← path classification
                                                    │
                                          PK (user_id, minute_bucket)
                                          makes a second claim on the
                                          same minute physically impossible
```

Everything that could be gamed is decided on the server. The client's entire influence is *which page it says it is on*, and claiming `/admin` only costs the caller credit.

**The honest limit, stated plainly:** a scripted client could keep a fake session "present" and earn up to 30 credited minutes a day. This is tamper-**resistant**, not tamper-proof — measuring foreground attention without any client signal is not possible. What bounds it is your own 30-minute cap: the maximum a perfect cheater gains is the 20 % component, capped at 200 points a day, and **posts and comments cannot be forged at all** because they are real rows other members can see.

---

## 8. WEB IMPLEMENTATION

One hook, `useEngagementHeartbeat()`, mounted **once** in `src/components/Layout.tsx` — beside the existing `useLastActive()` call, which I am **not touching** (audit risk #5: it writes to `profiles`, which is realtime-published and drives the admin "who is active" display).

**Activity signals** (all `{ passive: true }`): `pointerdown`, `keydown`, `touchstart`, `scroll`, and `mousemove` throttled to once per second. Each sets `lastInputAt = Date.now()`.

**Visibility:** `visibilitychange` → when hidden, stop; when visible again, reset `lastInputAt` so returning counts as activity.

**The tick:** a single `setInterval` at **15 seconds** which fires the RPC only when *all* of:

- a member is signed in
- `document.visibilityState === 'visible'`
- `Date.now() - lastInputAt < 60_000` (the idle timeout)
- the current UTC minute is not the minute already pinged
- (in the app) Capacitor reports foreground

A 15-second tick with a per-minute guard means **at most one network call per minute** while genuinely active, and no missed minutes at boundaries. Idle, backgrounded or signed out costs **zero** requests.

Transport is `supabase.rpc(...)`, which carries the member's own JWT.

> ⚠️ **Deliberately NOT the `adSlots.ts` beacon path.** That pipeline authenticates with the **anon key** (`Bearer ${SUPABASE_KEY}`), so anything it writes is forgeable by anyone. It is right for ad impressions and wrong for this.

Failures are swallowed silently. A missed minute is a rounding error; a toast would be a bug.

---

## 9. ANDROID / CAPACITOR IMPLEMENTATION

### ✅ Verified: no new dependency is required

This matters because of your standing rule against background dependency changes, so I checked rather than assumed:

- `package.json` contains **no `@capacitor/*` packages at all** — Capacitor is installed only inside the Android CI build.
- `android-build.yml` line 51 already installs **`@capacitor/app`**.
- `src/lib/native/authDeepLink.ts` already uses `cap()?.Plugins?.App` for `appUrlOpen`, through a `window.Capacitor` runtime accessor, with the rule written at the top of the file: *"this file must NOT import any @capacitor/* package."*

So `appStateChange` is reached through **the exact same runtime accessor that already works**, with **zero package.json changes** and zero new CI installs.

### Behaviour

```ts
App.addListener('appStateChange', ({ isActive }) => { … })
```

- `isActive === false` → treat exactly like `visibilityState === 'hidden'`: stop pinging immediately.
- `isActive === true` → resume and reset the idle timer.
- **Screen lock, home button, app switcher, incoming call** all produce `isActive: false`, so none of them accrue time.
- On the web build the listener is never installed (`isNativeCapacitorApp()` is false) and `visibilitychange` alone governs.

Both signals are ANDed, so a webview quirk on either side fails **closed** — it stops counting rather than over-counting. That is the correct direction for a scoring input.

The small type extension for `appStateChange` follows the documented no-import pattern already in that file.

---

## 10. ADMIN USER TABLE IMPLEMENTATION

`src/components/admin/AdminUsers.tsx` is 965 lines and, as the audit found, is a **search box rather than a paginated table** — you type a name or email and it returns matches. The row is already dense with roles, badges, last-seen and platform.

### One column in the row, everything else in a drawer (your §20 allows this)

**Added to the row:** a single compact cell — **`Engagement 30d`** showing *actual* time, e.g. `4h 12m`.

**Clicking the row opens a details drawer:**

```
Debjani Das                                    Member
────────────────────────────────────────────────────
ACTIVE ENGAGEMENT              Actual      Credited
  Today                        1h 04m          30m
  Last 7 days                  6h 41m       3h 30m
  Last 30 days                21h 18m      14h 30m
  Lifetime                     21h 18m      14h 30m
────────────────────────────────────────────────────
CONTRIBUTOR SCORE
  Lifetime                      2,480
  Last 30 days (internal)       1,204.50
  Posts contributing               34
  Comments contributing            96
────────────────────────────────────────────────────
  Eligible for Top Contributors:  Yes
```

For the admin account the same drawer renders, with the last line reading:

```
  Eligible for Top Contributors:  No — admin role
```

Your §12 and §13, exactly: **Actual** is shown for administrative reporting, **Credited** sits beside it so the two can never be mistaken for one another, and neither can lift an admin account into the ranking.

Data comes from `admin_get_engagement(_user_ids uuid[])`, batched for the visible rows using the same coalescing pattern already proven in `src/lib/ads/adEngagement.ts`.

**Lifetime engagement caveat, stated in the drawer itself:** lifetime is measured *from the collector's launch date*, not from the member's join date, because no historical engagement data exists (Decision 10). The drawer will show "since 12 Aug 2026" rather than implying it covers their whole membership.

---

## 11. THE MATHS — TIERS, WEIGHTS, WORKED EXAMPLES

### Daily tiers

**Posts** (max **53**/day) · **Comments written** (max **55**/day) · **Engagement** (max **30**/day)

| Posts | pts each | cumulative | | Comments | pts each | cumulative |
|---|---|---|---|---|---|---|
| 1st – 3rd | 10 | 30 | | 1st – 5th | 4 | 20 |
| 4th – 6th | 5 | 45 | | 6th – 15th | 2 | 40 |
| 7th – 10th | 2 | **53** | | 16th – 30th | 1 | **55** |
| 11th + | 0 | 53 | | 31st + | 0 | 55 |

### Weighting

```
daily_score = 450 × (post_points / 53)
            + 350 × (comment_points / 55)
            + 200 × (engagement_points / 30)
```

**A perfect day is exactly 1000.00.** Maximum 450 from posts, 350 from comments, 200 from engagement — your 45 / 35 / 20 is literal, not approximate.

### Worked examples

| A day of… | post_pts | cmt_pts | eng_pts | daily_score |
|---|---:|---:|---:|---:|
| 1 post | 10 | 0 | 0 | **84.91** |
| 3 posts | 30 | 0 | 0 | **254.72** |
| 10 posts | 53 | 0 | 0 | **450.00** |
| 40 posts | 53 | 0 | 0 | **450.00** ← flooding gains nothing |
| 5 comments | 0 | 20 | 0 | **127.27** |
| 30 comments | 0 | 55 | 0 | **350.00** |
| 3 posts + 10 comments + 20 min | 30 | 30 | 20 | **588.35** |
| perfect day, collector live | 53 | 55 | 30 | **1000.00** |
| perfect day, before collector | 53 | 55 | 0 | **800.00** |

**Consistency beats bursts, by design.** One photo a day for 30 days = **2,547**. Thirty photos in one day = **450**. That is the whole point of diminishing returns.

Until the collector has been live a while, everyone is measured on the same 800 — nobody is disadvantaged, and because the lifetime score is a running sum, the missing 200 simply becomes available to everyone from the day it launches. **No past score is ever recalculated for that.**

### Your Decision-16 deletion example, confirmed

```
10 posts → 30 + 15 + 8 = 53 points
delete 1 → 9 posts → 30 + 15 + 6 = 51 points
53 → 51 ✓   (not 53 → 43)
```

The recompute counts the 9 surviving posts and re-runs the ladder from scratch. There is no subtraction anywhere in the code, so this is automatic rather than remembered.

---

## 12. LIFETIME AND ROLLING 30-DAY CALCULATION

```
lifetime_score = ROUND( SUM(daily_score) )                      -- all dates
score_30d      = SUM(daily_score)  WHERE utc_date >= (now() AT TIME ZONE 'UTC')::date - 29
```

30 UTC dates including today. When the UTC date rolls over, the oldest day leaves and the window moves — automatically, with no job required, because it is a `WHERE` clause and not a stored value.

**Public visibility, per your Decision 4 and Decision 5:**

| Number | Public? |
|---|---|
| `lifetime_score` — e.g. `2,480` | **YES** — this is the badge under the member's name |
| `score_30d` | **NO** — ranking only, never rendered |
| position 1 / 2 / 3 | **YES** |
| any engagement minutes | **NEVER** public (your §19, §22) |

Ranking is `ORDER BY score_30d DESC LIMIT 3`. Any 0–100 normalisation would be a monotonic transform of the same number and produce an identical ordering, so I am not adding one for ranking; `score_30d` is exposed to admins in the drawer for auditing and nowhere else.

---

## 13. DELETE AND CASCADE HANDLING — DECISION 6

This is the most delicate part of the build, so it is spelled out completely.

### The verified cascade map

```
DELETE a post
   ├─→ post_comments   ON DELETE CASCADE   ← OTHER members' comments destroyed
   │      └─→ replies  ON DELETE CASCADE
   ├─→ post_reactions  ON DELETE CASCADE
   └─→ feed_events     ON DELETE CASCADE

DELETE a comment
   └─→ its replies     ON DELETE CASCADE   ← OTHER members' replies destroyed
```

Every delete on this platform is a **hard** `DELETE` — `posts` has no `deleted_at` or `is_deleted` column. Once the cascade runs, the row and its `created_at` are gone forever.

### The mechanism

**Step 1 — `BEFORE DELETE` on `posts`: preserve other people's work.**

A `BEFORE DELETE` row trigger on `posts` runs **before** Postgres fires the foreign-key cascade (the cascade is implemented as an internal `AFTER` constraint trigger). So at that instant the comments still exist and can be read.

The trigger copies every comment on that post **whose author is not the person doing the deleting** into `contributor_preserved_comments`, with the comment's own `id` as the primary key and its original UTC date.

```
INSERT INTO contributor_preserved_comments (comment_id, source, user_id, utc_date, reason)
SELECT c.id, 'post_comments', c.user_id,
       (c.created_at AT TIME ZONE 'UTC')::date, 'post_deleted'
FROM post_comments c
WHERE c.post_id = OLD.id
  AND c.user_id <> COALESCE(auth.uid(), OLD.user_id)
ON CONFLICT (comment_id) DO NOTHING;
```

The post owner's own comments on their own post are **not** preserved — they chose to delete it.

**Step 2 — `BEFORE DELETE` on `post_comments`: preserve other people's replies.**

Same logic one level down: when a comment is deleted, its replies by *other* members are preserved. A member deleting their own comment does not strip credit from everyone who replied to it.

**Step 3 — `AFTER DELETE`: enqueue, and only enqueue.**

`AFTER DELETE` triggers on `posts`, `post_comments` and `image_comments` push `{user_id, utc_date}` onto the **existing** `pgmq.q_post_jobs`, de-duplicated per `(user_id, utc_date)` so one post with 40 comments from one member on one day produces **one** job, not 40.

These triggers do **nothing else**. They are wrapped so they can never raise. Your §17 is explicit and the audit flagged it as HIGH risk: **a trigger that throws would make deleting a post fail on a live site.**

**Step 4 — recompute, ~5 seconds later.**

`process-post-jobs` (running every 5 seconds, verified live) calls `recompute_contributor_day`, which counts live comments **plus** preserved comments, `DISTINCT` by comment id.

### Why double-counting is impossible

Preservation and deletion happen in the **same transaction** — by the time any recompute can run, the live row is gone. And `comment_id` being the primary key of the preservation table means preserving twice is a no-op. So a comment is counted exactly once, always, whichever side of the transaction it is read from.

### The resulting behaviour

| What happened | Who loses points |
|---|---|
| Member deletes their own post | **The post owner** loses the post. Commenters keep everything. |
| Member deletes their own comment | **That member** loses that comment. |
| Member deletes their own comment that has replies | **That member** only. Repliers keep theirs. |
| Admin deletes a post for abuse | **The post owner.** Commenters keep theirs. |
| Admin deletes a comment for abuse | **That comment's author** — the row is deleted directly, not by cascade, so nothing is preserved. |
| Account deleted | Everything goes; the account is ineligible anyway. |

Row 5 is worth noting: moderation deletion of a comment **does** cost points, because it is a direct delete rather than a cascade. That is your §7 ("exclude comments already rejected/blocked/deleted according to existing application logic") and it falls out of the design without a special case.

---

## 14. QUEUE JOBS

**Reusing `pgmq.q_post_jobs` and `process_post_jobs` — no second queue**, per your Decision 17.

New message type:

```json
{ "type": "recompute_contributor_day", "user_id": "…", "utc_date": "2026-08-11" }
```

New handler `pj_handle_recompute_contributor_day` added to the `process_post_jobs` dispatch alongside the four that exist today.

**Enqueued by:**

| Event | Days enqueued |
|---|---|
| post created | owner, post's UTC date |
| post deleted | owner + every distinct preserved commenter/date (de-duplicated) |
| comment created | author, comment's UTC date |
| comment deleted | author + every distinct preserved replier/date |

**Volume:** the platform currently creates about 2–11 posts a day and has 162 comments in total. This adds a few jobs a day to a queue that drains every 5 seconds. Negligible — but the handler is still batch-bounded so it can never starve notification delivery, which shares this queue.

---

## 15. CACHE STRATEGY

| Layer | Mechanism | Freshness |
|---|---|---|
| `contributor_daily_metrics` | rewritten by recompute | ~5 s after any post/comment change |
| `contributor_scores` | refreshed inside recompute | ~5 s |
| engagement's effect on today | `refresh_contributor_recent()` — recomputes today only for members who pinged in the last 15 min | 15 min |
| `contributor_top_cache` | `refresh_top_contributors()` | 15 min |
| Home page (client) | react-query `staleTime` **15 min** | 15 min |
| Badge (client) | batched `get_contributor_scores`, `staleTime` **15 min** | 15 min |

Within your §15 window of 15–30 minutes.

> Note: the current hook uses `staleTime: 5 * 60 * 1000` (5 minutes), below your specified range. Moving to 15 minutes reduces load as well as complying.

**Badge fetching:** `get_contributor_scores(uuid[])` is batched with the microtask-coalescing pattern already written and tested in `src/lib/ads/adEngagement.ts` — a feed rendering 20 cards makes **one** request, not 20. That mistake has already been made once on this codebase and fixed; this reuses the fix rather than repeating it.

---

## 16. BACKFILL STRATEGY

**Posts and comments: yes. Engagement: never fabricated.** Exactly your Decision 10.

`backfill_contributor_history()` collects every distinct `(user_id, utc_date)` appearing in `posts`, `post_comments` and `image_comments`, and calls `recompute_contributor_day` for each.

Live volumes make this trivial: **193 posts, 162 comments, 0 image comments, 90 profiles** — roughly 200–300 distinct member-days. It runs in seconds.

For every backfilled day, `active_minutes_actual = active_minutes_public = active_minutes_credited = 0`, because `member_activity_minutes` has no rows before launch. Engagement contributes **0** to every historical day for **every** member equally.

**I will not derive engagement from `last_active_at`, `activity_logs` or `feed_events`** — you forbade it, and the audit shows why each is unusable: `last_active_at` keeps no history at all, `activity_logs` covers only 33 days and logs page views from a single component, and `feed_events` carries client-supplied `dwell_ms` that cascades away with its post.

**Consequence to expect:** lifetime scores at launch will be **posts-and-comments only**. The engagement component begins accruing the day the collector ships and never retro-fills. Because lifetime is a running sum, nothing needs recalculating when it does.

---

## 17. SECURITY MODEL

| Threat | Defence |
|---|---|
| Client submits a fake score | No table accepts a client write. RLS on, zero write policies. |
| Client submits fake minutes | The client submits **a path**. Never a duration, timestamp, count or user id. |
| Client claims the same minute repeatedly | `PRIMARY KEY (user_id, minute_bucket)`. Physically impossible. |
| Client backdates or forward-dates minutes | The bucket is `date_trunc('minute', now())` on the server. The client has no say. |
| Client claims another member's minutes | `user_id := auth.uid()`. Not a parameter. |
| Admin time laundered as public | Strictest-ping-wins: any internal ping makes the whole minute internal, permanently. |
| Admin account ranks in the top 3 | `is_contributor_eligible` excludes `role = 'admin'` **inside the ranking query**, server-side, per your §5. Not a frontend filter. |
| Suspended/deleted account ranks | Same function checks `auth.users`, `is_suspended`, `is_banned`. This also fixes audit Finding C5, a real gap in the current v1. |
| Raw engagement leaked to members | `member_activity_minutes` has no SELECT policy for anyone. `get_top_contributors_v2` returns no minutes. Only `admin_get_engagement` exposes them, gated by `has_role`. |
| A member reads another's score inputs | `contributor_daily_metrics` has no SELECT policy for anyone. |
| Comment farming | Existing `enforce_comment_blocklist()` trigger, unchanged, plus the 55-point daily ceiling. **No new duplicate-detection, no AI, no text scoring** — your Decision 7. |
| Post flooding | 53-point daily ceiling. |
| Scripted presence | Bounded by the 30-minute cap → max 200 points/day. Stated as a known limit, not claimed as solved. |
| API flood on the ping RPC | Every call after the first in a minute is a no-op `ON CONFLICT`. Beyond that, Supabase's platform rate limits apply. |

`get_top_contributors_v2` is `SECURITY DEFINER` and executable by `anon`, like v1 — a public leaderboard has to be. **That is exactly why it returns positions and user ids only.**

---

## 18. PERFORMANCE IMPACT

### What gets faster

The current `get_top_contributors_v1` runs a **three-way cartesian LEFT JOIN** — a post with 10 reactions and 8 comments produces 80 intermediate rows before `COUNT(DISTINCT)` cleans up. It runs on every Home page load that misses the 5-minute cache.

After: the Home page reads **three rows by primary key**. The counting happens once every 15 minutes in the background. Home TTFB is currently ~1.6 s and this removes one of the queries contributing to it.

### What gets added

| | Volume |
|---|---|
| Engagement writes | ≤ 1 row per active member per minute. ~30 daily actives × ~60 min ≈ **1,800 rows/day** |
| `member_activity_minutes` steady state | 40-day retention ≈ **72,000 rows** |
| `contributor_daily_metrics` | ≈ 90 members × 365 days ≈ **33,000 rows/year** |
| Recompute jobs | a few dozen a day |
| Scheduled work | 15-min cache refresh + one nightly rollup |

All small. The 15-minute refresh and the nightly rollup are scheduled clear of the busy 03:00–03:30 UTC window (four existing jobs run there).

### Client cost

At most one `fetch` per minute while genuinely active. Zero while idle, backgrounded, screen-locked or signed out — which is most of the time. Battery impact on Android is a single 15-second timer that does nothing unless the app is foreground **and** the member has touched the screen in the last minute.

---

## 19. COMPLETE TEST PLAN

### Your 26 required tests (§24)

| # | Test | How |
|---|---|---|
| 1 | New post increases contributor activity | recompute, assert `posts_count` and `daily_score` |
| 2 | New comment written increases activity | recompute, assert `comments_count` |
| 3 | Comment **received** does NOT | comment by B on A's post → A's `comments_count` unchanged |
| 4 | Ad comments do NOT | row in `ad_creative_comments` → no change |
| 5 | Deleted post reduces the score | 10 → 9 posts, assert 53 → 51 |
| 6 | Deleted comment reduces the score | author deletes own comment |
| 7 | Deletion outside the 30-day window does not affect the 30-day score | delete a 45-day-old post; `score_30d` unchanged, `lifetime_score` drops |
| 8 | Deletion inside the window affects the leaderboard | delete a 3-day-old post; both drop |
| 9 | New activity enters the rolling window | |
| 10 | Activity older than 30 days leaves it | date-boundary fixture |
| 11 | Active engagement is collected correctly | ping → exactly one row |
| 12 | Idle time is not counted | no input for 61 s → no ping |
| 13 | Background app time is not counted | `visibilityState: hidden` and `isActive:false` → no ping |
| 14 | Admin Panel time is NEVER counted | ping from `/admin/users` → `surface = 'internal'`, credited = 0 |
| 15 | Admin activity never affects Top Contributors | admin with 100 posts absent from v2 |
| 16 | UTC midnight boundary handled | 23:59:59.9 vs 00:00:00.1 UTC land on different `utc_date` |
| 17 | User timezone does not change scoring | same instant, three client timezones, one `utc_date` |
| 18 | 30-minute daily cap works | 75 public minutes → credited 30, actual 75 |
| 19 | Admin User Table shows **actual** engagement | drawer shows 75, not 30 |
| 20 | Normal users cannot access raw engagement | direct SELECT as `authenticated` → 0 rows |
| 21 | Client cannot submit fake time | RPC signature accepts only a path; direct INSERT refused by RLS |
| 22 | Lifetime score can increase | |
| 23 | Lifetime score decreases when qualifying content is deleted | |
| 24 | 30-day score can increase and decrease | |
| 25 | Repeated aggregation is idempotent | run recompute 5× → identical row |
| 26 | Home does not aggregate raw data per request | assert `get_top_contributors_v2` body contains no join to `posts` |

### Additional tests this design requires

| # | Test |
|---|---|
| 27 | **Cascade fairness:** A deletes post, B's comment cascades → **B's score unchanged**, A's drops |
| 28 | **Reply fairness:** A deletes own comment, B's reply cascades → **B's score unchanged** |
| 29 | **Self-comment not preserved:** A's own comment on A's own deleted post → A loses it |
| 30 | **Direct moderation delete is not preserved:** admin deletes B's comment directly → B loses it |
| 31 | **No double counting:** a preserved comment is counted once, not twice |
| 32 | **Preservation is idempotent:** the same `comment_id` preserved twice → one row |
| 33 | **Delete never fails:** a trigger raising internally must not abort the `DELETE` |
| 34 | **Job de-duplication:** one post with 40 comments by one member on one day → 1 job, not 40 |
| 35 | **`judge` IS eligible:** a judge with public posts can appear in the top 3 |
| 36 | **`content_editor` IS eligible** |
| 37 | **Only `admin` is excluded** — the eligibility function names exactly one role |
| 38 | **Strictest ping wins:** public then internal in the same minute → `internal` |
| 39 | **Private post earns nothing:** `privacy = 'friends'` → 0 points |
| 40 | **Suspended member excluded** from the top 3 |
| 41 | **Tier boundaries:** 3/4, 6/7, 10/11 posts; 5/6, 15/16, 30/31 comments |
| 42 | **Perfect day = exactly 1000.00**; without engagement = exactly 800.00 |
| 43 | **Score is unaffected by other members' activity** (proves no relative normalisation leaked in) |
| 44 | **Backfill fabricates no engagement:** every backfilled day has `active_minutes_actual = 0` |
| 45 | **Badge is batched:** 20 cards → 1 RPC (the `adEngagement` regression, guarded) |
| 46 | **`get_top_contributors_v2` returns no scores or minutes** — output shape asserted |
| 47 | **Flagged image comments excluded** (`is_flagged = true`) |
| 48 | **`v1` still exists and is unchanged** after the migration — md5 of `prosrc` asserted |

Test 48 is the rollback guarantee, expressed as a test.

---

## 20. MIGRATION AND ROLLBACK PLAN

Four phases. **Each is independently reversible, and the site behaves identically until Phase 3.**

### Phase 1 — Database only. Completely invisible.

Tables, indexes, RLS, functions, triggers, backfill. `get_top_contributors_v1` untouched; the Home page still calls it; the UI is byte-identical.

*Verification before proceeding:* backfilled `contributor_daily_metrics` cross-checked against raw `posts`/`post_comments` counts; delete a test post and confirm the recompute lands within ~5 s; confirm `v1`'s `prosrc` md5 is still `6156d9a4b9d6d927b2fe73c3d194f38d`.

*Rollback:* drop the new tables and triggers. Additive only — nothing existing was altered except two new indexes, which are harmless and can stay.

### Phase 2 — The collector. Still invisible.

The heartbeat hook ships; engagement begins accruing; **nothing is displayed**.

*Verification:* confirm rows appear for a normal member on `/feed`; confirm a member sitting in `/admin/*` produces `surface = 'internal'` and zero credited minutes; confirm an idle tab produces nothing.

*Rollback:* remove one hook call from `Layout.tsx`. Collected rows are inert.

### Phase 3 — The switch. The only user-visible step.

`useTopContributors.ts` changes `get_top_contributors_v1` → `get_top_contributors_v2`, and `SidebarTopContributors.tsx` replaces `{c.posts_count} posts` with the score badge (section 21).

**Expect the top 3 to change**, for reasons already established: comments become *written* rather than *received*, members with no posts become rankable, and the `judge` account becomes eligible.

*Rollback:* **revert one line.** `v1` is still there, still correct, still fed by untouched tables.

### Phase 4 — Admin reporting.

The engagement column and details drawer in Admin → Users. Admin-only surface; zero member impact.

*Rollback:* revert the component.

### Android

Phases 1, 2 and 4 are web-and-database. Phase 3 needs an Android build for the badge to appear in the app; the web is live immediately. The collector in Phase 2 works on web at once and on Android from the next build.

---

## 21. THE SCORE BADGE — YOUR FINAL INSTRUCTION

> *"The Score will Show with Name on the Suggested line (Mean Below Name, Small Test with nice Animation)"*

### Placement

**Directly under the member's name**, on its own line — not beside it. This replaces `{c.posts_count} posts` (line 68 of `SidebarTopContributors.tsx`), which you said confuses members.

```
🥇  ◯  Anindya Phani
        ✦ 2,480                ← small, muted, under the name
🥈  ◯  Payel Kundu Basu
        ✦ 1,905
🥉  ◯  Saptarshi Sengupta
        ✦ 1,240
```

This is the **lifetime Contributor Score**, which your Decision 4 makes public. The 30-day score stays hidden, per Decision 5. Both of your rules hold at once.

### Type

Small and quiet — roughly `text-[10px]`, muted foreground, `tabular-nums` so the digits do not jitter while animating, thousands separators, and the site's heading font, matching the `9px` treatment it replaces.

### Animation

- **Count-up on first appearance:** 0 → value over **700 ms**, ease-out cubic, so it settles rather than stops. Triggered once by an `IntersectionObserver`, not on every re-render.
- **On increase:** a brief 400 ms highlight as the number ticks up, so a member who returns notices their score moved.
- **`prefers-reduced-motion: reduce`:** the final value renders immediately, no animation. Non-negotiable — some people get motion sick, and it is one media query.
- No layout shift: the container is sized for the final string before the count-up starts.

### Built as one reusable component

`<ContributorScore userId={…} />`, so the same badge can later go on the feed, wall and profile — the "floating style … everywhere" you described — **without redesigning it.** This design produces the number and the component; placing it on those other surfaces is separate work and is not in this plan.

---

## AWAITING YOUR APPROVAL

Nothing has been built. On your word I will start with **Phase 1 only**, verify it against production, and report back before touching Phase 2.

Two things I want to make sure you have seen, because they will be visible to members:

1. **The top 3 will change** when Phase 3 ships — comments become *written* not *received*, commenters with no posts become rankable, and the `judge` account becomes eligible under Decision 1.
2. **Lifetime scores at launch are posts-and-comments only.** Engagement starts at zero for everyone and accrues from the collector's launch, never backwards.
