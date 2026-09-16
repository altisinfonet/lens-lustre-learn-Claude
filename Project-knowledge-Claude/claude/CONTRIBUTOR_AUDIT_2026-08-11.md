# Top Contributors + Contributor Score — AUDIT

**50mm Retina World · 2026-08-11 · AUDIT ONLY — NO CODE WRITTEN**

Every figure below was read from the **live production database** or from `origin/main` at `5b7874f`. Nothing here is assumed. Where something does not exist, it says so.

---

# PART 1 — WHAT EXISTS RIGHT NOW

## 1.1 Role definitions (§23-A, §5 of your clarification)

**Live `app_role` enum — the complete, authoritative list:**

```
user, judge, content_editor, admin, registered_photographer, student
```

**Roles actually assigned today (live counts from `user_roles`):**

| Role | Accounts |
|---|---|
| `admin` | **1** |
| `judge` | **1** |
| `user` | **90** |
| everything else | 0 |

### ⚠️ Finding R1 — `moderator` and `super_admin` DO NOT EXIST in the database

Your clarification lists Admin, Super Admin and Moderator as roles to exclude. In this database:

- **`moderator` is not a value in the `app_role` enum.** It cannot be stored in `user_roles`.
- **`super_admin` is not a value either.** Two past migrations explicitly removed `super_admin` references *because the role does not exist* (`20260423071812`, `20260518132258`).
- The live `get_top_contributors_v1` filters on `ur.role::text IN ('admin', 'moderator')`. **The `'moderator'` half of that filter can never match anything.** It is dead code — harmless, but it means the function excludes exactly one thing today: the single `admin` account.

### ⚠️ Finding R2 — the frontend believes in roles the database cannot store

`src/lib/adminRoleAccess.ts` defines `AdminSubRole = "super_admin" | "moderator" | "finance" | "content_editor" | "judge"` and grants admin-panel tabs accordingly. `resolveAdminSubRoles()` checks for `"moderator"` and `"finance"`, which can never be present. Those two branches are unreachable.

`role_display_config` (the table behind the admin "Role Definitions" screen) only controls **labels, icons and pill colours**. It does not grant roles. The enum is the only source of truth.

### ⚠️ Finding R3 — `judge` and `content_editor` are internal roles that are NOT excluded today

Your §1 says "Any other internal/admin role currently defined by the application" must be excluded. `judge` and `content_editor` are internal roles — a judge scores competition entries, a content editor publishes Journal and course material — and **neither is excluded from Top Contributors today.** There is 1 judge account live now.

**This needs your decision. See Question 1 in Part 4.**

---

## 1.2 `get_top_contributors_v1` (§23-A)

**Live source verified.** md5 of `pg_proc.prosrc` = `6156d9a4b9d6d927b2fe73c3d194f38d`, length 711.

I computed the md5 of the committed migration body with its inline SQL comments stripped: **identical, 711 chars, same md5.** So the repo and production agree — the live function is `supabase/migrations/20260725160000_top_contributors_exclude_staff.sql` with two comment lines removed. No drift.

```sql
SELECT p.user_id,
  COUNT(DISTINCT p.id)  AS posts_count,
  COUNT(DISTINCT pr.id) AS likes_received,
  COUNT(DISTINCT pc.id) AS comments_received,
  (COUNT(DISTINCT p.id)*2 + COUNT(DISTINCT pr.id)*1 + COUNT(DISTINCT pc.id)*1.5) AS score
FROM posts p
LEFT JOIN post_reactions pr ON pr.post_id = p.id
LEFT JOIN post_comments  pc ON pc.post_id = p.id
WHERE p.privacy = 'public'
  AND p.created_at > now() - interval '30 days'
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = p.user_id
                  AND ur.role::text IN ('admin','moderator'))
GROUP BY p.user_id ORDER BY score DESC LIMIT 3;
```

Five findings.

**C1 — it is not posts-only.** Your §1 says the current system is "primarily based on post count". It is actually already a weighted 2 / 1 / 1.5 formula over posts, reactions and comments, rolling 30 days, LIMIT 3.

