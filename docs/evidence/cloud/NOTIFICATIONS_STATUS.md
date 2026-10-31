N0 IN PROGRESS

# Notification centre runner — status

Heartbeat: 2026-10-31 12:52 UTC (measured) — MERGED to staging: #748 N0 PROBE (d4aa554), #754 N2 centre (6c2f4c8). Staging PROBE 0100 dispatched (run 41202972066). Carry #759 (N0+N2 → main) reviewed nothing blocking, CI queued. #760 N3 centre gate opened (in review). #752 N5 re-running CI after allow-listing the centre (guard flagged it first). Nothing applied as a migration yet; no switch on. Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748; carry #759 | staging d4aa554 | staging 41202972066 (running) | — | 55 |
| N1 | Capture live-only pieces into git | — | — | — | — | 0 |
| N2 | Centre, switch OFF, 24 h shadow | #754; carry #759 | staging 6c2f4c8 | — | — | 45 |
| N3 | Move makers onto the centre, by group | #760 (centre gate) | — | — | — | 30 |
| N4 | Delivery (push + e-mail queue, receipts) | #757 (part 1: push builder) | — | — | — | 10 |
| N5 | Guard (CI stray-insert test + nightly count) | #752 (CI guard); part 2 local | — | — | — | 45 |
| N6 | Admin Notification Centre page | (local, stacked on #754) | — | — | — | 25 |
| N7 | Member screens | #755 (rows, page + bell); part 2 settings table local | — | — | — | 35 |
| N8 | Staged rollout steps for the Owner | (draft) | — | — | — | 15 |

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
1. **Let the robot publish server code (edge functions).** In GitHub → Settings →
   Environments → `staging` and `production` → add a secret named
   `SUPABASE_ACCESS_TOKEN` (made in Supabase → Account → Access Tokens). Until
   then the new push code (#757) is ready but cannot be published.
2. **Decide about the 4 "In-app" switches in Notification Settings.** Today
   they save but nothing reads them (members turn them off and still get those
   notifications). The new notification centre will obey them once you switch
   a group on (see the step list that will be in Admin → Notification Centre).
   Nothing to click yet — just know that switching a group on makes them work.
