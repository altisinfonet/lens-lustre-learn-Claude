# Phase 0 findings — and a hypothesis of mine that the evidence killed

Read from the live **Admin → Error Log**, window = last 30 days, and from direct
probes against production.

---

## 1. The blank page is the LOGIN page — this was worse than I said

Every `crypto.randomUUID` crash in the log has the same two fields:

```
route:           /login
componentStack:  at qe (https://localhost/assets/Login-CAFmm….js)
```

`https://localhost` is the installed app. So on a phone with an out-of-date
Android WebView, **the login screen itself crashes** — the member cannot sign
in at all. They see a dead screen, close the app, try again, sometimes land on
a cached page that works. That is precisely *"sometimes coming and sometimes
blank."*

The cause is `useTrustedDevice` — the "remember this device" id, which runs on
the login screen. Already fixed on `main`; reaches members in **1059**.

It also goes back further than I thought: the same crash appears on build
**`2026-08-07-6` (1057)** on 7 Aug, not just 1058.

## 2. ❌ My RLS theory for tagging is WRONG — the log says so

I had written that N2 (tagging) and N4 (notifications) were probably one fault
in the 2026-08-06 RESTRICTIVE policy work. **The evidence does not support it.**

The tag insert has its own log code, **`POST-2005 · POST_TAGS_INSERT_FAILED`**,
which fires on any refusal including an RLS block. In **30 days** the Error Log
holds **32 errors across 5 codes**:

| Code | Times | What |
|---|---|---|
| SYS-9002 | 28 | route crashed — the blank page above |
| SYS-9008 | 20 | app could not ask Play about updates |
| AUTH-1005 | 2 | deleted account's session ended (the security fix working) |
| DB-3001 | 2 | profile read timed out |
| NOTIF-7001 | 2 | push setup failed |

**`POST-2005`: zero.** Not once. **No tag write is being refused.**

Reading the migration confirms it: the guard policies created on 2026-08-06 are
`for insert`, `for update`, `for delete` only. **SELECT was never restricted.**
So the theory fails twice over — no blocked writes in the log, and no blocked
reads in the SQL.

I also probed production directly: `profiles_public_data` returns names and
avatars to an **anonymous** caller, HTTP 200. So N4's *"A member"* is not a
blocked profile read either.

**This is worth recording because I stated the RLS theory with some
confidence in two documents.** It was a plausible story built on a coincidence
of dates. It is not what is happening.

## 3. Where tagging actually breaks — narrowed, not yet proven

`TagPeopleModal.tsx` can only offer **accepted friends**:

```
friendships (status = 'accepted')  →  ids  →  profiles_public_data
```

and when that list is empty it shows:

> *"You can only tag accepted friends. Add some friends first."*

Since no insert is failing, the failure is either **before** the insert (the
friend list is empty, so there is nobody to tag) or **after** it (tags save but
never render). Site Health reports **171 friendships** exist, so the data is
there — which points at the query or the join, not at missing data.

**Next step, and it is cheap:** open the composer on the live site, attach a
photo, open the tag panel, and watch whether the friend list loads. Nothing is
posted. That single observation separates the two branches.

## 4. Still open on the WEB — the old chunk poisoning has not stopped

Aug 10, 07:43 AM, on `/home`:

```
Failed to fetch dynamically imported module:
https://www.50mmretina.com/assets/Index-D43UTNkT.js
```

This is `BLANK_PAGE_ROOT_CAUSE.md` §6 — the structural fix that was never
applied because it changes hosting for every asset and needs the owner's
decision: **a missing file under `/assets/*` must return 404, not 200 with
`index.html`.** Until then, `immutable, max-age=31536000` keeps converting a
transient miss into a year-long broken cache entry.

Only 1 member and the client self-heals now, but it is still happening.

## 5. Small things seen in passing

* **`SYS-9008` — 20 times.** The app cannot ask Play whether an update exists:
  `ERROR_APP_NOT_OWNED` and `Failed to bind to the service`. The log's own note
  is exact: *"persistent hits mean members are stranded on an old build, which
  is how an already-fixed bug keeps being reported."* Worth watching after 1059
  — if members are not prompted to update, fixes do not land.
* **`DB-3001`** ×2 — the ban/suspension profile check timed out. Deliberately
  keeps the member signed in. Two hits in a month is noise, not a pattern.
* **`NOTIF-7001`** ×2 — `SERVICE_NOT_AVAILABLE` from Firebase on one device.
  Nothing tells the member; they simply never receive a push.

---

## What this changes in the plan

Phase 0's first item is **answered, not completed**: the RLS review is done and
the answer is *no, that is not it*. That is still a win — it stops the next
few hours being spent in the wrong place.

Phase 0 continues with the tag-panel observation (above), the CDN image check,
and the two test-hygiene items. Build cadence is unchanged: **no build until
Phase 1 is done**, then 1059 carries everything at once.
