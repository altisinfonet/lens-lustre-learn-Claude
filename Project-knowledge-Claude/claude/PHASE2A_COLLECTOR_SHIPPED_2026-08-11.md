# PHASE 2A — ACTIVE ENGAGEMENT COLLECTOR

**Date:** 2026-08-11 (migration applied 2026-08-12 02:13 UTC)
**Status:** ✅ **COMPLETE AND LIVE.** Code merged to `main` (PR #69, `564209b`). Migration applied to production and verified.
**Scope:** COLLECT ONLY. Nothing scored, nothing displayed, no member's Contributor Score moves by a point.

---

## WHAT SHIPPED

### Database — `supabase/migrations/20260811180000_phase2a_activity_collector.sql`

| Object | Purpose |
|---|---|
| `member_activity_minutes` | One row per member per UTC minute. RLS **ON, zero policies**, grants revoked from `anon`/`authenticated`. |
| `contributor_engagement_daily` | Daily rollup, survives the 40-day prune. Same RLS posture. |
| `record_activity_minute(text, boolean)` | The **only** write path. Granted to `authenticated` only. |
| `rollup_engagement_daily(date)` | Idempotent DELETE+INSERT. Applies the 30-minute cap to **public** minutes only. |
| `prune_activity_minutes(boolean)` | 40-day retention. Dry run by default. Refuses to delete days not yet rolled up. |
| `engagement_probe_report(int)` | Correctness probe from post/comment timestamps. |
| `engagement_collector_health()` | Aggregate diagnostics + 3 invariants that must read zero. |
| cron `rollup-engagement-daily` | `20 0 * * *`, clear of the crowded 03:00–03:30 window. **No prune job scheduled.** |

**Privacy, as instructed:** *"a normal member should never be able to query: User X
was active at 10:31, 10:32, 10:33..."* — RLS is on with **no policies at all**, not
for members and not for admins. Every read goes through a SECURITY DEFINER function
that can decide what to expose; a table policy cannot. Table grants are revoked too,
so the day somebody adds a policy carelessly, the grant is not sitting there waiting.

**Surface, decided server-side:** `/admin` and `/judge` mark the minute `internal`,
with **strictest-ping-wins that never unwinds**. A member who touches `/admin` and
then glances at the feed inside the same sixty seconds gets an internal minute.
Administrative time cannot be laundered into contributor credit.

**Nothing here touches `contributor_points_since`, `get_top_contributors_v2` or
`get_contributor_scores`** — proven by md5, before and after (see below).

### Client

- `src/lib/engagement/activityPing.ts`
- `src/hooks/core/useEngagementHeartbeat.ts`
- mounted once in `src/components/Layout.tsx` (2 lines)
- `src/__tests__/engagementHeartbeat.test.ts` (20 tests)

A minute is recorded only when all four hold: somebody is signed in; the tab is
visible (and inside the app, Capacitor reports active); there was a real input event
in the last **120 seconds**; and no ping has gone out for this wall-clock minute.
A left-open tab stops earning after two minutes. A phone in a pocket earns nothing.

The 15s timer is **destroyed on hide and rebuilt on show** — a hidden tab costs zero
timers, not cheap no-op ticks.

### The segment allow-list — the part worth remembering

The instruction was *"record only the first path segment/category."* Taken literally
that would have been a privacy bug, because this app routes **`/:customUrl`** at the
top level: `/dipannita-sen` has a first segment that **is a member identifier**. So
the segment is matched against the fixed list of routes `App.tsx` actually declares
and anything unrecognised becomes `other`. A new route added later under-reports as
`other` until it is added to the list — recoverable — rather than leaking a username,
which is not.

### No retry, no offline queue

Deliberate. A buffer replays a duration the *client* asserts happened, which is
exactly the claim this design refuses to trust. A dropped ping is a lost minute and
that is the correct outcome. Under-counting is the safe error.

---

## VERIFICATION

### Before production — a real PostgreSQL 16

**33 SQL behaviour checks** against a throwaway PostgreSQL 16 stood up inside the work
container with `auth.uid()` and `cron.*` stubbed. Run *before* anything touched
production. All 33 pass:

- signed-out is a silent no-op; one row per minute; `had_interaction` ORs
- `admin` → internal; a later `feed` ping cannot unwind it; `JUDGE` matches case-insensitively
- unknown segment → `public`, never an error
- rollup: 50 minutes → 40 public / 10 internal / **credited capped at 30** / 20 interacted / 20 carried
- rollup idempotent across three runs
- all three health invariants read zero
- prune dry run counts without deleting; **refuses an un-rolled day**; deletes it once rolled up
- probe report arithmetic (2 posts, 1 covered → 50.0%)
- grants: `authenticated` can record, `anon` cannot, nobody can call the four admin functions
- both tables RLS-on-with-zero-policies
- cron job registered once at `20 0 * * *`

**20 client tests**, driven with fake timers rather than asserted against their own
source — a ping in a hidden tab, two pings in one minute and a timer surviving
unmount all type-check perfectly, so only behaviour catches them.
**7 mutations tried, all 7 caught.**

**Byte verification:** all five files on `main` are `cmp`-identical to the local
copies. `Layout.tsx` was edited in place against a hash check of the remote original,
so no drift was possible.

**Repo health:** `npx tsc --noEmit -p tsconfig.app.json` unchanged at the 3
pre-existing errors. Full suite 1,179 pass, same 2 known judging failures. CI 5/5.

### Pre-flight on production

Confirmed a clean first run before executing: tables `NONE`, functions `NONE`,
cron job `NONE`. The three scoring functions' md5s recorded first.

The editor content was hash-checked before the Run button was pressed —
`2018710212 / 21520 bytes`, byte-identical to the file on `main`.

*Supabase raised its "Potential issue detected — destructive operations" warning.
That is its text heuristic firing on the `DELETE` statements sitting inside the
`rollup_engagement_daily` and `prune_activity_minutes` **function bodies being
defined**, not executed, plus the guarded `cron.unschedule`. Nothing in the migration
deletes existing data.*

### After — verified on production

| Check | Result |
|---|---|
| All 5 function bodies vs the committed file (md5 of `pg_proc.prosrc`) | **MATCH ×5** |
| Both tables exist | ✅ |
| RLS on **with zero policies**, both tables | `true`, `true` |
| Table SELECT for `anon` / `authenticated`, both tables | `false` ×4 |
| `authenticated` may call `record_activity_minute` | `true` |
| `anon` may call it | `false` |
| `authenticated` may call `rollup` / `health` | `false`, `false` |
| Cron | `rollup-engagement-daily @ 20 0 * * * active=true` |
| **Scoring functions unchanged** | `contributor_points_since=0fb5e020…`, `get_contributor_scores=d835a4ed…`, `get_top_contributors_v2=74713575…` — identical to Phase 1 |

### End-to-end on the live site

The deployed bundle (`index-BWFrLgOV.js`) contains the collector — confirmed by
fetching it from `www.50mmretina.com` and searching it.

Three RPC calls were then made through a real signed-in member session
(`mr.neilbasu@gmail.com`) in the order `feed` → `admin` → `feed`. All returned
`204`. The result in the table:

```
minute_bucket             surface    had_interaction   who
2026-08-12 02:13:00+00    internal   true              50mm Retina World
```

**One row, not three** — the per-minute primary key held. **`internal`, not `public`**
— the `admin` ping won and the later `feed` ping could not unwind it. Strictest-ping-wins
proven on production, not just in a test harness.

And the privacy guarantee, tested directly rather than assumed:

```
GET /rest/v1/member_activity_minutes  →  403
{"code":"42501","message":"permission denied for table member_activity_minutes"}
```

A signed-in member — an **admin**, in fact — cannot read the raw minute table at all.

*That one row is mine, from the verification probe above. It belongs to the `admin`
account, which is excluded from contributor scoring everywhere, so it can never
affect anyone's score. It was left in place as the evidence.*

---

## WHAT TO DO IN ABOUT TWO WEEKS

```sql
SELECT * FROM public.engagement_collector_health();
SELECT * FROM public.engagement_probe_report(14);
```

What to look for:

- **`engagement_probe_report` coverage well below 100%** means the collector is losing
  time. Two honest caveats: posts published by the scheduled-posts cron have no
  browser behind them and always look like misses, and content created before the
  first collected row cannot be covered (the window starts at that row).
- **`carried_per_interacted`** is bounded near 2.0 by the 120s window. A member pinned
  at the ceiling every day is a parked tab, not a reader.
- **The three invariants must all read zero.**

**STOP after Phase 2a. Do not proceed to Phase 2b automatically.**

---

## ONE UNRELATED THING NOTICED WHILE VERIFYING

`localStorage` on the live site holds **two** Supabase auth keys:
`sb-jtdtehuqtinjxropkkcn-auth-token` (the live project) and
`sb-isywidnfnjhtydmdfgtk-auth-token` (**a stale key from an old project**).

The deployed bundle only ever talks to `jtdtehuqtinjxropkkcn`, so this is inert —
but it is the stale-token item already on the open-issues list, now confirmed with
the exact key name. Worth clearing when convenient.
