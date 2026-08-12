# N4 — "A member started following you". Found. It is not a bug in the code.

Owner report, 2026-08-09, with screenshots: four consecutive
*"A member started following you"* with no name and no avatar, beside one that
correctly read *"Саша Бражкин started…"*.

---

## What it actually is

Measured on production, `user_notifications`:

| type | total | **actor missing** |
|---|---|---|
| new_follower | 307 | **33** (11%) |
| post_reaction | 758 | 24 |
| post_comment | 146 | 18 |
| friend_request | 185 | 11 |
| certificate_issued | 9 | 9 — no human actor by design |

The display rule (`notif_display_name`, mirrored by `actorDisplayName()`) is:

* actor id **NULL** → **"A member"**
* profile missing, id present → "A deleted account"
* otherwise full name, then @handle, then "A member"

All **90** profiles on the site have a `full_name`, so the third branch is never
reached. Every one of these is the **first** branch: the actor id is null.

**Why it is null:** `user_notifications` has **zero foreign keys** — checked, the
`pg_constraint` query returns no rows — so nothing nulls it automatically. It is
nulled deliberately by the account-deletion routine, exactly as
`push_text_from_catalog.sql` documents: *"when the id has been nulled by an
account deletion we can no longer say who, and we do not guess."*

So: **these notifications were left by people who have since deleted their
accounts.** The code is doing what it was built to do.

## Three things this rules out

* **Not the 2026-08-06 RLS work.** That was my theory in two documents; this is
  the third piece of evidence against it. The nulls span **2026-03-24 to
  2026-08-08** — months before and after that day.
* **Not a blank display name.** Zero of 90 profiles lack one.
* **Not a failed lookup.** The grouped-notifications RPC drops rows with a null
  actor before it ever reaches `profiles` (`WHERE m.actor_id IS NOT NULL`), so
  no join is failing.

## The real complaint, restated honestly

The wording is wrong, not the data. *"A member started following you"* reads as
*"someone here, we just won't say who"* — which sounds broken. What actually
happened is that the person left.

The system already owns a better phrase for this — **"A deleted account"** — but
it can never be used, because deletion destroys the id that would distinguish
the two cases. The branch is unreachable in practice.

## Options — this is a wording and privacy call, so it is yours

| | What changes | Cost |
|---|---|---|
| **A. Reword the null-actor case** *(recommended)* | "A member" → **"A former member"** wherever the actor id is null. One string in `describe.ts`, one in `notif_display_name`. Nothing else moves | ~10 minutes, no build needed for web. Tells the truth without naming anyone |
| **B. Leave it** | Nothing | Free. The reports will keep coming, because the wording still reads as a fault |
| **C. Keep the id, mark the account deleted** | Deletion stops nulling the actor and flags the profile instead, so "A deleted account" becomes reachable — and old rows could be repaired | Larger. Touches the deletion path, which is the **P0 security work from 2026-08-06**. I would not go near it without a specific decision from you |

**My recommendation is A.** It fixes what you actually saw — a message that
looks broken — costs almost nothing, and does not touch the deletion path.
**B** is defensible if you would rather nothing changed. **C** is the only one
that is technically "complete", and it is also the only one that risks the
security fix, so I would not do it on my own judgement.

## Not done

Nothing was changed. This is a finding, not a fix — the next step needs your
word on which of A, B or C.