**C2 — it counts engagement RECEIVED, not written.** `comments_received` counts comments **on your photographs**. Your §5 requires comments **written by the member**. These are opposite. A member who comments generously on everyone else's work scores **zero** today. Changing this will change who is in the top 3 on the day it ships.

**C3 — `FROM posts` makes a commenter invisible.** The query starts from the posts table and groups by `p.user_id`. **A member with zero posts cannot appear in the result at all**, no matter how much they comment. Under the new spec, comments are 35 % of the score, so the whole FROM clause has to be rebuilt around members, not posts.

**C4 — three-way cartesian LEFT JOIN.** A post with 10 reactions and 8 comments produces 80 intermediate rows. `COUNT(DISTINCT)` makes the answers correct and the cost wrong. Harmless at today's volume, quadratic as the site grows.

**C5 — no liveness guard.** The function is `SECURITY DEFINER`, so it bypasses RLS entirely, and it does not call `account_is_live()`. A deleted or suspended member's posts still count toward a top-3 position.

**Grants (live):** `PUBLIC:EXECUTE, postgres, anon, authenticated, service_role`. A signed-out visitor can execute it. That is fine for a public leaderboard, but it means anything the new version returns is public by definition.

---

## 1.3 Frontend surface

| File | What it does |
|---|---|
| `src/hooks/useTopContributors.ts` | Calls the RPC, `staleTime: 5 * 60 * 1000` (5 min — your spec wants 15–30) |
| `src/components/sidebar/SidebarTopContributors.tsx` | Renders the top 3 |
| `src/components/FeedRightSidebar.tsx`, `src/pages/Index.tsx` | Mount it |

**The "15 posts / 34 posts" you want removed is line 68 of `SidebarTopContributors.tsx`:**

```jsx
<span className="text-[9px] text-muted-foreground shrink-0" …>
  {c.posts_count} posts
</span>
```

One span. Replacing it with the score is a small change — the work is all in the database.

---

## 1.4 Activity / session tracking (§23-B) — **THE CRITICAL SECTION**

You asked: *"anything may damage for this??"* This is where the answer is.

I searched the entire `src/` tree for `visibilitychange`, `visibilityState`, `document.hidden`, `appStateChange`, `@capacitor/app`, idle timers and focus handlers.

### There are exactly three activity mechanisms. None can measure active time.

---

**(a) `feed_events` — 798 rows live**

```
id, user_id, post_id, author_id, event_type, dwell_ms, created_at
```

Written by `src/hooks/feed/useFeedEventTracker.ts`, mounted **only in `src/pages/Feed.tsx`**.

Four reasons it cannot be the engagement source:

1. **`dwell_ms` is computed in the browser and inserted directly by the client.** The RLS policy is `WITH CHECK (auth.uid() = user_id)` — it checks *who*, never *what*. **A member can insert `dwell_ms: 60000` for any post.** Using this for scoring would violate your §22 on day one.
2. **`post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE`.** When a post is deleted, every `feed_events` row about it is destroyed. Engagement history built on this table **evaporates when posts are deleted** — the exact opposite of what §6 needs ("available historically").
3. **Views are deduplicated per session**, so total dwell is bounded by how many posts exist, not by how long someone stayed.
4. **It only covers the feed.** Journal, competitions, courses, profiles, Discover — none of it is tracked. Your §7 explicitly wants those.

---

**(b) `activity_logs` — 6,937 rows live**

```
id, user_id, action_type, action_category, description, metadata,
ip_address, user_agent, page_path, is_archived, created_at
```

Live breakdown:

| action_type | rows |
|---|---:|
| `login` | 4,983 |
| `page_view` | 1,904 |
| `logout` | 46 |
| `password_recovery` | 2 |
| `profile_updated` | 2 |

- Categories: `auth` 5,033 · `navigation` 1,904
- **Date span: 2026-07-09 → 2026-08-11 — 33 days only.**
- 87 distinct users, 124 distinct `page_path` values
- **1,768 rows carry an `/admin…` path**

Three problems:

