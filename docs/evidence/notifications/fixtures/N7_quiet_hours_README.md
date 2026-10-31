# N7 quiet hours: member functions fixture (local Postgres 16, never run against a lane)

**Base.** The N4 receipts fixture (`n4_stg` with `p32.lane=staging`, `n4_prod` with `p32.lane=production`),
which is the N3 fixture plus `auth.uid()` reading a test setting.

| Step | staging-shaped | production-shaped |
|---|---|---|
| PROBE before apply | FAIL — functions missing (expected) | FAIL — same |
| apply | OK | OK |
| PROBE after apply | PASS | PASS |

| Case (staging-shaped) | Result |
|---|---|
| A sets 22:00–07:00 Asia/Kolkata, then reads it back | saved, and read back exactly |
| B reads | nothing of A's |
| A changes it | one row (upsert), new times |
| start = end; zone "Mars/Olympus"; end missing | all refused, with plain messages |
| signed out | refused ("sign in first") |
| A turns it off (all NULL) | row deleted |
| anon calls get / a member calls get | denied / allowed |
| A's saved hours cover now → centre decision | `channels.push = false` (push held) |
| rollback → PROBE; re-apply → PROBE | FAIL; PASS |

The screen (`src/components/notifications/QuietHoursSetting.tsx`) sits under the settings table and appears only
with `notif_centre_ui` on. It uses the phone's own time zone. A failed save shows an alert and leaves the control
as it was. Tests: `src/components/notifications/__tests__/QuietHoursSetting.test.tsx` and
`src/pages/__tests__/NotificationSettingsCentre.test.tsx`. Push obeys the saved hours for a group switched on
once 0170 (#780) is applied.
