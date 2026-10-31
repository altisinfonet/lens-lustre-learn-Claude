N0 IN PROGRESS

# Notification centre runner — status

Heartbeat: 2026-10-31 11:05 UTC — started. Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | — | — | — | — | 5 |
| N1 | Capture live-only pieces into git | — | — | — | — | 0 |
| N2 | Centre, switch OFF, 24 h shadow | — | — | — | — | 0 |
| N3 | Move makers onto the centre, by group | — | — | — | — | 0 |
| N4 | Delivery (push + e-mail queue, receipts) | — | — | — | — | 0 |
| N5 | Guard (CI stray-insert test + nightly count) | — | — | — | — | 0 |
| N6 | Admin Notification Centre page | — | — | — | — | 0 |
| N7 | Member screens | — | — | — | — | 0 |
| N8 | Staged rollout steps for the Owner | — | — | — | — | 0 |

## Notes
- `emit_notification` is defined in git in more than the UNAPPLIED snapshot
  (also `20260424093600_*` and `20260522051954_*`); N0 compares the live body
  with each.

## Owner list (plain words)
1. (none yet)
