# Today's Birthday — the audit, the fix, and what is still unapplied

**Status, 2026-08-04 (late): CODE IS WRITTEN, TESTED AND COMMITTED LOCALLY —
BUT NOTHING IS LIVE.** Three things block it, all of them logins, none of them
code. See §6. Read that first.

---

## 1. What the owner asked for

Two things, on 2026-08-04, after a deep cross-check of "Today's Birthday":

1. **Web** — *"Exists, but desktop only and it misses 28 of 68 members. Only fix
   this error. Dont do anything more."*
2. **App** — *"Notification also build perfectly `🎉 Today is Neil Basu's
   Birthday` like so."*

And: **do not cut an Android build**, only update the project docs.

Note the scope line carefully. He named **one** defect to fix (the 28-of-68
miss). The desktop-only limitation, the timezone, and the milestones/suggestions
queries that share the same weakness were **deliberately left alone**. They are
listed in §5 as open items — do not "helpfully" fix them without being asked.

---

## 2. What the cross-check actually found (all measured on production)

| Channel | Verdict |
|---|---|
| **Web — Today's Birthday** | Exists. Desktop only. Missed 28 of 68 members. Ignored every member's privacy choice. |
| **Email — Today's Birthday** | **Does not exist.** No template, no cron job, no code, anywhere. |
| **App — Notification** | **Does not exist.** No such type had ever been created. |

### The numbers, so nobody has to re-measure them

- **82 members**, all `is_suspended = false`. **68 have a `date_of_birth`.**
- `dashboard-init` built the birthday list in TypeScript from
  `.select(…).eq("is_suspended", false).limit(50)` — **no `ORDER BY`**.
- **28 of the 68 fall outside that 50-row window** and could never appear.
  `EXPLAIN` shows `Seq Scan`; three consecutive runs returned an identical set,
  so it is stable — until any profile row is updated, which moves it in the heap.
- Excluded members included **SOMNATH PAL (20 Aug)** — the next birthday due —
  plus Amit Baran Sen (28 Apr), Tanmay De (25 May), Partha Mukherjee (7 Feb),
  Utpal Adhikary (3 Oct), Kaushik Das (1 Dec) and 22 others.
- **`privacy_settings->>'dob_day_month'` was never read.** Split on production:
  `public` 1 · `friends` 16 · `only_me` 2 · **unset 49**.
  **`EditProfile.tsx` initialises that control to `"friends"`** — so the 49 have
  been told their birthday is friends-only.
- Lifting the cap *alone* would have **newly exposed 9 members** who had
  explicitly restricted it. That is why the privacy rule went in with it
  (owner's decision, asked and answered the same day).
- Notification types ever created: post_reaction 523, new_post_from_following
  240, new_follower 239, friend_request 147, post_comment 98, friend_accepted
  37, comment_reply 17, course_published 12, image_reaction 11, badge_awarded 9,
  certificate_issued 9, potd_featured 1. **No birthday row, ever.**
- 12 cron jobs run; none touched birthdays. 9 email templates; none is a
  birthday. No DB function or trigger anywhere had "birth" in its name or body.
- Friendships: **97 pending, 37 accepted.** (Which is why the notification tests
  the status.)

---

## 3. The decisions the owner made

Asked explicitly on 2026-08-04, because each one changes what members see:

| Question | His answer |
|---|---|
| The 9 members who restricted their birthday | **Respect their choice** |
| Who gets the notification | **Accepted friends only** |
| Push as well as the bell | **Bell + phone push** |
| Email | Never asked for one → **none** |

---

## 4. What was built

### 4a. `supabase/migrations/20260804160000_todays_birthdays_rpc.sql` — NEW

`public.get_todays_birthdays(_viewer uuid)`, SECURITY DEFINER, pinned
`search_path`, **no LIMIT**. Visibility whitelist:

- always yourself;
- `dob_day_month = 'public'`;
- `dob_day_month = 'friends'` (**and the default**, via
  `COALESCE(NULLIF(…,''), 'friends')`) **and** an `accepted` friendship exists
  in either direction.

`only_me` simply has no branch that can reach it — deliberately a whitelist, not
a `<> 'only_me'` blacklist. `REVOKE … FROM PUBLIC, anon`, `GRANT … TO
service_role`.

### 4b. `supabase/migrations/20260804161000_birthday_notifications.sql` — NEW

`public.emit_birthday_notifications()` + pg_cron job
`emit-birthday-notifications` at **`30 3 * * *`** (03:30 UTC = 09:00 IST; same
calendar date in both zones at that moment, so it agrees with the sidebar).

- One row per **accepted friend** of each celebrant; never to the celebrant.
- Skips anyone who set `dob_day_month = 'only_me'`.
- `message = '🎉 Today is ' || notif_display_name(id) || '''s Birthday'`.
- `dedup_key = 'birthday:<celebrant>:<YYYY-MM-DD>:<recipient>'` with
  `ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING` — the
  predicate is **required**, because the unique index
  `uniq_user_notifications_dedup_key` is partial.

### 4c. `supabase/functions/dashboard-init/index.ts` — MODIFIED

New **Q12** in the existing `Promise.all` (so no extra round trip):
`targetUserId ? admin.rpc("get_todays_birthdays", { _viewer: targetUserId }) :
Promise.resolve({ data: [] })`. The old in-TypeScript birthday loop is deleted.
**Q11 keeps its `.limit(50)`** — milestones and suggestions were out of scope.

### 4d. Front-end — MODIFIED

- `src/lib/notificationLinks.ts` — `case "birthday"` → `/profile/<reference_id>`
  (the celebrant), falling back to `/feed`. Without it the type would join the
  eight that used to dump everyone on `/dashboard`.
- `src/components/NotificationBell.tsx` — `birthday: Cake` icon and
  `birthday: "Birthdays"` category.

### 4e. Tests — NEW, 33 of them

- `src/lib/__tests__/birthdayVisibility.test.ts` (16)
- `src/lib/__tests__/birthdayNotification.test.ts` (17)

**Proven red first:** with the migrations present but the three app files
reverted, **8 of them fail**. Full suite after the change: **246 passed** across
`src/lib/__tests__` + `src/components/__tests__`; `tsc -p tsconfig.app.json`
clean.

---

## 5. THE TWO TRAPS — read before touching notifications again

### 5a. An unlisted notification type EMAILS EVERYONE by default

`get_notification_email_enabled(_user_id, _notif_type)` ends in **`ELSE true`**,
and `send_notification_email` gates on nothing else — no template lookup, no
allow-list. Verified 2026-08-04. So **any new type emails every recipient**.

The birthday rows are inserted with **`email_sent = true`**, because the email
trigger's first statement is `IF NEW.email_sent IS TRUE THEN RETURN NEW`. That
suppresses the email **without editing a function 20+ other types depend on**.
If anyone "tidies" that flag away, birthday emails start going out silently.
A test pins it.

### 5b. An unlisted type also PUSHES to everyone by default

`push_on_notification` has the same `ELSE true` shape (gated only by
`np.push_enabled` and a missing-prefs-row → true). For birthdays that is what we
want, so nothing was changed — **but it is a fall-through, not a stated rule.**
Anyone who flips that `ELSE` to `false` silently turns birthday push off.

### 5c. Why no TypeScript phrase was added

`notif_push_body(_type,_actor_id,_message)` returns the row's `message`
**verbatim** whenever `notif_action_phrase(_type)` IS NULL — and
`describeNotification()` falls back to `message` for the same reason. So the
sentence is written **once, in SQL**, and the bell and the push render it
identically. **Do not add `birthday` to `ACTION_CATALOG`** — that would switch
the bell to "<name> <verb>" and make the two surfaces disagree, which is exactly
the bug that catalogue was built to end. A test pins this too.

---

## 6. ⚠️ WHY NOTHING IS LIVE — three login blockers

1. **The Supabase dashboard is signed out in both connected Chrome browsers**
   (checked 2026-08-04; `/dashboard/sign-in` redirect, no
   `supabase.dashboard.auth.token` in localStorage). Without it there is no way
   to reach the pg-meta platform API, so **neither migration has been applied.**
2. **GitHub in the connected browser is signed in as `altisappdev`, which has
   NO push access** — the upload page says *"Uploads are disabled. File uploads
   require push access to this repository."* Earlier commits today worked
   because the browser was signed in as `altisinfonet`. So **nothing is pushed.**
3. **There is no CI that deploys Supabase edge functions.** `.github/workflows`
   contains only `android-build.yml` and `typecheck.yml`. Committing
   `dashboard-init/index.ts` does **not** deploy it — it must be deployed from
   the Supabase dashboard (or the Management API with a dashboard session).

I cannot sign in on the owner's behalf, so all three need him.

### The exact order to finish this

1. Sign in to the Supabase dashboard, and to GitHub as `altisinfonet`.
2. **Apply `20260804160000_todays_birthdays_rpc.sql`** — rehearse first:
   `BEGIN; <the file>; SELECT * FROM public.get_todays_birthdays('<a real member uuid>'); ROLLBACK;`
   (a pg-meta body of `BEGIN … SELECT … ROLLBACK` returns the SELECT's rows).
3. **Deploy `dashboard-init`.** Until this happens the RPC exists but nothing
   calls it, and the sidebar keeps the old 50-row behaviour.
4. **Apply `20260804161000_birthday_notifications.sql`**, then prove the emitter
   without sending anything:
   `BEGIN; SELECT public.emit_birthday_notifications(); SELECT user_id, message, email_sent FROM public.user_notifications WHERE type='birthday'; ROLLBACK;`
   Today (4 Aug) there are **0 birthdays**, so expect 0 rows — to see it work,
   temporarily set a test member's `date_of_birth` inside the same rolled-back
   transaction.
5. Push the 7 files to `main` (5 commits, in dependency order: migrations →
   `dashboard-init` → `notificationLinks.ts` → `NotificationBell.tsx` → tests).
6. **The front-end half needs an Android build to reach the app** — the icon,
   the category and the tap destination are app code. It is changes **4, 5 and
   6** of the batch of ten (WORKING_RULES §0). The DB half and the edge function
   reach every installed build immediately and need no build at all.

The finished files are also delivered to the owner as a folder and as a git
patch (`birthday-change.patch`, one commit, applies with `git am`), so this
survives the sandbox being reclaimed.

---

## 7. Deliberately NOT done — do not do these unasked

- **Desktop-only.** `FeedLeftSidebar` is `hidden xl:block`, so the card renders
  at ≥1280px and nowhere else. Mobile web and the app show no birthday card.
  The owner scoped the fix to the 28-of-68 miss; he did not ask for the card to
  move.
- **Timezone.** The day is still the server's UTC clock, exactly as the deleted
  TypeScript computed it, so the card turns over at **05:30 IST**. Changing it
  is a behaviour change, not a bug fix.
- **29 February.** Matches only in a leap year. No member has that date, so no
  untested special case was invented.
- **Milestones and people-suggestions** still read the `LIMIT 50` query and have
  the identical weakness.
- **No birthday email**, no greeting/wish action, no "upcoming birthdays".
