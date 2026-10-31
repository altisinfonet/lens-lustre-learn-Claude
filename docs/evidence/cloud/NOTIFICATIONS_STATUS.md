N0 IN PROGRESS

# Notification centre runner — status

Heartbeat: 2026-10-31 14:52 UTC (measured) — N2 PRODUCTION-APPLIED AND VERIFIED: after-PROBE 41211534028 PASS (14:51; 49 types, switches off, centre log 0). N3 gate STAGING VERIFIED: PROBE PASS 41211568429 (14:47). 24 h production shadow window ends ~14:44 UTC 1 Nov (reminder set for 14:50). Carry #770 (N7 rows, N5 guard, N3 gate SQL, live-check → main) opened, in review. Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748; carry #759; map #765 | staging d4aa554 / main 832863d | staging 41202968098 PASS 13:19; production 41206791083 PASS 13:49 | live check 13:46 Chromium: same as baseline | 90 |
| N1 | Capture live-only pieces into git | #766 | — | — | — | 40 |
| N2 | Centre, switch OFF, 24 h shadow | #754; carry #759 | staging 6c2f4c8 / main 832863d | staging: FAIL 41205948948 → apply 41206399056 → PASS 41206575315 (13:41); production: FAIL 41208395319 → apply 41210622019 (14:44) → PASS 41211534028 (14:51) | 24 h shadow running until ~14:44 UTC 1 Nov | 75 |
| N3 | Move makers onto the centre, by group | #760 (centre gate) | staging ef4eed9 | staging: FAIL 41207874341 → apply 41209816765 (14:44) → PASS 41211568429 (14:47) | — | 50 |
| N4 | Delivery (push + e-mail queue, receipts) | #757 (part 1: push builder) | — | — | — | 10 |
| N5 | Guard (CI stray-insert test + nightly count) | #752 (CI guard); part 2 local | staging 0ad80af | — | — | 55 |
| N6 | Admin Notification Centre page | #764 | — | — | — | 40 |
| N7 | Member screens | #755 (rows) merged; #762 settings table | staging 2d295e1 | — | — | 45 |
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
