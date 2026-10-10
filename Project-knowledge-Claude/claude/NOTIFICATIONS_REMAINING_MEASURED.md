# Notifications — every live item is done

**2026-08-02.** Stages 1, 2, 3a, 3b, 3c, 4, 7, 7b, 8, 8b and 9 have shipped.
**Nothing on the live list remains.** Three latent items are left, each measured
as affecting nobody today.

*Checked 2026-08-03: still accurate — no notification behaviour changed that
day. One adjacent change: `/notifications` is now inside `<RequireAuth>`
(PR #56), so a logged-out visitor is redirected to `/login` instead of seeing an
empty history page.*

Method throughout: *measure before asserting* — `WORKING_RULES.md` §3. Two items
the original audit called bugs turned out to affect no member at all, and one it
claimed affected eight notification types affected exactly one.

---

## SHIPPED

| | What was actually wrong |
|---|---|
| **1** The panel that would not close (#38, `-18`) | `AnimatePresence` kept the exiting node mounted: a **304×456 invisible rectangle** eating clicks over every page until reload. Escape did nothing because its listener was gated on `open`. Four independent layers; 5 tests, all red against `main` first. |
| **2** One bell instead of two (#39, `-19`) | Mounted twice, CSS-hidden — two realtime subscriptions on one topic and the sound playing **twice**. `useIsPrimaryInstance` promotes a survivor rather than letting the effect die. |
| **3a** One sentence, everywhere (#40, `-20`) | Bell rendered the frozen `message`; the page recomposed. Admin real names leaked; "Someone" hid three different states. One `describeNotification()`. |
| **3b** Push stopped disagreeing (#41, `-01`) | Push body was the frozen column: "on your **post**" vs "on your **photo**". Also pushed **33 deleted members' names** and had no brand rule. Composed at send time now; parity test reads the migration and fails on one character. |
| **3c** The bell groups, badge stops lying (#42, `-02`) | Badge counted a **30-row page**, so a member with **111 unread saw 30**. Grouping rule extracted to `notif_group_key()` — rewrite proven neutral over all 993 rows, **0 differed**. |
| **4** Right destinations, one friend request (#43, `-03`) | `new_post_from_following` — highest volume — had **no route** and landed everyone on `/dashboard`. Friend requests **counted twice** (badge read 9 for 6 things). Answering one now clears its notification (14 were stale). |
| **7** Push can be turned off (#46, `-06`) | 12 devices, 62 notifications/24h, **no off switch anywhere**. Columns existed, trigger already read them. **No server change.** |
| **7b** New-post push has its own switch (#48, `-08`) | A gap **I opened in #46**: `push_new_posts` existed but the trigger ignored it. One line. Master switch still evaluated first. |
| **8** Members can delete (#47, `-07`) | Not a missing button — **no DELETE policy existed at all**. One policy, `auth.uid() = user_id`, nothing wider. |
| **8b** Retention, 90 days (`main`) | Owner's call: prune at 90 days, **keep unread for ever**. Dry run predicted 140, real run deleted exactly 140 (994→854). Daily 03:20 UTC, ≤5000/run, hard floor of 30 days. |
| **9** More than one way in (#49, `-09`) | `/notifications` was linked from **one file in the whole app** — the bell footer — behind a panel now designed to close itself. Added to the desktop account menu and the phone profile sheet. |

**Every one was verified on production, and every irreversible one was rehearsed
in a rolled-back transaction first.**

---

## STILL OPEN — 3, all latent

- **History pagination.** Page 2 regroups after filtering by the cursor, so a
  day-group straddling the boundary returns a smaller count. On the heaviest
  account (121 groups): **0 straddling groups, biggest group 9 events, 0 groups
  over the 100-id cap.** Both preconditions zero platform-wide. Becomes real
  when one member gets 100+ events of one type in a day.
- **The four in-app switches are read by nothing.** No SQL references
  `inapp_%`. But **1 preferences row exists out of 78 members, 0 switches off.**
- **`emit_notification()` takes no actor.** Only judging/competition paths use
  it and those types are unphrased. Wrong the moment a social type routes
  through it.

---

## Rules this work produced — keep them

- **A toggle may appear only while the server demonstrably reads its column.**
  The test reads the migration and fails if that line is removed while the
  switch stays visible.
- **Reversible and irreversible never share a control.** The bell's X marks
  read; the history row's X deletes. A test forbids the bell from deleting.
- **Delete/prune is rehearsed rolled-back first**, and the prediction must match
  the real run exactly before it is called done.
- **Count the entrances, not the file.** The entry-point test scans all of
  `src/` so it cannot be satisfied by one hard-coded path.
- `/settings/notifications` is a **code-split route** — check
  `NotificationSettings-*.js`, not `index-*.js`, or you get a false negative.