1. **`page_view` is almost never logged.** `useActivityLog()` — the hook that logs page views — is mounted in **exactly one component: `src/pages/Feed.tsx`**. It watches `location.pathname`, but `Feed` unmounts the moment you navigate away. So navigation across the site is essentially unlogged. 1,904 page views across 87 users in 33 days is roughly **0.6 page views per user per day**, which is not what real usage looks like.
2. **`login` = 4,983 is not 4,983 logins.** `logAuthEvent(…, "login")` fires on Supabase's `SIGNED_IN` event, which also fires on token refresh and tab focus. It is a refresh counter wearing a login label.
3. **Only 33 days of history exists.** There is no basis for a lifetime engagement figure from this table, and none can be reconstructed.

---

**(c) `profiles.last_active_at` — a 5-minute heartbeat**

`src/hooks/core/useLastActive.ts`, mounted globally in `src/components/Layout.tsx`:

```ts
const interval = setInterval(update, 5 * 60 * 1000);
```

It **overwrites one column**. There is no history — the previous value is destroyed on every write. And it is a bare `setInterval` with no visibility check, so **a tab left open all night keeps writing.** It records *that* someone existed, never *how long they were engaged*.

---

### ⚠️ Finding A1 — the answer to your question

> **Active Engagement, as defined in your §6 and §7, cannot be computed from any existing data — not for the last 30 days, and not for any historical period. The measurement does not exist and cannot be back-filled. It has to be built from zero.**

There is **no session table**, no foreground/background detection, no idle detection, and no Capacitor app-state handling anywhere in the codebase.

### Two things that DO exist and are worth reusing

- **A working beacon pipeline.** `src/lib/adSlots.ts` already batches events and flushes them with `keepalive: true` on `pagehide` and `visibilitychange`, with a `navigator.sendBeacon` fallback. The delivery mechanism for engagement pings is already written and proven. ⚠️ **But note:** it authenticates with the **anon key**, so anything it writes is forgeable. Engagement pings must go through the member's own JWT, not this path.
- **`judge_sessions`** — a real session table, but it exists only for competition judging, which is administrative activity and excluded by your §10 anyway. It is a useful precedent, not a source.

### ⚠️ Finding A2 — name collision, please do not confuse these

There is already an **Admin → Engagement** tab (`src/components/admin/AdminEngagement.tsx`). It has nothing to do with member active time — it applies **simulated reaction boosts** to images (`apply-scheduled-boosts`, running every 5 minutes). Different concept, same word.

---

## 1.5 Admin User Table (§23-C)

`src/components/admin/AdminUsers.tsx` — 965 lines.

- Data comes from the `admin_search_users(search_query, search_by)` RPC, then three follow-up queries for roles, badges and `profiles(last_active_at, last_platform)`.
- **It is a search box, not a paginated table.** There is no page-through of all members; you type a name or email and it returns matches.
- Live-syncs via a realtime subscription on `profiles`, `user_roles`, `user_badges`.
- Filters: name/email, badge, role.
- Existing per-user activity display: `formatLastSeen(last_active_at)` and `isActiveNow(last_active_at)` — "Active now", "Last seen 3h ago" — plus `last_platform` ("app" / "web", recorded only from 2026-08-05 onward).
- `ROLE_LABELS` in this file lists only the six real enum values. Consistent with the database.

Adding four engagement columns (Today / 7d / 30d / Lifetime) to a search-result row list is feasible, but the row is already dense. **A details drawer, as your §20 allows, is the better fit.**

---

## 1.6 Admin routes and admin-vs-public identification (§23-D, §23-F)

### Good news — this is clean

**Every admin surface in the application is behind a single route:**

```jsx
<Route path="/admin/*" element={<AdminPanel />} />
```

There are 57 routes in `src/App.tsx`. Exactly **one** is administrative. `AdminPanel` then renders 50+ tabs as sub-paths (`/admin/users`, `/admin/advertisements`, `/admin/comments`, …) — all under `/admin/`.

`/judge` is a separate role-gated route (competition judging).

So the rule your §2 and §10 need —

