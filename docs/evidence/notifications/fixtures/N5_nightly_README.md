# N5 part 2 fixture: nightly live stray-writer count (local Postgres 16, never run against a lane)

**Fixture shape.** Each lane has its own database (`n5b_stg` with `p32.lane=staging`, `n5b_prod` with
`p32.lane=production`). Each holds every public function at its latest git definition (450 functions;
a function counts as absent when a later `DROP FUNCTION` removes it). Each also holds the 10 live-only
bodies captured by N1 (`20261104_0150`). N0 measured these bodies as identical to live on both lanes
(`N0_MAP.md`). The fixture also has stand-ins for `user_notifications`, `admin_notifications`,
`ops_alarms` with the real `ops_alarm_set` from `20261103_0300`, and pg_cron's
`cron.schedule` / `cron.unschedule` / `cron.job`. The scan reads only `proname` and the body, so
this is everything it touches.

The live bodies of `notify_post_comment`, `notify_post_reaction` and `notify_post_tag` only queue;
they do not write the tables. So they are not on the list, and `pj_handle_tag_notification` is.
That gives the CI ratchet's 31 SQL writers.

| Step | staging-shaped | production-shaped |
|---|---|---|
| PROBE before apply | FAIL — allow-list missing (expected) | FAIL — same |
| apply | OK | OK |
| PROBE after apply | PASS — 31 rows, 0 strays, 0 listed-but-absent | PASS — same |

Behaviour (staging-shaped):

| Case | Result |
|---|---|
| a new function inserts into `user_notifications` | check returns 1; alarm `notif_stray_writer` opens naming it; PROBE FAILs naming it |
| that function dropped | check returns 0; alarm closes |
| a signed-in member runs the check | `permission denied` |
| quoted `"public"."admin_notifications"` in a SQL-language body | counted (1), and 0 after drop |
| rollback | cron job gone, alarm closed, PROBE FAILs again |
| apply while a stray already exists | REFUSED `NC-0130-POST-001` naming it; nothing created |
| apply without `p32.lane` | REFUSED |
| re-apply after rollback | OK, PROBE PASS |

## Known limits (accepted, from review)

- Dynamic SQL (`EXECUTE format('INSERT INTO %I …')`) and writers outside schema `public` are not seen.
- The list matches by name, so a new overload of a listed name is not flagged.
- A comment mentioning such an insert counts as a stray: a false alarm, which is the safe direction.
