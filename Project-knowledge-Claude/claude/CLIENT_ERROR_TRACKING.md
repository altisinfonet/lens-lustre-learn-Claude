# Client error tracking — how to measure "people can't post"

**Built 2026-08-05.** This document exists because of one exchange:

> **Owner:** *"in entire day many of members unable to post complaining and you
> are just escaping?? Next time happened soo how to measure??"*
> *"what tracking you are follwoing, just i cant check is not the soltuion"*

He was right on both counts. Before this, **nothing on the platform recorded a
single client-side failure.** A failed post, a failed reply, a blank page — all
of them died inside the member's browser. The only signal that ever reached
anyone was a member complaining hours later with no detail, and the only honest
answer we could give was "I can't check".

---

## 1. HOW THE OWNER CHECKS IT

**Admin → Health → "Client failures".** Buttons for 24 hours · 7 days · 30 days.

| Column | Meaning |
|---|---|
| When | the hour it happened |
| What | Could not post · Could not reply · Photo upload failed · Blank page / crash |
| Where | `app` or `web`, and the build — so a bad release stands out as one column |
| Times | how many failures |
| Members | how many different people |
| Message | **the real sentence the browser threw** |

When nothing is wrong it says, in words: **"No client failures recorded in the
last 24 hours."** That sentence is deliberate — it means the members complaining
are *not* hitting a client-side error, and the search moves elsewhere. An empty
box would have said nothing.

### What we need FROM the owner now

Only when it happens **in the App**: the approximate **time**, **which screen**,
and **whether reloading fixed it**. Three facts. Everything else records itself.
Asking him for console logs or reproduction steps is pushing our job onto him.

---

## 2. VERIFIED END TO END, 2026-08-05 05:00 UTC

Not assumed — probed. From the live site with a real signed-in session:

- the deployed bundle **contains** `log_client_error` and `blank_page`;
- a `POST` to `/rest/v1/rpc/log_client_error` returned **204**;
- the row landed with `kind`, `platform`, `app_build=2026-08-04-7`, `url`, and a
  non-null `user_id`.

The probe row was then deleted; the table is clean and armed.

**Why the owner's 05:00 crash on `/admin/push_notification` did NOT record:**
his tab was running a bundle loaded *before* the fix reached the site. The fix
deployed mid-session. Stated as fact, not excuse — the bundle check above is
what settles it.

---

## 3. THE SILENT SELF-HEALING RELOAD — the biggest measurement gap, now closed

`App.tsx` has wrapped every route in `lazyRetry` since **2026-07-28**: when a
page's hashed chunk 404s after a deploy, it sets `sessionStorage.chunk_reload_v1`
and reloads once. If the second attempt also fails, `AppErrorBoundary` shows
*"Something went wrong while loading this page."*

**When the healing worked, it recorded nothing.** So the single most likely cause
of a web blank page was invisible *by design* — a fault firing ten times a day
looked identical to one that never fires, and every conversation about blank
pages started from zero.

Since `162d238` it reports **before** it heals, with
`detail: { cause: "chunk_load", willReload }` — so "healed itself" and "the
member actually saw the error screen" are separable.

**This is also what tells web and app apart.** A stale chunk can only happen on
**web**: the installed app carries its chunks inside the package. So a
`blank_page` row from `platform=app` **without** `cause: chunk_load` is a
different fault, and the message will say which.

Relevant context: ~12 deploys happened on 2026-08-05 alone. Stale-chunk crashes
cluster right after a deploy.

---

## 4. The pieces

### `public.client_errors` (table)

| Column | Notes |
|---|---|
| `user_id` | NULL for a logged-out caller. **No FK on purpose** — losing the log because an account was removed is the wrong trade. |
| `kind` | `post_create` · `reply` · `upload` · `blank_page`. Anything else is dropped: a free-text kind becomes ungroupable within a week, and grouping is the point. |
| `message` | `left(…, 500)` |
| `detail` | jsonb — photo count, component stack, `cause`, `willReload` |
| `platform`, `app_build`, `url` | bounded strings |

- **RLS on, and NO policies at all.** Nothing reaches the table except through
  the functions.
