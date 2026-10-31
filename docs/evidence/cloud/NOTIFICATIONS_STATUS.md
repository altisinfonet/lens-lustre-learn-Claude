N0 COMPLETE

# Notification centre runner — status

Heartbeat: 2026-10-31 18:42 UTC (measured) — Production N6: FAIL 41223352518 → apply 0120 OK 41225000305 (18:16) → PASS probe dispatched. Staging N5 0130: PROBE FAIL 41227868353 (18:28, expected) → apply waits for the staging lane (another runner busy). Live build c4d95f5 (includes carry #793): home/feed/notifications 200, console 4/2/2 = baseline, both loads same (Chromium); three-engine workflow dispatched. MERGED to staging: #796 announcement headline (80db2c1). #795 fixed after CI caught missing explicit grants (S11 M2) — re-running. CI: #787, #795. Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748; carry #759; map #765 (merged 0fffef3) | staging d4aa554 / main 832863d | staging 41202968098 PASS 13:19; production 41206791083 PASS 13:49 | live check 13:46 Chromium: same as baseline | 100 ✅ |
| N1 | Capture live-only pieces into git | #766; carry #778 | staging 0abac4e / main b4b05b8 | staging: FAIL 41216994890 → apply 41218922667 → PASS 41219638033 (16:31); production next | — | 85 |
| N2 | Centre, switch OFF, 24 h shadow | #754; carry #759 | staging 6c2f4c8 / main 832863d | staging: FAIL 41205948948 → apply 41206399056 → PASS 41206575315 (13:41); production: FAIL 41208395319 → apply 41210622019 (14:44) → PASS 41211534028 (14:51) | 24 h shadow running until ~14:44 UTC 1 Nov | 75 |
| N3 | Move makers onto the centre, by group | #760; carry #770 | staging ef4eed9 / main c36374b | staging VERIFIED; production: FAIL 41215290658 → apply 41215600877 → PASS 41221752484 (17:09) | live 15:47, 16:27 = baseline | 90 |
| N4 | Delivery (push + e-mail queue, receipts) | #757 (main), #777 #780 (main c4d95f5), #789 #790 #791 (staging) | staging 8ad8884, 7b827c2, c4fdbaf, 149adad, 8c768bc / main c4d95f5 | staging 0160 VERIFIED (PASS 41224537603, 18:06) | — | 85 |
| N5 | Guard (CI stray-insert test + nightly count) | #752 (main); #774 nightly (staging 4527b1d) | staging 0ad80af, 4527b1d / main c36374b | staging 0130 next | — | 80 |
| N6 | Admin Notification Centre page | #764 (main), #785 (staging; carry #793), #792 announce (open) | staging 11e5d18, 38e992e / main b4b05b8 | staging VERIFIED (PASS 41216460747); production PROBE 41223352518 queued | — | 85 |
| N7 | Member screens | merged: #755 #762 #773 #775 #782; open: #779 #781 #786 #787 | staging …, 128d558, 6b549e0 / main b4b05b8 | 0180 (#781), 0190 (#786) after merge | live 16:27 = baseline | 85 |
| N8 | Staged rollout steps for the Owner | #783 (guide; reviews nothing blocking after fixes) | — | — | — | 60 |

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

- 15:41 UTC slip: dispatched the N6 staging PROBE while another runner's run (41215528115) was queued on staging. I misread the list. Cancelled mine (41216070519) within 30 s; theirs stayed queued, untouched. Dispatches now wait for the lane-quiet script only.

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