```
path starts with /admin  →  contributes nothing
```

— is a **single, reliable test**. No ambiguity, no scattered admin components inside member pages. `/judge` should be added to the same exclusion list, since judging is administration.

### ⚠️ Finding D1 — the distinction does not exist today

Nothing currently separates admin activity from member activity for any scoring or reporting purpose. `useLastActive` fires globally from `Layout.tsx` — **including while an admin sits in the Admin Panel.** The distinction has to be designed and built; there is nothing to extend.

---

## 1.7 Posts, comments, and deletion behaviour (§23-G, §23-H)

### Live volumes

| Table | Rows |
|---|---:|
| `posts` | **193** (all 193 are `privacy = 'public'`) |
| `post_comments` | **162** |
| `image_comments` | **0** |
| `feed_events` | 798 |
| `activity_logs` | 6,937 |
| `profiles` | 90 |

Posts per day over the last 8 days: 3, 2, 6, 11, 4, 9, 8, 7.

### ⚠️ Finding V1 — your diminishing-return tiers will essentially never bind

The tiers cap a member at 10 posts and 30 comments per day. **The busiest single day on the entire platform was 11 posts across all 90 members.** The caps are correct as a defence, and I would still build them — but they should be understood as a guard against future abuse, not as something that changes today's numbers.

### ⚠️ Finding V2 — `image_comments` has zero rows

Your §5 says to use `post_comments` and `image_comments`. `image_comments` is live and wired up but **contains no data at all**. It should still be included for correctness, but it will contribute nothing on day one.

Note also: `image_comments` links to images by `image_type` + `image_id` with **no foreign key**, so it does not cascade — deleting a portfolio image leaves orphaned comment rows behind. Different behaviour from `post_comments`.

### Deletion is HARD, always

- `posts` has **no `deleted_at`, no `is_deleted`**. Every delete is a real `DELETE`.
- All four delete paths are hard deletes: `src/pages/Feed.tsx:207`, `src/components/WallPosts.tsx:774`, and `src/components/admin/AdminPostReports.tsx:94,101`.

### ⚠️ Finding V3 — the cascade map (this is the dangerous one)

```
DELETE a post
   ├─→ post_comments        ON DELETE CASCADE   ← other members' comments destroyed
   │      └─→ post_comments (replies)  ON DELETE CASCADE
   │      └─→ comment_reports          ON DELETE CASCADE
   ├─→ post_reactions       ON DELETE CASCADE
   └─→ feed_events          ON DELETE CASCADE

DELETE a comment
   └─→ its replies          ON DELETE CASCADE   ← other members' replies destroyed
```

**One member deleting one photograph destroys comment rows belonging to many other members, on many different dates.** Under your §14, that single delete must trigger a recalculation of the daily aggregation for every one of those members, for every affected date.

Two consequences:

1. **The recompute must be queued, never synchronous** — otherwise one delete blocks on a recompute storm. (You have a queue. See 1.8.)
2. **There is a product question underneath it, and it is yours.** Member B writes a thoughtful comment. A year later Member A deletes the photo. Should B lose points for work B did nothing wrong with? My view is no — §5's "deleted comments" should mean *comments the author deleted*, not *comments that vanished because someone else deleted the photo*. Otherwise a member can silently strip points from everyone who engaged with them. **See Question 2 in Part 4.**

Also note: because the row is gone after a cascade, the trigger must capture `OLD.user_id` and `OLD.created_at` **before** the delete completes. There is no way to recover them afterwards.

---

## 1.8 Job queue (§23-I) — **the best news in this audit**

The queue is **not in the repository** — it exists only in production. Read live:

- **`pgmq`** (Postgres Message Queue) with `pgmq.q_post_jobs` and `pgmq.a_post_jobs`
- `enqueue_post_job(_payload jsonb)`, `enqueue_post_created_job()`, `process_post_jobs(_batch integer)`
- Handlers: `pj_handle_reaction_notification`, `pj_handle_comment_notification`, `pj_handle_tag_notification`, `pj_handle_recount_engagement`
- **Drained by cron job `process-post-jobs` every 5 seconds**