- `REVOKE ALL … FROM PUBLIC, anon, authenticated` — proven: a member's direct
  `SELECT` returns *permission denied for table client_errors*.

### `public.log_client_error(...)` — the one door in

- `SECURITY DEFINER`, granted to **anon and authenticated**. Anon matters: the
  blank page often happens *before* sign-in.
- **Rate limited: 20 rows per member per hour, 200 per hour anon.** Called from
  inside retry loops; a logger that amplifies writes during an incident is a
  self-inflicted second outage.
- `EXCEPTION WHEN OTHERS THEN RETURN` — reporting a failure must never become a
  failure the member sees.

### `public.get_client_error_stats_admin(_hours)` — the one door out

Raises `admin only` unless `has_role(auth.uid(), 'admin')` — proven with a real
non-admin id. Groups by hour / kind / platform / build and returns **one real
message per group**.

### `prune_client_errors(30)` — cron `25 3 * * *`

30-day retention with a **hard floor of 7 days** (`GREATEST(7, _days)`), so no
caller can turn retention into "delete yesterday's evidence".

### `src/lib/reportClientError.ts`

Three non-negotiable rules: **never throws**, **never blocks** (returns `void`,
synchronously — a member's Retry must not wait on logging), **rate limited
server-side**.

Two functions, and the difference matters:

- **`describeThrown(err)` — for the LOG.** Digs a real sentence out of
  `FunctionsFetchError` (a name, no message — the edge-worker cold start
  `s3Upload.ts` already retries for), storage `{ statusCode, error }` objects,
  `DOMException`, thrown strings, thrown `null`, plain objects. **Can never
  return an empty string** — that is what produced "Unknown error". It prefixes
  the error's `name`, because "FunctionsFetchError · status=546" is what makes a
  row actionable.
- **`memberFacingMessage(err)` — for the MEMBER.** A real written `message` wins,
  unprefixed; everything else falls back to `describeThrown`. Without this, the
  one message the app already gets right rendered as *"Error · Please add a
  profile photo…"*. Introduced and fixed the same day.

### Wired into four places

| Place | Kind | Note |
|---|---|---|
| `WallPosts.tsx` | `post_create` | toast now shows the real sentence, not "Unknown error" |
| `AppErrorBoundary.tsx` | `blank_page` | + first 600 chars of the component stack |
| `App.tsx` `lazyRetry` | `blank_page` | + `cause: chunk_load`, `willReload` — §3 |
| `useAddComment.ts` | `reply` | a bug in its own right — §5 |

---

## 5. The reply bug found on the way

`useAddComment.ts` named its error `_err`, **never looked at it**, and raised a
toast with a title and no body. The mutation **already knew** to throw *"Please
add a profile photo to your account first…"* and the handler discarded it.

That matters more than it sounds: **32 of 83 members cannot comment or post at
all** because of the profile-photo rule, and every one of them saw only "Failed
to comment". Full measurement in **`PROFILE_PHOTO_GATE_IMPACT.md`**.

---

## 6. Proof taken before this shipped

Rehearsed on production inside `BEGIN … ROLLBACK`, so nothing survived:

| Check | Result |
|---|---|
| valid row with real message, platform, build, member id | ✅ 1 row |
| unknown `kind` dropped | ✅ 0 rows |
| empty message dropped | ✅ 0 rows |
| 40 calls by one member in an hour | ✅ capped at exactly **20** |
| logged-out caller reporting a blank page | ✅ 1 row, `user_id IS NULL` |
| non-admin direct `SELECT` | ✅ *permission denied* |
| non-admin calling the stats function | ✅ *admin only* |

Then applied for real, and re-verified live afterwards (§2).

---

## 7. What this does NOT do

- **It does not fix the outage.** It makes the next one visible. **No root cause
  has been established for 2026-08-04, and none should be claimed.**
- **It cannot catch a failure that never reaches JavaScript** — a phone with no
  connectivity cannot report anything. Inherent, not an oversight.
- **`upload` is defined but never emitted separately** — an upload failure inside
  the composer records as `post_create`. Small follow-up, noted not done.
- **It does not cover every call site.** Adding one is a single
  `reportClientError(kind, err, {...})` line.
