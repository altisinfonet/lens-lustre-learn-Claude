# N4: push follows the centre — fixture (local Postgres 16, never run against a lane)

**Base.** The N3 fixture (N2 + 0110 + 0140) was copied twice: `n170_stg` (`p32.lane=staging`) and `n170_prod`
(`p32.lane=production`). Added: `push_config`, with the real shape (boolean singleton id); a stand-in
`net.http_post` that records each call; a pass-through `notif_push_body`; and the **real live
`push_on_notification()` body**, copied byte for byte from git `20260815064043` (md5 8610c27a…, which N0
measured identical on both lanes), attached as the AFTER INSERT trigger.

`likes_comments` is switched on for member A only. Member B's group is off.

| Case | Today's trigger | After 0170 |
|---|---|---|
| 1 B (group off), reaction pushes off | no push | no push |
| 2 B (group off), reaction pushes on | push, data `{type}` | push, data `{type}` (unchanged) |
| 3 A (group on), allowed | push, data `{type}` | push, data `{type, notification_id}` (for the receipt) |
| 4 A in quiet hours | **push** (quiet hours ignored) | **no push**. The bell row is still written |
| 5 A turned reaction pushes off | no push | no push |
| 6 A master push off (a type with no push setting of its own) | no push | no push |
| 7 centre fault (registry column renamed) | push | push. The old rules decide, plus a WARNING |
| 8 B (group off), new-post pushes off | no push | no push |
| 9 A (group on), new-post pushes off | no push | no push. **Before the review fix: 1 push** |

## Review round 1: an opt-out would have been dropped

The old CASE reads `push_new_posts` for `new_post_from_following`, but 0110's registry had no push setting for
that type. I reproduced it on the fixture with 0170 as first written: A (group on, `push_new_posts=false`)
**received** the push, and B (group off) did not. Of the 15 types the old CASE maps, this was the only one that
didn't match.

Fix in 0170:
- Set that registry row to `push_new_posts`.
- A POST check (`NC-0170-POST-001`) refuses the apply unless all 15 match. This was shown refusing when
  `post_reaction` was deliberately changed to the wrong setting.
- The rollback returns the row to NULL.
- The PROBE now pins the exact new body (md5 `2ee2553f…`), re-checks the 15-type match, and checks that the
  function's owner can execute `notification_centre_live`.
- A rollback with the function missing now refuses instead of going ahead.

Sequence on both copies:
1. PROBE FAIL before.
2. Apply.
3. PROBE PASS (it prints md5 and length only).
4. Rollback: md5 back to 8610c27a…, the index is dropped, and cases 3 and 4 behave as today again.
5. Re-apply, then PROBE PASS.

Refusals:
- Rollback when 0170 is not live: `NC-0170-RB-PRE-001`.
- Apply when the live body is not the measured one: `NC-0170-PRE-001`.

The first fixture run gave 0 pushes in every case. That was a fixture bug: `push_config.id` was an integer, so
`WHERE id` errored and the trigger's catch-all swallowed it. It was fixed to the real boolean shape, and the
"today's trigger" column above proves the fixture now sends pushes.