This is exactly the mechanism §14 needs. A delete can enqueue a `recount_contributor_day` message and it will be processed **within about five seconds** — comfortably satisfying *"Do NOT wait until the next 30-day period."* No new queue infrastructure is required.

### Live cron jobs (all 14, verified)

| Job | Schedule |
|---|---|
| `process-post-jobs` | **5 seconds** |
| `process-email-queue` | 10 seconds |
| `publish-scheduled-posts` | `* * * * *` |
| `apply-scheduled-boosts` | `*/5 * * * *` |
| `wallet_ledger_v2_diff_hourly` | `7 * * * *` |
| `autoscale-ad-traffic` | `0 */6 * * *` |
| `expire-gift-credits` | `15 0 * * *` |
| `judging-invariants-nightly` | `0 2 * * *` |
| `purge-cron-history` | `0 3 * * *` |
| `prune-old-notifications` | `20 3 * * *` |
| `prune-client-errors` | `25 3 * * *` |
| `emit-birthday-notifications` | `30 3 * * *` |
| `backup-reminder` | `0 8 * * 1` |
| `send-reengagement-emails` | `0 9 * * *` |

The 03:00–03:30 UTC window is already busy. A nightly aggregation should sit outside it.

---

## 1.9 RLS and security (§23-J)

RLS is **enabled on every relevant table**: `posts`, `post_comments`, `image_comments`, `feed_events`, `activity_logs`, `user_roles`, `profiles`.

`account_is_live()` exists (`security definer`, `set search_path = ''`, granted to `authenticated`) and returns true when the caller still exists in `auth.users`. It is the established guard for RESTRICTIVE write policies.

`activity_logs` is admin-read-only (`has_role(auth.uid(), 'admin')`) with self-insert — the correct shape for what §22 asks of raw engagement data.

---

## 1.10 Indexes (§23-K)

**`posts`** — `posts_pkey`, `idx_posts_user_id`, `idx_posts_user_id_created_at`, `idx_posts_created_at_desc`, `idx_posts_privacy_created_at`, `idx_posts_content_hash`, `idx_posts_content_trgm`, `idx_posts_indexing_disabled`

✅ `idx_posts_user_id_created_at` is exactly what daily post aggregation needs. Nothing to add.

**`post_comments`** — `post_comments_pkey`, `idx_post_comments_post_id`, `idx_post_comments_post_created`, `idx_post_comments_parent_id`

### ⚠️ Finding I1 — there is NO index on `post_comments.user_id`

Every index on that table is keyed by `post_id` or `parent_id`, because until now comments were only ever read *for a post*. Counting comments **written by a member** — the 35 % component — has no index to use and would sequentially scan.

**One new index is required: `(user_id, created_at)` on `post_comments`.** At 162 rows it makes no measurable difference today; it is required before this grows.

---

# PART 2 — WHAT COULD BE DAMAGED

Direct answer to *"anything may damage for this??"*

| # | Risk | Severity | Why |
|---|---|---|---|
| 1 | **Changing comments from RECEIVED to WRITTEN changes the visible top 3** | Medium | Not a bug — the spec requires it — but the Home page will show different people the day it ships. It should not surprise you. |
| 2 | **Delete-propagation triggers on `posts`, `post_comments`, `image_comments`** | **HIGH** | These are on the hot path of a live site. A trigger that raises an exception would make **deleting a post fail**. It must never do more than enqueue a message, and it must never be able to throw. |
| 3 | **Cascade fan-out** | **HIGH** | One post delete can enqueue recompute jobs for many members across many dates. Unbounded, this floods a queue drained every 5 seconds and shared with the notification pipeline. It must be de-duplicated per `(user_id, date)`. |
| 4 | **A new client heartbeat** | Medium | Adding a global timer risks battery drain on Android and extra writes on every screen. It must be visibility-gated, ≤1 write/minute, and must fail silently. |
| 5 | **Touching `useLastActive`** | Medium | It writes to `profiles`, which is realtime-published and drives the admin "who is active" display and the Active-now dot on comments. **I recommend leaving it completely alone** and adding a separate table rather than extending it. |
| 6 | **`get_top_contributors_v1` is `anon`-executable and `SECURITY DEFINER`** | Medium | Anything the replacement returns is readable by a signed-out visitor. Raw engagement minutes must never be in its output (your §19 says the same). |
| 7 | **A nightly aggregation job in the 03:00–03:30 UTC window** | Low | Four cron jobs already run there. Schedule outside it. |
| 8 | **Backfill over all history** | Low | 193 posts and 162 comments — trivial. This is genuinely safe here, which will not stay true forever. |
| 9 | **`process-post-jobs` runs every 5 seconds and is shared** | Medium | Contributor recomputes would compete with notification delivery. Recompute handlers must be cheap and batch-bounded. |

