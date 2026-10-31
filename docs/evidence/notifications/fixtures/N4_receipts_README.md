# N4 push receipts fixture (local Postgres 16, never run against a lane)

**Base.** The N3 fixture (N2 fixture + 0110 + 0140) was copied twice: `n4_stg` (`p32.lane=staging`) and
`n4_prod` (`p32.lane=production`). Added: `auth.uid()` reading a test setting, `ops_alarms` with the
real `ops_alarm_set` from `20261103_0300`, and stand-ins for pg_cron's `schedule` / `unschedule` / `job`.
The base already had `notif_centre_likes_comments` on for one test member, which is not member A or B below.

| Step | staging-shaped | production-shaped |
|---|---|---|
| PROBE before apply | FAIL — table missing (expected) | FAIL — same |
| apply | OK | OK |
| PROBE after apply | PASS | PASS |

Behaviour (staging-shaped):

| Case | Result |
|---|---|
| group off for member A → `start` | NULL, no row (today's behaviour) |
| likes_comments switched on for A only | A's `post_reaction` gets an id. B: NULL. A's `new_follower` (another group): NULL. An unregistered type: NULL |
| `finish(ok 2, failed 1, pruned 1)`, then `finish` again | `sent`, 2/1/1. The second call changes nothing (an outcome is set once) |
| `opened` by B / by A / by A again | false / true / false |
| a member calls `start`, reads the table; anon calls `opened` | all `permission denied` |
| 25 finished pushes in the hour, 15 failed | alarm `notif_push_failing` opens ("15 of 25 …") |
| 19 pushes, all failed (under 20) | alarm closes |
| 20 rows stuck in `sending` for 20 min | counted as failed: alarm opens |
| a 31-day-old row | purged by the tick |
| rollback | cron job gone, alarm closed, PROBE FAILs again |
| re-apply | OK, PROBE PASS |

**send-push** (`supabase/functions/_shared/pushReceipts.ts`, tests in `src/__tests__/pushReceipts.test.ts`):
- A receipt call that fails, errors or returns NULL means no `delivery_id`, and the message is today's message.
- A caller-supplied `delivery_id` is kept and creates no new row.
- A receipt stores only the HTTP status and FCM's error code, never FCM's response body.

**App** (`src/lib/notifications/pushOpened.ts`): tapping a push that carries `delivery_id` reports it opened.
A push without one sends nothing. This never throws.
