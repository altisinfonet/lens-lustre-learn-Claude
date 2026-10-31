# One centre-log row per notification (0230): fixture (local Postgres 16, never run against a lane)

**Base.** The announcement fixture (`n220_stg`, `n220_prod`: centre 0110, admin page 0120, gate 0140,
announcements 0220), copied as `n230_*`. The `announcements` group is on for the admin and M1.

| Case | Result |
|---|---|
| **before 0230** (0110 emit): emit sends to M1 | **2** log rows for 1 notification (the gate's and emit's) |
| PROBE before apply → apply → PROBE | FAIL (md5 b4c9741e…, 0110) → OK → PASS (md5 87714653…) |
| after: emit sends to M1 | **1** log row (the gate's) |
| after: group not live for M2 | emit returns before deciding; no row (as before) |
| after: type switched off, so emit decides "skip" | 1 skip row (emit's; nothing was inserted, so the gate never ran) |
| after: the gate trigger disabled on the table | emit logs the sent row itself (1 row) |
| rollback | md5 back to b4c9741e… (the 0110 body) |
| production-shaped | FAIL → apply → PASS |

`notification_centre_decide` is not touched. The N2 shadow replays decide, so its 24-hour gate is unaffected.

## Review round 1 (not blocking, taken)

The review found two rare paths where the first draft left a sent row with **no** log row:
- a fault inside the gate, which still writes the notification;
- the gate's live check differing from emit's, which needs a hand-edited admin-alerts switch.

Emit now also logs a row it inserted when the gate left no log row for it. Shown with a gate that passes the
row without logging: 1 log row (the earlier draft gave 0). Normal sends stay at 1, and skips at 1.
PROBE and rollback re-pinned (md5 87714653…).
