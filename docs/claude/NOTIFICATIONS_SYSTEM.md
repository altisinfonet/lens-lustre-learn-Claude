# Notification System — the one document

> **This is the single reference for notifications on 50mm Retina World.**
> Architecture, contracts, how to operate it, how to diagnose it, and every
> decision with the reason attached.
>
> Rule for this file: when notification behaviour changes, **this file changes in
> the same PR.** A change that is not written here did not happen.
>
> **Last updated 2026-08-04.** Notification *behaviour* on production has not
> changed since build 1037 — but a **new `birthday` type is written and tested
> and NOT yet applied**; see §9 and `TODAYS_BIRTHDAY.md`. Build/version rows in
> §0 refreshed 2026-08-04.
>
> Companions: `TODAYS_BIRTHDAY.md` (the birthday type, and the two `ELSE true`
> traps every future type will hit), `NOTIFICATIONS_REMAINING_MEASURED.md` (what
> is left, measured), `NOTIFICATIONS_AUDIT_2026-08-01.md` (how stages 1–4 were
> found and fixed).

---

## 0. Current state — read this first

| Piece | State |
|---|---|
| Panel dismissal, single bell, one sentence layer | ✅ shipped (#38, #39, #40) |
| Push body composed at send time | ✅ shipped (#41) |
| Bell grouping + honest badge | ✅ shipped (#42) |
| Destinations + friend-request double count | ✅ shipped (#43) |
| Push preference switches on screen | ✅ shipped (#46, #48) |
| Member can delete a notification | ✅ shipped (#47) |
| Retention, 90 days | ✅ live, pg_cron daily 03:20 UTC |
| `/notifications` in the account menus | ✅ shipped (#49) |
| **`birthday` type** | ⚠️ **written + tested, NOT applied and NOT pushed** — §9 |
| Android app | **1047 LIVE on Play**; **1050** built and waiting for the owner to upload. Notification behaviour identical since 1037 |
| Web | current with `main` through `44be467`; `__APP_BUILD` = `2026-08-04-7` |
| `/notifications` route | inside `<RequireAuth>` (PR #56) — logged-out visitors are redirected to `/login` |

Measured on production **2026-08-04**: **82 members**, **12 distinct notification
types have ever been created** — post_reaction 523, new_post_from_following 240,
new_follower 239, friend_request 147, post_comment 98, friend_accepted 37,
comment_reply 17, course_published 12, image_reaction 11, badge_awarded 9,
certificate_issued 9, potd_featured 1. **Friendships: 97 pending, 37 accepted.**
(2026-08-02 figures: 12 devices registered, 854 rows, **1** row in
`notification_preferences`.)

**Individual push is proven end-to-end to a real handset** (2026-08-01) and the
body is composed at send time rather than read from a frozen column.

**The website never registers a push token** — `src/lib/native/push.ts` returns
early unless `isNativeCapacitorApp()`. Only the installed app registers. A member
with no device cannot receive push and no database change will alter that.

---

## 1. Architecture

```
event (comment, reaction, follow, post, birthday, …)
        │
        ▼
  DB trigger (or a cron job) inserts a row into  user_notifications
        │
        ├──► trg_push_on_notification ──► push_on_notification()
        │         ├─ never pushes to the actor themselves
        │         ├─ per-user preference CASE, ending in ELSE true (see §3)
        │         ├─ writes push_delivery_log  (ALWAYS)
        │         ├─ body := notif_push_body(type, actor_id, message)   ← composed
        │         └─ net.http_post ──► send-push ──► FCM ──► phone
        │
        ├──► trg_send_notification_email ──► send_notification_email()
        │         ├─ FIRST LINE: IF NEW.email_sent IS TRUE THEN RETURN NEW
        │         └─ else get_notification_email_enabled(), which ALSO ends ELSE true
        │
        └──► read by:
                 • NotificationBell → get_my_unread_notifications_grouped()
                 • /notifications    → get_my_notifications_grouped()

admin broadcast (a deliberate human action, separate path)
        │
        ▼
  AdminPushBroadcast.tsx ──► send-broadcast-push ──► every push_tokens row ──► FCM
        (writes NO user_notifications rows — see §6)
```

Two read surfaces on purpose — **unread inbox** vs **history** — but they share
both the grouping rule and the wording:

- **`notif_group_key(type, created_at, id)`** decides what a group is. Both read
  functions call it. *Do not inline that CASE again.*
- **`describeNotification()`** in `src/lib/notifications/describe.ts` decides the
  words. The push body is a SQL copy of the same catalog, pinned character-for-
  character by `pushCatalogParity.test.ts`.

> **A surface may choose its layout. It may not choose its words.**

---

## 2. Data model

**`user_notifications`** — `id, user_id, type, title, message, reference_id,
actor_id, is_read, created_at, email_sent, dedup_key`.
RLS: owner-only **SELECT, UPDATE and DELETE** (DELETE added 2026-08-02,
migration `20260802190000`). There is **no foreign key** on `actor_id`.

`dedup_key` has a **PARTIAL unique index**,
`uniq_user_notifications_dedup_key … WHERE dedup_key IS NOT NULL`. Any
`ON CONFLICT (dedup_key)` **must repeat that predicate** or the statement fails
at runtime.

`message` is the frozen sentence a trigger wrote at the time. **It is no longer
rendered for any type the app can phrase itself** — bell, history and push all
compose. It remains the fallback for types with server-written wording
(competition results, certificates, courses, tickets, wallet, **birthday**) and
is still the place a *deleted* member's name survives (§8).

Indexes:
- `idx_user_notif_user_read (user_id, is_read) WHERE is_read = false` — the bell.
- `idx_user_notif_user_created (user_id, created_at DESC)` — the history.
  **Both are needed.** The first is *partial*; it stops applying the moment the
  `is_read` filter is dropped.

**`push_delivery_log`** — audit trail. RLS on, no permissive policy. Not pruned.

**`push_tokens`** — insert only through SECURITY DEFINER
`register_push_token(_token, _platform)`. `ON CONFLICT (token) DO UPDATE`
re-points a token at whoever signed in last.

**`notification_preferences`** — column defaults, verified 2026-08-02:

| column | default |
|---|---|
| `push_enabled`, `push_reactions`, `push_comments`, `push_friend_requests`, `push_new_followers`, `push_competition_updates` | **true** |
| `push_new_posts` | **false** |
| the four `inapp_*` | true — and **read by nothing** (§8) |

⚠️ **The column default is not the effective default.** The trigger's CASE opens
with `WHEN np.user_id IS NULL THEN true`, so a member with **no row at all** gets
every push including new-posts. **77 of 78 members have no row.** See §8.

**Retention:** `prune_old_notifications(_days=90, _max_rows=5000)`, SECURITY
DEFINER, revoked from `anon`/`authenticated`, scheduled daily at 03:20 UTC by
pg_cron as `prune-old-notifications`. Deletes rows that are **read AND older than
the window**, oldest first, with a **hard floor of 30 days**. **Unread is never
touched at any age.**

---

## 3. Types

| Type | Grouped? | Pushes? | Emails? | Notes |
|---|---|---|---|---|
| `post_reaction`, `image_reaction` | by day | `push_reactions` | `email_reactions` | |
| `post_comment`, `image_comment`, `comment_reply` | by day | `push_comments` | `email_comments` | |
| `new_post_from_following` | by day | `push_new_posts` | default → **true** | highest volume on the platform |
| `new_follower` | **never** | `push_new_followers` | `email_new_followers` | carries inline *Follow back* |
| `friend_request` | **never** | `push_friend_requests` | `email_friend_requests` | carries Accept/Decline. **Excluded from the bell's query** — counting both it and the friendships row made every request count twice |
| `post_tag` | **never** | default → true | default → true | carries Approve/Decline |
| competition / wallet / ticket / certificate / course | never | `push_competition_updates` or default | per-column | server-written wording, rendered verbatim |
| **`birthday`** *(pending, §9)* | never | default → **true** (wanted) | **suppressed via `email_sent = true`** | message written in SQL; no `ACTION_CATALOG` entry on purpose |

**Rows carrying an inline action are never grouped.** Collapsing them would
destroy the button.

**Types that exist only as names.** `entry_shortlisted`, `entry_qualified`,
`entry_finalist`, `round_results_published`, `verification_required`,
`admin_verification_pending`, `admin_verification_submitted` are listed in
`IMPERSONAL_TYPES` but are **emitted by nothing** and no row of any of them
exists. They stay as a guard. **Do not "fix" their routing; there is nothing to
fix.**

### ⚠️ Adding a new type — the checklist that must not be skipped

1. **Grouping** → `notif_group_key()`. One definition, called by both read RPCs.
2. **Push** → `push_on_notification()`'s CASE ends in **`ELSE true`**, so a new
   type **PUSHES BY DEFAULT**. If it should not, add a branch reading a
   preference column, and remember the `np.user_id IS NULL` branch above it.
3. **EMAIL** → `get_notification_email_enabled()` **also ends in `ELSE true`**,
   and `send_notification_email` gates on *nothing else* — no template lookup, no
   allow-list. **So a new type EMAILS EVERY RECIPIENT by default.** Verified
   2026-08-04. To suppress it without touching a function 20+ types depend on,
   insert the row with **`email_sent = true`**: the trigger's first statement is
   `IF NEW.email_sent IS TRUE THEN RETURN NEW`.
4. **Wording** → either add an entry to `ACTION_CATALOG` in
   `src/lib/notifications/describe.ts` **and** the phrase table in migration
   `20260802090000` (`pushCatalogParity.test.ts` fails on a one-character
   difference) — **or add neither.** Adding neither is the right choice when the
   sentence is not "\<name\> \<verb\>": `notif_push_body()` returns the row's
   `message` verbatim when `notif_action_phrase(type)` is NULL, and
   `describeNotification()` falls back to `message` for the same reason, so the
   sentence written once in SQL renders identically on the bell and in the push.
   **Adding only one of the two is the bug this catalogue exists to prevent.**
5. **Destination** → `src/lib/notificationLinks.ts`, or it lands on `/dashboard`.
   `notificationLinks.test.ts` holds a census of every type that exists on
   production and asserts none reaches the catch-all.
6. **Icon + category** → `NOTIF_ICON` and `NOTIF_CATEGORY` in
   `NotificationBell.tsx`, or the row shows the generic bell and no heading.
7. **A toggle may only appear on screen while the trigger demonstrably reads its
   column.** A test reads the migration and enforces this.
8. Add a test, and prove it fails without the change.

---

## 4. Contracts

**`notif_group_key(_type, _created_at, _id)`** — STABLE. Noisy types collapse per
calendar day; everything else gets a unique key. Extracting it was proven
behaviour-neutral over all 993 rows: **0 differed, 498 distinct keys both ways.**

**`get_my_notifications_grouped(_limit int, _before timestamptz)`** — the
history. SECURITY DEFINER, hard-filtered to `auth.uid()`, zero rows when
`auth.uid()` is NULL. Keyset pagination on the previous page's smallest
`latest_at`. Returns `group_key, type, notification_ids[≤100], actor_ids[≤3],
actor_names[3], actor_usernames[3], actor_avatars[3], actor_count, event_count,
unread_count, reference_id, thumbnail_url, title, message, latest_at`.

**`get_my_unread_notifications_grouped(_limit int, _exclude_types text[])`** —
the bell. Same shape **plus `total_unread`**, counted over every unread row minus
the excluded types. The bell passes `{friend_request}`. **`total_unread` is the
badge** — it must never be the length of the returned page.

- At most 3 actors, but `actor_count` and `event_count` are the **true totals** —
  that is what makes "and 31 others" a real number.
- `thumbnail_url` only for a public post or the caller's own. Private photos
  never leak a preview.

**`notif_display_name(uuid)`** — admin → the brand; missing profile → "A deleted
account"; NULL actor → "A member"; else full name, then profile handle. **Any new
sentence that names a person must go through this**, or the owner's naming rules
gain a fourth place to drift.
**`notif_action_phrase(text)`** — the singular verb, a byte-copy of
`ACTION_CATALOG`; **returns NULL for an unlisted type**.
**`notif_push_body(type, actor_id, message)`** —
`CASE WHEN notif_action_phrase(type) IS NULL THEN COALESCE(message,'')
ELSE notif_display_name(actor_id) || ' ' || notif_action_phrase(type) END`.

**`get_push_health()`** — admin-only. Device counts, 24h queued/skipped/error
counts, last error detail, `delivery_looks_dead`.

**`send-broadcast-push`** — POST, admin JWT required, **no** internal-secret
bypass. `{ title, body?, image_url?, link?, dry_run? }`.

---

## 5. Operating it

### Is push working?

```sql
SELECT * FROM public.get_push_health();
```

- `delivery_looks_dead = true` → notifications created, devices registered,
  nothing queued in 24h. Check `last_error_detail` first.
- `queued_24h > 0` but users report nothing → the failure is past pg_net.
  `queued` means *handed to pg_net*, never proof of receipt.
- `devices_registered = 0` for a user → their app never registered.

```sql
SELECT id, created, status_code, left(content, 200)
  FROM net._http_response ORDER BY created DESC LIMIT 20;
```

### Prove a push trigger WITHOUT sending a push

pg_net queues into a table inside the caller's transaction, so a rollback
cancels the send:

```sql
BEGIN;
INSERT INTO public.user_notifications (...) VALUES (...);
SELECT convert_from(body,'UTF8')::jsonb ->> 'body'
  FROM net.http_request_queue ORDER BY id DESC LIMIT 1;
ROLLBACK;
```

Nothing is delivered and no row survives. Every push change since 2026-08-02 was
verified this way before shipping.

### Read production as a specific member

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
       json_build_object('sub','<user-id>','role','authenticated')::text, true);
SELECT * FROM public.get_my_unread_notifications_grouped(20, ARRAY['friend_request']);
ROLLBACK;
```

> **No dashboard UI needed for any of the SQL above:** the pg-meta platform API
> route (token from dashboard localStorage + `x-connection-encrypted` header)
> runs it from a browser tab — recipe in `NEXT_RELEASE_RUNBOOK.md`. **But the
> dashboard must be SIGNED IN in that browser**; on 2026-08-04 it was signed out
> in both connected Chromes and no SQL could be run at all.

### "I don't get notifications on my phone"

In order, because each step invalidates the next:

1. Does **that account** have a row in `push_tokens`? The website never registers
   one; only the installed app does.
2. Is the installed app new enough?
3. `get_push_health()` — is anything queued at all?
4. `push_delivery_log` for that user — was it `skipped_preference`?
5. `net._http_response` — did FCM return 200?
6. Only then FCM itself / token validity.

### An edge function returns a strange 401 — diagnose it in this order

**2026-08-01, learned the hard way.**

`send-broadcast-push` returned `{"message":"Invalid credentials","code":
"INVALID_CREDENTIALS"}` to *every* header combination. That looks exactly like a
gateway rejection. **It was not.** The deployed code was **Supabase's Hello World
template**, not the repo's function.

1. **Compare the deployed code with the repo first.** Dashboard → the function →
   **Code** tab. Thirty seconds, and it short-circuits hours of auth theorising.
2. Probe with **both** keys. Two keys, two answers = wrong code deployed.
3. Compare against a function known to work (`send-push`) with identical headers.
4. Only then look at the Verify-JWT setting.

| Body | Means |
|---|---|
| `{"error":"Unauthorized"}` | **our** code — the request arrived |
| `{"message":"Invalid credentials","code":"INVALID_CREDENTIALS"}` | rejected before our handler. Gateway **or** a template wrapper. **Ambiguous — check the Code tab.** |
| `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` | gateway |
| `TypeError: Failed to fetch` | the function does not exist or is not routed |

### Redeploying an edge function without CLI access

⚠️ **No CI deploys edge functions.** `.github/workflows` contains only
`android-build.yml` and `typecheck.yml`, so **a commit to
`supabase/functions/**` changes nothing in production.**

Dashboard → Edge Functions → the function → **Code** → click into the editor →
`ctrl+a` → paste → **Deploy updates**. Without the `ctrl+a` the paste
**appends**. Verify by hashing the Monaco model against `sha256sum` of the repo
file *before* deploying, and probe the function *after*.

### Sending an admin broadcast

`/admin/push_notification`. Always press **"Check who will get it"** first —
`dry_run: true`, sends nothing. Then type `SEND`. It reaches installed apps only
and cannot be recalled.

---

## 6. Decisions, with reasons

**Removing an overlay must never depend on an animation completing, nor on a
single click handler being delivered.** `AnimatePresence` kept the exiting panel
mounted as a 304×456 invisible click-eater over every page. Four independent
layers now close it.

**A surface may choose its layout; it may not choose its words.** One
`describeNotification()`, one SQL copy pinned by a parity test — or, for a
sentence that is not "\<name\> \<verb\>", **one SQL `message` and no catalogue
entry at all**, which both surfaces fall back to.

**An admin is always the brand.** Never a real person's name, on any surface.

**"Someone" is banned.** It hid three different states: no human actor at all
(no name), a deleted profile ("A deleted account"), and a real member with no
label ("A member"). A social event always keeps a subject.

**The badge counts events, not rows on screen.** It used to count a 30-row page,
so a member with 111 unread saw 30.

**Reversible and irreversible never share a control.** The bell's X marks read.
The history row's X deletes, permanently. A test forbids the bell from deleting.

**A toggle may only exist while the server reads its column.** The new-posts
switch was deliberately withheld until the trigger read `push_new_posts`.

**Retention keeps unread for ever.** Age is not consent.

**Top section is "New" (unread), not "Highlights".** We have no ranking source
and will not invent one.

**Paging is a button, not infinite scroll.** The screen exists because a scroll
listener closed the panel under the user's finger.

**One row per (follower, post), not collapsed at write time**, capped at 1000
followers per post. The read side groups by day.

**Broadcast writes no `user_notifications` rows** — that table's AFTER INSERT
trigger would deliver every broadcast twice. Consequence, stated honestly: a
broadcast leaves no in-app history.

**Broadcast has no internal-secret path.** A leaked secret must never be able to
message the entire userbase.

**Every failure path logs.** A silent `EXCEPTION WHEN OTHERS` is exactly how push
stayed broken from launch.

**A member's privacy switch outranks a notification** (2026-08-04). Someone who
set their birthday to "only me" is not announced to anybody, even though the
recipients would all have been their friends.

---

## 7. Where the code lives

| Concern | File |
|---|---|
| **The sentence** — actor naming, action phrases, relative age | `src/lib/notifications/describe.ts` (`ACTION_CATALOG`) |
| Row-shape adapters (bell row / grouped row → one subject) | `src/lib/notifications/adapters.ts` |
| Group row type + history buckets | `src/lib/notificationText.ts` |
| History query, mark read, **delete** | `src/hooks/notifications/useNotificationHistory.ts` |
| Bell data, badge maths, push-exclusion | `src/hooks/notifications/useNotificationsQuery.ts` |
| The history screen | `src/pages/Notifications.tsx` |
| The bell, **`NOTIF_ICON` and `NOTIF_CATEGORY`** | `src/components/NotificationBell.tsx` |
| Deep links | `src/lib/notificationLinks.ts` |
| Preferences UI (incl. push section) | `src/pages/NotificationSettings.tsx` |
| Admin broadcast UI | `src/components/admin/AdminPushBroadcast.tsx` |
| Device registration (app only) | `src/lib/native/push.ts` |
| Edge functions | `supabase/functions/send-push`, `send-broadcast-push` |

Migrations, in order: `20260801120000` push schema fix · `20260801160000`
history+grouping · `20260801180000` fan-out · `20260801200000` observability ·
`20260802090000` push text catalog · `20260802140000` group key + unread grouped
· `20260802170000` bell exclusions · `20260802190000` DELETE policy ·
`20260802210000` retention · `20260802230000` trigger reads `push_new_posts` ·
**`20260804161000` birthday notifications (WRITTEN, NOT APPLIED — §9)**.

Tests: `notifications/__tests__/describe.test.ts` (17),
`pushCatalogParity.test.ts` (12), `badgeCount.test.ts` (10),
`pushPreferences.test.ts` (25), `notificationLinks.test.ts` (21),
`NotificationBellDismiss.test.tsx` (5), `NotificationBellGrouping.test.tsx` (5),
`NotificationBellScroll.test.tsx` (2), `useIsPrimaryInstance.test.tsx` (5),
`NotificationDelete.test.ts` (7), `NotificationEntryPoints.test.ts` (4),
`notificationText.test.ts` (5), `Notifications.test.tsx`,
**`birthdayNotification.test.ts` (17, pending)**.

---

## 8. Known gaps — honest list

**OPEN DECISION — new-post push reaches everyone.** The recorded decision
(2026-08-01) was that `new_post_from_following` is **in-app only**, and the
column defaults to false to enforce it. But the trigger's CASE starts
`WHEN np.user_id IS NULL THEN true`, and **77 of 78 members have no preferences
row** — so they all receive it. **Not done: it changes what 12 handsets receive
and is the owner's call.**

- **History pagination** can return a smaller count for a group straddling a page
  boundary. Preconditions measured platform-wide: **0**.
- **The four `inapp_*` switches are read by nothing.** 1 preferences row exists,
  0 switches off.
- **`emit_notification()` takes no actor**, so anything routed through it can
  never carry one. Only judging/competition paths use it today.
- **Deleted members' names survive in `message`** for unphrased types. Nothing
  renders or pushes them; retention ages them out.
- **No admin screen for `get_push_health()`.**
- **No alerting** — `delivery_looks_dead` has to be looked at.
- **A broadcast leaves no in-app record.**
- **Nothing detects a function being overwritten.** A weekly `dry_run` probe
  would have caught the Hello World incident in a day.
- **No broadcast has ever been sent for real** — only `dry_run`.
- **21 unrelated tests fail on `main`** (PhaseWatermark, JudgeGuideModal,
  complete-round-progression). Pre-existing.

---

## 9. `birthday` — the pending type (2026-08-04)

Owner request: **`🎉 Today is Neil Basu's Birthday`**, in the app.
Decisions taken with him: **accepted friends only · bell + phone push · no
email**.

Written, tested (17 tests, proven red first) and committed locally as part of
`263e5ca` — **but NOT applied to the database and NOT pushed**, because the
Supabase dashboard was signed out and the browser's GitHub account had no push
access. Full detail, numbers and the finishing order: **`TODAYS_BIRTHDAY.md`**.

Shape, for reference:

- `public.emit_birthday_notifications()` + pg_cron `emit-birthday-notifications`
  at **`30 3 * * *`** (03:30 UTC = 09:00 IST).
- One row per **accepted** friend; never to the celebrant; skips anyone whose
  `privacy_settings->>'dob_day_month'` is `only_me`.
- `message = '🎉 Today is ' || notif_display_name(id) || '''s Birthday'` — written
  once in SQL, rendered identically by the bell and the push because the type has
  **no `ACTION_CATALOG` entry** (see §3 step 4). **Do not add one.**
- `dedup_key = 'birthday:<celebrant>:<YYYY-MM-DD>:<recipient>'`, with
  `ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`.
- **`email_sent = true` on insert** — the only thing standing between this type
  and an email to every friend of every member, every year (§3 step 3).
- `birthday` → `/profile/<celebrant>`; `Cake` icon; "Birthdays" category.
