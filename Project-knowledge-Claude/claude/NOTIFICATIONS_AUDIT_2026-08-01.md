# Notifications — full audit, and Stages 1–4 shipped

**2026-08-01, extended 2026-08-02.** Written after the owner reported that
tapping "See All" and "View All Friends" in the notification panel navigated but
left the panel sitting on top of the new page. He asked for a plan for a proper
notification system before any more code was written. This is the audit, the
fixes that have shipped, and the backlog with his decisions already recorded.

Companion to `NOTIFICATIONS_SYSTEM.md`, which stays the operating reference.

---

## 1. The reported bug — what it actually was

Reproduced on production (build `2026-08-01-17`), then the stuck node was read
straight out of the DOM:

```
panelsInDom : 1          isConnected : true
opacity     : "0"        transform   : "matrix(0.95, 0, 0, 0.95, 0, 8)"
display     : flex       height      : 456px
```

That opacity and that transform **are** framer-motion's
`exit={{ opacity: 0, y: 8, scale: 0.95 }}` at its final frame. The click was
delivered, `setOpen(false)` ran, the exit animation played — and
`<AnimatePresence>` then **never unmounted the element**.

**Worse than reported:** `document.elementFromPoint()` at the centre of that box
returned a node inside the panel, `pointer-events: auto`. A **304 × 456 invisible
rectangle** over the top-right of every page, swallowing every click inside it
for the rest of the session. On Android the exit animation cannot run at all, so
there it simply stayed visible.

### The rule that came out of it

> **Removing an overlay must never depend on an animation completing, and never
> on a single click handler being delivered.**

---

## 2. Stage 1 — shipped (PR #38, build `2026-08-01-18`)

Four independent layers: `useDismissOnRouteChange` keyed on **`location.key`**
in a `useLayoutEffect`; no `AnimatePresence` and no `exit`; a real backdrop
portalled to `<body>` closing on `pointerdown`; and Escape listening even while
closed. Same hook applied to `GlobalSearch`, both navbar menus and `UserMenu`.
`Layout` renders **one** `Navbar` instead of two JSX positions.

**Proof.** Five tests, **all verified RED against `main`** first. The file does
**not** mock framer-motion — mocking it is why the existing suite could never
have caught this. Panels left behind after deploy: **0** across five paths.

---

## 3. Stage 2 — shipped (PR #39, build `2026-08-01-19`)

The bell is mounted **twice** — desktop and mobile clusters, one hidden by CSS.
**CSS hides; it does not unmount.** Two realtime subscriptions on one topic, and
the **sound played twice**. `useIsPrimaryInstance` names exactly one live
instance per key and **promotes the next when that one unmounts**. 5 tests.

---

## 4. Stage 3a — shipped (PR #40, build `2026-08-01-20`)

**The bell and the history page compose from the same function.**

The rules, decided once: an admin is always the brand; full name first with
`@username` as fallback; and **"Someone" is gone**, replaced by three distinct
states (no human actor → no name; profile gone → "A deleted account"; a real
person with no label → "A member").

**Proof.** 16 tests, including: **the identical sentence is produced from a
single bell row and from a group of one.**

---

## 5. Stage 3b — shipped (PR #41, build `2026-08-02-01`, migration applied)

**The push message stopped disagreeing with the app.** The body was
`user_notifications.message` — frozen text — and is now composed at send time by
`public.notif_push_body()`.

| | |
|---|---|
| push, before | `Payel Kundu Basu commented on your post` |
| push, now | `Payel Kundu Basu commented on your photo.` |

