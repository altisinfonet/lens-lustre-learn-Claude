# N4 option C — part 3 DONE. Parts 1 and 2 specified, not started.

Owner chose **C** (keep the id, mark the account deleted, repair history) and
said "go for it", 2026-08-10.

---

## ✅ PART 3 — the 33 old rows are repaired. Applied to production.

```sql
update public.user_notifications n
   set actor_id = n.reference_id
 where n.actor_id is null
   and n.type = 'new_follower'
   and n.reference_id is not null
   and not exists (select 1 from public.profiles p where p.id = n.reference_id);
```

Verified immediately after:

| | before | after |
|---|---|---|
| follow notifications with **no actor** | **33** | **0** |
| follow notifications whose actor is a **deleted account** | 2 | **35** |
| total follow notifications | 307 | 307 |

Nothing was created or destroyed — 33 rows moved from "anonymous" to "actor is a
deleted account". **Reversal** is the same statement with `set actor_id = null`
and the same `WHERE`, which is why this part went first.

**Restricted to `new_follower` on purpose.** That is the only type where
`reference_id` is provably the actor (the trigger sets
`reference_id = follower_id`). For `post_reaction` and `post_comment`,
`reference_id` is the **post** id — copying it would have invented a fake person.
The 24 reaction and 18 comment rows are deliberately untouched.

## ⛔ WHY I STOPPED HERE

**Part 3 alone changes nothing the member sees, and that is expected.** The bell
still reads "A member", because the grouped RPC cannot yet tell the display that
the profile is gone.

There is a shortcut available and I am not taking it. The client *could* infer
"deleted" from "the RPC returned an empty name and empty username" — all 90 live
profiles have names, so in practice it would be right today. But
`describe.ts` documents three distinct cases on purpose, and one of them is
*"the actor exists but has neither name nor username → A member"*. Inferring
would quietly merge two rules that were separated deliberately, and this
codebase has been bitten twice this month by exactly that kind of guess (the
derived thumbnail addresses, and the friend-only tagging theory). The RPC should
return the fact instead of the client deducing it.

Doing that properly means rewriting a ~70-line SQL function and re-typing it
into the browser SQL editor. I do not have the working memory left in this
session to do that and verify it to the standard the rest of today's work got.
Starting it and stopping midway would leave the notification query half-edited
on a live site.

---

## PART 2 — make "A deleted account" reachable *(next)*

`get_my_unread_notifications_grouped`
(`supabase/migrations/20260802170000_bell_excludes_duplicated_types.sql`):

1. In `actors_ranked`, add `(p.id IS NOT NULL) AS profile_exists` — the LEFT
   JOIN to `public.profiles` is already there.
2. In `actors_top`, add
   `array_agg(ar.profile_exists ORDER BY ar.rn) AS actor_known`.
3. Add `actor_known boolean[]` to the `RETURNS TABLE` list and to the final
   SELECT, with `coalesce(t.actor_known, '{}'::boolean[])`.

Client, `src/lib/notifications/adapters.ts`, `subjectFromGroup`:

```ts
known: row.actor_known?.[i] ?? undefined,
```

`actorDisplayName()` already turns `known === false` into "A deleted account".
**That function must not be touched.**

Then the 35 rows read *"A deleted account started following you"* — honest, and
no name or avatar is revealed.

## PART 1 — stop nulling, for future deletions *(last, security path)*

* `supabase/functions/delete-my-account/index.ts:138`
* `supabase/functions/delete-user/index.ts:127`

both: `.from("user_notifications").update({ actor_id: null }).eq("actor_id", user_id)`

Delete those two calls. **Edge functions do not auto-deploy on this project** —
each must be deployed by hand in the Supabase dashboard. These files are the
**P0 deleted-account security fix of 2026-08-06**; nothing else in them may
change, and the deletion flow should be re-tested after.

Part 1 governs only *future* deletions. Parts 3 and 2 already cover everything
that exists today, which is why it is safe for it to come last.

---

## The design decision this locks in, recorded deliberately

Deletion previously nulled `actor_id` while leaving `reference_id` pointing at
the same person — it hid the actor from the display without actually
anonymising the row. Option C settles this the other way: **the profile being
gone is the anonymisation.** The id is kept, the profile is not, and the display
says "A deleted account". No name, no avatar, nothing that was not already
recoverable from `reference_id`.
