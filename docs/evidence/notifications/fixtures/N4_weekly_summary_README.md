# N4 weekly summary e-mail: fixture (local Postgres 16, never run against a lane)

**Base.** `n4_stg` copied twice: `n200_stg` (`p32.lane=staging`, `ops_alarm_settings.lane = staging`) and
`n200_prod` (`p32.lane=production`, lane = production). Added stand-ins:
- `html_escape`, the live body from the bootstrap snapshot;
- `profiles`;
- `suppressed_emails`, `email_unsubscribe_tokens` and `email_send_log`, as in `20260322151646_email_infra`;
- an `enqueue_email` that records each payload;
- `auth.users.email`.

| Step | staging-shaped | production-shaped |
|---|---|---|
| PROBE before apply | FAIL | FAIL |
| apply | OK | OK |
| PROBE after apply | PASS ("new screens switch is off, nothing sends") | PASS |

Members: A (Anu), B (weekly summary off), C (not listed), D (suspended), E (address suppressed), F (no activity),
G (named `<b>Evil</b>`). A, B, C, D, E and G each have 7 notifications from the last day; A also has one from 9 days ago.

| Case | Result |
|---|---|
| new screens off | 0 e-mails |
| new screens on for A, B, D, E, F, G | e-mails to **A and G only**. F is recorded as "nothing to report". B (setting off), D (suspended), E (suppressed) and C (not listed) get nothing |
| A's e-mail | "Your week on 50mm Retina World: 2 new followers · 3 likes · 1 comment or mention · 1 competition update." The 9-day-old row is not counted. Link `https://staging.50mmretina.com/notifications`. A `weekly-summary` / `pending` send-log row is written (the e-mail receipt) |
| G's name | escaped in the HTML (`&lt;b&gt;Evil&lt;/b&gt;`) |
| run again the same week | 0 more |
| new screens on for everyone | C now gets one |
| production-shaped | the links are `https://www.50mmretina.com/…` |
| a member runs it | permission denied |
| rollback → PROBE; re-apply → PROBE | job gone, FAIL; PASS |
