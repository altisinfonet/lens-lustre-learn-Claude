# N6 fixture (local Postgres 16)

Base: N2 fixture + `app_role`, `user_roles`, `has_role`, `profiles`, and an
`auth.uid()` that reads `request.jwt.claim.sub` (an admin session is simulated
by setting it).

| Step | Result |
|---|---|
| PROBE 0120 before apply | FAIL — `notification_centre_changes missing` (expected) |
| apply (after 0110) | OK |
| PROBE 0120 after apply | PASS — 8 functions, 7 of 7 refused a caller with no admin role |
| rollback → PROBE | FAIL again (expected) → re-apply → PASS |

Behaviour (admin session unless noted): a non-admin is refused (`admin only`);
49 types listed; `post_reaction` edit records two history rows with the
admin's name; changing `audience` is refused; all 8 switches read Off; "Only
me" turns likes & comments on for the admin and not for another member;
"Chosen members" on for a listed member; admin alerts refuse "Only me";
"Everyone" on the screens switch stores `"on"`; "Off" deletes the row; 3
switch history rows; member lookup returns settings / quiet hours / block
counts; "Send a test to me" writes one bell row to the admin and one log row;
a second test within a minute is refused.

UI (`AdminNotificationCentre.test.tsx`): 7 tests — failed first (component
absent), pass now.