Three faults rode along with the frozen column: **33 rows** still named deleted
accounts; there was **no brand rule** in push (not leaking today only because
the one admin's `full_name` is already the brand); and
`new_post_from_following` pushed the literal `just shared a post`.

**Proof.** Over all 993 rows, exactly the 932 of a phrased type change and the
61 unphrased ones are byte-identical. **End to end through the real trigger,
then rolled back:** a real INSERT queued `Dipannita Sen commented on your
photo.` while the stored message said "post"; after ROLLBACK, **0 queued
requests, 0 rows**. `pushCatalogParity.test.ts` reads the migration as text and
fails on a one-character difference.

---

## 6. Stage 3c — shipped (PR #42, build `2026-08-02-02`, migration applied)

**The bell groups like the page, and the badge stopped lying.**

The bell fetched `.eq("is_read", false).limit(30)` and counted the length of
that array, so **the badge could never exceed 30**. 4 members were over it; the
worst — the owner's own account — had **111 unread behind a badge of 30**.

The grouping rule now exists once, as **`notif_group_key()`**;
`get_my_notifications_grouped()` was rewritten to call it, and that rewrite is
**provably behaviour-neutral** — old expression vs new function over all 993
rows: **0 differed, 498 distinct keys both ways**.
`get_my_unread_notifications_grouped()` is the bell's read, with `total_unread`
counted over every unread row.

Live on the owner's account:

```
badge : 99+          (it was 30)
"AVIJIT SHEEL and ATASHI DUTTA reacted to your photos 6 times."
"Mainak Mridha, Shakyasom Majumder and 3 others reacted to your photos 7 times."
"A member started following you."          <- the 3b rule, rendering
20 lines shown, then: "78 more not shown here"
```

Also: dismissing a line clears the whole group; the panel says when it is not
showing everything; and **the second text layer was deleted** —
`notificationText.ts` still exported sentence builders containing "Someone" and
"just shared a post."

---

## 7. Stage 4 — shipped (PR #43, build `2026-08-02-03`, migration applied)

### A friend request counted twice

It writes a pending `friendships` row **and** a `friend_request` notification.
The bell read both, so it was counted twice in the badge and drawn twice in the
panel — once with Accept/Decline, once as a line that did nothing. Exact, not
approximate: every member with pending requests had the same number of unread
`friend_request` rows (3/3, 3/3, 3/3, 3/3, 3/4).

Measured through the real RPC as one of those members:

| | total_unread | friend_request lines |
|---|---|---|
| before | 6 | 3 |
| after | 3 | 0 |

Their badge read **9** for **6** actual things.

The exclusion is a new **`_exclude_types`** argument on the RPC, not a
client-side filter, because `total_unread` is counted server-side — filtering in
the client would fix the list and leave the number wrong, the exact fault 3c
existed to remove. `/notifications` is a history and still shows them.

**Answering one now closes the notification it came from.** It never did:
**14 rows** were unread `friend_request` notifications for requests already
accepted. `reference_id` is the requester's profile id (113 of 127 rows), which
is what makes it findable. Historical rows are not touched — forward-only.

*(Note: the owner's own account has 0 pending requests, so his badge is
unchanged by this. It affects the five members measured above.)*

### Two destinations that were wrong

- **`new_post_from_following`** had no case in `getNotifLink` at all, so the
  **highest-volume type on the platform** fell through to the default and put
  every member on `/dashboard`. Now `/post/<id>`.
- **`comment_reply`** went to `/discover`. Of its 11 rows, 9 point at a live
  post, 2 at deleted posts, **none at a gallery image**. Now `/post/<id>`.

### Two things checked and deliberately NOT changed

- **`image_reaction` / `image_comment`** — `reference_id` is a
  `portfolio_images` row, i.e. the **home page gallery**, which has no page of
  its own anywhere in the app. `/discover` stays.
- **`course_published`** links to `/courses/<uuid>` against a `/courses/:slug`
  route, which *looks* broken. It is not: `useCourseDetail` already falls back
  to a lookup by id. Recorded so nobody "fixes" it.

### A correction to this audit

The old item 4 claimed **eight** types dump you on `/dashboard`. **Seven of them
are emitted by nothing** — no database function, no edge function, no client
code — and not one row of any of them exists: `entry_shortlisted`,
`entry_qualified`, `entry_finalist`, `round_results_published`,
`verification_required`, `admin_verification_pending`,
`admin_verification_submitted`. They are names in a list, not a routing failure.
Only `new_post_from_following` was real. They stay in `IMPERSONAL_TYPES` as a
deliberate guard: if one is ever emitted, it renders its own server text with no
person's name glued to the front.

**Proof.** 21 destination tests including a **census** of all 15 types that
actually exist on production and an assertion that **no live type reaches the
catch-all**; 10 badge tests including a pin that the exclusion reaches the RPC.
Both verified by **mutation**. The old single-argument function was dropped
first so there is no ambiguous overload — verified: 1 function, and a call
passing only `_limit` still behaves exactly as before, so the live client had no
broken window during the deploy.

---

## 8. Owner decisions, recorded

- **Full name first, `@username` as fallback** — everywhere. *(applied 3a/3b)*
- **The bell should group like the page**, badge counting **events**, not rows.
  *(applied 3c)*

---

## 9. The rest of the audit — not fixed, in priority order

**5 — The history screen's pagination is wrong.** It pages on a group's newest
timestamp while the filter applies to individual rows, so the same group can come
back on page 2 with **wrong counts**. And a day-group is capped at 100
notification ids, so a day with 300 reactions can never be fully marked read and
is pinned in "New" forever. *(The bell shares that 100-id cap — it matters less
there because a group is dismissed as a unit, but it is the same line of SQL.)*

**7 — Preference switches that do nothing.** The push toggles are not exposed in
the settings UI at all. The four in-app switches *are* shown, are written to the
database, and **no code anywhere reads them**. A type not listed in the push
rules falls through to "push to everyone", and the master "push off" switch is
evaluated *after* the new-post branch.

**8 — No way to delete a notification and no retention.**

**9 — `/notifications` has exactly one entry point in the whole app** — the
panel's own footer.

**10 — Deleted members' names are still stored.** Account deletion nulls
`actor_id` but leaves the name inside `message`. Nothing renders it for a phrased
type and nothing pushes it, but it is still in the table. Belongs with item 8.

**11 — `emit_notification()` takes no actor.** The combined email + in-app
emitter has no actor parameter, so anything routed through it can never carry an
actor id. Only judging/competition paths use it today and those types are
unphrased, so nothing is wrong right now.

*(Items 4 and 6 are done — Stage 4.)*

---

## 10. Notes for whoever picks this up

- **A surface may choose its layout. It may not choose its words.** Everything
  goes through `describeNotification` in `src/lib/notifications/describe.ts` —
  and, for push, the SQL copy that `pushCatalogParity.test.ts` pins to it.
- **What a group is, is decided once**, in `notif_group_key()`. Both read RPCs
  call it. Do not inline that `CASE` again.
- **Check what is actually emitted before fixing it.** Seven of the eight
  "broken routes" in the first draft of this audit were types no code emits.
  `pg_get_functiondef` across `pg_proc`, plus a grep of `supabase/functions` and
  `src`, settles it in two minutes.
- **Typecheck with the config CI uses:** `npx tsc --noEmit -p tsconfig.app.json`.
  Plain `npx tsc --noEmit` does **not** include the test files, and on 2026-08-02
  that difference put a red Typecheck on PR #42 for a mistyped `vi.fn()`.
- **A "regression test" gets run against `main` first.** A parity or source-pin
  test gets **mutated** — break each side on purpose and watch it fail.
- **Strip comments before asserting on source text.**
- **CSS hiding is not unmounting.** `useIsPrimaryInstance` exists for that.
- **To prove a push trigger without sending a push:** `BEGIN;` insert the
  notification; read `net.http_request_queue`; `ROLLBACK;`.
- **To read production as a specific member:** `BEGIN; SET LOCAL ROLE
  authenticated; SELECT set_config('request.jwt.claims', …, true);` then call the
  RPC; `ROLLBACK;`.
- **Changing an RPC's signature:** `CREATE OR REPLACE` with a new parameter
  creates a SECOND function and makes the old call ambiguous. Drop the old
  signature first. A call omitting the new argument then resolves to the default
  and behaves as before, so the live client never breaks mid-deploy.
- **21 tests fail on `main`** in the judging/competition suites, unrelated and
  pre-existing. Capture that set before starting.