**Nothing in this feature requires changing an existing table's columns, an existing RLS policy, or an existing function** — except replacing `get_top_contributors_v1` itself, and one added index. That is the main reason I am reasonably confident this can be built without breaking what works.

---

# PART 3 — PROPOSED DATABASE AND ARCHITECTURE (§23-E)

Presented for approval. **Nothing has been built.**

## 3.1 Shape

```
posts / post_comments / image_comments        member_activity_minutes
        │  (authoritative content)                    │ (authoritative presence)
        └──────────────┬──────────────────────────────┘
                       ↓
            contributor_daily_metrics          ← derived, RECALCULABLE
             (user_id, utc_date, raw counts, points)
                       ↓
        ┌──────────────┴──────────────┐
   lifetime score              rolling 30-day score
   (SUM all dates)             (SUM last 30 UTC dates)
        ↓                              ↓
  public badge              contributor_top_cache → Home page
```

The daily table is a **derived cache, never a ledger**. Any `(user_id, utc_date)` can be recomputed from source at any time and must produce the same answer — this is what makes §12, §13, §14 and §16 all true at once, and it satisfies test 25.

## 3.2 Tables

**`member_activity_minutes`** — presence, the only genuinely new data

| Column | Type | Note |
|---|---|---|
| `user_id` | uuid | |
| `minute_bucket` | timestamptz | truncated to the minute, UTC |
| `surface` | text | `'public'` or `'admin'` — set by the server from the reported path |
| PK | `(user_id, minute_bucket)` | makes double-claiming a minute impossible |

Written **only** through `record_activity_minute(_path text)` — `SECURITY DEFINER`, which:
- derives `user_id` from `auth.uid()`, never from the client
- derives `minute_bucket` from `now()`, **never from the client**, and rejects nothing because there is nothing to reject
- classifies `surface` by whether `_path` starts with `/admin` or `/judge`
- `ON CONFLICT DO NOTHING`

No INSERT/UPDATE/DELETE policy for members. Direct table writes are impossible. This is how §22 is satisfied.

Pruned after 40 days (rolled-up daily totals are kept forever, so lifetime survives).

**`contributor_daily_metrics`** — derived, recalculable

| Column | Type |
|---|---|
| `user_id` | uuid |
| `utc_date` | date |
| `posts_count`, `comments_count` | int |
| `active_minutes_actual` | int (uncapped — for admin reporting, §8) |
| `active_minutes_credited` | int (capped at 30 — for scoring) |
| `post_points`, `comment_points`, `engagement_points` | int |
| `daily_score` | numeric |
| `computed_at` | timestamptz |
| PK | `(user_id, utc_date)` |

Rewritten in place by `recompute_contributor_day(_user uuid, _date date)`. **Idempotent by construction.**

**`contributor_top_cache`** — the Home page reads this and nothing else.

## 3.3 Functions

| Function | Purpose |
|---|---|
| `record_activity_minute(_path text)` | the only write path for presence |
| `recompute_contributor_day(_user, _date)` | the single source of scoring truth; deletes and rewrites one row |
| `pj_handle_recompute_contributor_day(_msg jsonb)` | new pgmq handler, wired into existing `process_post_jobs` |
| `rollup_contributor_yesterday()` | nightly sweep, catches anything missed |
| `refresh_top_contributors()` | rebuilds the cache |
| `get_top_contributors_v2()` | reads the cache; **no engagement minutes in the output** |
| `get_contributor_score(_user uuid)` | the public badge number |
| `admin_get_engagement(_user_ids uuid[])` | actual minutes, admin-gated, for §9/§20 |

