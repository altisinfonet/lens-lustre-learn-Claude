# N3 gate fixture (local Postgres 16)

Base: N2 fixture + 0110 applied.

| Step | Result |
|---|---|
| PROBE 0140 before apply | FAIL — gate missing (expected) |
| apply | OK |
| PROBE 0140 after apply | PASS — gate on both tables, first BEFORE INSERT trigger, every group switch off |
| rollback → PROBE | FAIL again (expected) |
| apply with a group switch already on | REFUSED (`NC-0140-PRE-003`) |

Behaviour (`likes_comments` switched on for member A only):

| Case | Result |
|---|---|
| switch off, member's own action | row written (today's behaviour) |
| switch on for A, A's own action | **skipped** — log `{self, duplicate}` |
| B reacts twice to the same photo of A within 60 s | first written, second **skipped** — `{duplicate}` |
| member C (not listed), own action | written (today's behaviour) |
| A switched e-mail off for reactions | written with `email_sent = true` (the e-mail trigger skips it) |
| A switched in-app reactions off | **skipped** — `{pref_in_app_off}` |
| unregistered type | written (today's behaviour) |
| centre fault (registry column renamed) | written — a fault never loses a notification |
