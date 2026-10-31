N0 IN PROGRESS

# Notification centre runner — status

Heartbeat: 2026-10-31 12:05 UTC — N0 PROBE #748 in review round 4 (rounds 1–3 each found a way the public CI log could show a secret or personal data; final design prints no function source at all). N5 guard #752 in review round 2. Branch for status only; never merged.

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
- N2 shadow on production will be a READ-ONLY replay PROBE over the 24 h after
  N2 is applied (the centre's decision is computed for every real row from that
  window and compared) — nothing new runs or is switched on in production.
- `emit_notification` is defined in git in more than the UNAPPLIED snapshot
  (also `20260424093600_*` and `20260522051954_*`); N0 compares the live body
  with each.

## Owner list (plain words)
1. (none yet)