`is_contributor_eligible(_user uuid)` — one place, server-side, per your §5:

```
account_is_live()  AND  no row in user_roles with an internal role
```

The internal-role list is read from the enum, not hard-coded, so a future role cannot silently become eligible.

## 3.4 Deletion propagation (§14)

`AFTER DELETE` triggers on `posts`, `post_comments`, `image_comments`, each doing **one thing only** — enqueue `(user_id, utc_date)` onto pgmq, wrapped so it can never raise and never block the delete.

For a post delete, the trigger enqueues:
- the post owner, on the post's own date
- each distinct `(commenter, comment date)` about to be cascaded — **de-duplicated**, so 40 comments from one member on one day produce **one** job, not 40

`process-post-jobs` picks it up **within ~5 seconds**, recomputes those days, and refreshes the cache.

## 3.5 Indexes

| Index | Status |
|---|---|
| `post_comments (user_id, created_at)` | **NEW — required** (Finding I1) |
| `image_comments (user_id, created_at)` | **NEW — required** |
| `member_activity_minutes (user_id, minute_bucket)` | new table PK |
| `contributor_daily_metrics (utc_date, user_id)` | new, for the 30-day sweep |
| `posts (user_id, created_at)` | ✅ already exists |

## 3.6 Client collector

A single hook, mounted once in `Layout.tsx`, that calls `record_activity_minute(window.location.pathname)` **at most once per minute**, and only when **all** of these hold:

- `document.visibilityState === "visible"`
- real input (pointer / key / touch / scroll) within the last 60 s
- on Android, the Capacitor app is in the foreground

It sends a path, not a duration. The server decides the minute and whether the surface counts.

**The honest limit:** a scripted client could still fake presence. This is tamper-**resistant**, not tamper-proof. What makes that acceptable is your own 30-minute cap — a perfect cheater gains at most the 20 % component, and nothing else in the score can be forged at all.

## 3.7 Schedule

| Job | When |
|---|---|
| recompute on delete/create | ~5 s, via existing pgmq |
| `refresh-top-contributors` | every 15 min |
| `rollup-contributor-daily` | 00:20 UTC (clear of the 03:00–03:30 crowd) |
| `prune-activity-minutes` | 04:10 UTC |

---

# PART 4 — DECISIONS I NEED BEFORE DESIGNING FURTHER

**1. Which roles are "internal"?** The enum has six values. `admin` is clearly excluded. Are `judge` and `content_editor` also excluded from Top Contributors? (`moderator` and `super_admin` do not exist — Finding R1.) There is 1 judge account live.

**2. Cascade-deleted comments.** Member A deletes a photo; Member B's comment is destroyed by the cascade. Does B lose the points? My recommendation: **no** — only comments the author deleted should cost points.

**3. §3 vs §18 — still unresolved.** §3 says the score is 0–100. §18 shows 8,420 and 1,250. My recommendation stands: **raw accumulated points for the lifetime badge, 0–100 for the rolling 30-day leaderboard.**

**4. "Duplicate/spam comments" (§5).** No such definition exists in the database. I will not invent one. Proposal: identical trimmed text by the same member on the same post within 24 hours counts once. Or drop the rule.

**5. "Invalid posts/comments" (§4, §5).** Undefined. Unless you say otherwise I will read it as: deleted, or not `privacy = 'public'`.

**6. Post privacy.** All 193 posts are currently public, so this bites nobody today — but the rule means a member who posts to friends only earns **nothing**. Confirm.

**7. Backfill.** Recompute all history (193 posts, 162 comments — trivial and safe), or start everyone from launch day?

**8. Where does the collector run?** Web only, or web + Android? Android needs Capacitor foreground detection, which does not exist in the codebase today.

Nothing gets built until you answer these.
