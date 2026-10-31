# N2 fixture (local Postgres 16)

Base: `N2_fixture_base.sql` (production-shaped `notification_preferences` with
every in-app / push / e-mail column; `auth.users`, `site_settings`,
`user_blocks`, both notification tables).

## Apply cycle (lane `staging`, then `production` for the shadow)

| Step | Result |
|---|---|
| PROBE 0110 before apply | FAIL — `notification_types missing (0110 not applied)` (expected) |
| apply without `p32.lane` | REFUSED by the lane guard |
| apply | OK |
| PROBE 0110 after apply | PASS — registry 49 types, 7 groups, centre log 0 rows, every switch OFF, emit inert inside a READ ONLY transaction |
| apply again | REFUSED — `NC-0110-PRE-001 already applied` |
| shadow PROBE 0111 right after apply | FAIL — `SHADOW INCOMPLETE … run again after <apply + 24 h>` (expected) |
| rollback | OK |
| PROBE 0110 after rollback | FAIL again (expected) |
| apply again after rollback | OK; PROBE PASS |

## Shadow PASS path (seed time back-dated 25 h, rows planted)

```
SHADOW|admin|new_ticket|today=1|centre_send=1|centre_skip=0|reasons={}
SHADOW|member|mystery_type|today=1|centre_send=0|centre_skip=1|reasons={"type_unregistered": 1}
SHADOW|member|post_comment|today=2|centre_send=1|centre_skip=1|reasons={"duplicate": 1}
SHADOW|member|post_reaction|today=1|centre_send=0|centre_skip=1|reasons={"self": 1}
SHADOW|TOTAL|today=5|centre_send=2|centre_skip=3|equal=f
```

## Decision cases (`N2_fixture_decide_cases.sql`) — first run FAILED

The first run found two bugs, both fixed before this commit:
`reasons || 'self'` parsed `'self'` as an array literal (ERROR), and a member
with no settings row got `null` channels (NULL comparison). After the fix all
24 cases give the designed answer: clean send; self; unregistered; type off;
blocked both directions; duplicate inside the window and not after it; rate
limit (3 per hour); push master switch off → push false, in-app and e-mail
true; in-app setting off → skipped; e-mail setting off → e-mail false only;
quiet hours 22:00–07:00 hold push at 03:00 and not at 12:00; a replayed row is
not its own duplicate; admin duplicate by reference; switch default OFF and
`"live"` read as on; emit writes when live, returns NULL for a skipped
decision and for a group that is off; the log holds one row per decision.

## Review round 1 (nothing blocking; medium points applied)

| Case | Previous version | Now |
|---|---|---|
| quiet hours with an unknown zone (`Mars/Olympus`) | ERROR `time zone "Mars/Olympus" not recognized` — would break a send | falls back to UTC, `send: true` |
| `entry_approved`, member has competition pushes off | push `true` (setting ignored: `member_can_disable` was false) | push `false`; a CHECK now keeps "always on" types free of settings columns |
| switch = `{"users": [C]}` | `notification_centre_live(text, uuid)` did not exist | on for C, off for others, off with no recipient; emit for an unlisted member returns NULL |
| shadow PROBE on a table without a `user_id` index | (no check) | refuses: `no index leads with user_notifications.user_id` |
| shadow window anchor | `min(updated_at)` (moves on any edit) | `min(seeded_at)`, never updated |
| two emits at once for the same (type, recipient, reference) | could both pass the duplicate check | `pg_advisory_xact_lock` serialises them |

Full cycle re-run: PROBE FAIL → apply → PROBE PASS (49 types) → shadow refuses without index / INCOMPLETE with it; 31 decision cases as designed.
