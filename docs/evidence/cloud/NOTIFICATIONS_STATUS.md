N0 IN PROGRESS

# Notification centre runner — status

Heartbeat: 2026-10-31 11:26 UTC (measured with `date -u`) — N0 PROBE #748: review nothing blocking after 4 rounds, waiting on CI (repo-wide runner queue ~280; I cancelled my own 108 superseded runs). N5 guard #752: review nothing blocking, final one-line confirm pending. N2 core drafted and passing 24 local fixture cases. Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748 (PROBE 0100) | — | — | — | 20 |
| N1 | Capture live-only pieces into git | — | — | — | — | 0 |
| N2 | Centre, switch OFF, 24 h shadow | — | — | — | — | 0 |
| N3 | Move makers onto the centre, by group | — | — | — | — | 0 |
| N4 | Delivery (push + e-mail queue, receipts) | — | — | — | — | 0 |
| N5 | Guard (CI stray-insert test + nightly count) | #752 (CI guard, part 1) | — | — | — | 30 |
| N6 | Admin Notification Centre page | — | — | — | — | 0 |
| N7 | Member screens | — | — | — | — | 0 |
| N8 | Staged rollout steps for the Owner | — | — | — | — | 0 |

## Notes
- CORRECTION: the two earlier heartbeats on this branch were stamped 11:40 and
  12:05 UTC; those times were estimated, not measured, and were wrong (the
  real clock was earlier). Every time from here is read from the clock.
- N2 shadow on production will be a READ-ONLY replay PROBE over the 24 h after
  N2 is applied (the centre's decision is computed for every real row from that
  window and compared) — nothing new runs or is switched on in production.
- `emit_notification` is defined in git in more than the UNAPPLIED snapshot
  (also `20260424093600_*` and `20260522051954_*`); N0 compares the live body
  with each.

## Owner list (plain words)
1. (none yet)
