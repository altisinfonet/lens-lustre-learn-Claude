N0 COMPLETE

# Notification centre runner — status

Heartbeat: 2026-10-31 17:13 UTC (measured) — N3 PRODUCTION VERIFIED: PROBE PASS 41221752484 (17:09; gate first on both tables, 0 group switches on → today's output unchanged). Production N6 0120 PROBE (expect FAIL) dispatched 41223352518; staging N4 0160 apply 41221982432 queued. Runner pool ~250 queued repo-wide; I cancelled 64 of my own superseded CI runs to help. MERGED to staging: #781 quiet hours (aa27195), #785 admin label (38e992e). Carry #793 to main (7 units) — review nothing blocking, CI queued. New PRs: #790 push retry, #791 push picture (review caught a privacy leak — a private post's picture could reach a tagged member; reproduced on the fixture and fixed with the bell's rule), #792 admin announcement to a chosen group (SQL 0220; fixture caught the centre's self rule skipping the admin's own copy, fixed). Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748; carry #759; map #765 (merged 0fffef3) | staging d4aa554 / main 832863d | staging 41202968098 PASS 13:19; production 41206791083 PASS 13:49 | live check 13:46 Chromium: same as baseline | 100 ✅ |
| N1 | Capture live-only pieces into git | #766; carry #778 | staging 0abac4e / main b4b05b8 | staging: FAIL 41216994890 → apply 41218922667 → PASS 41219638033 (16:31); production next | — | 85 |
| N2 | Centre, switch OFF, 24 h shadow | #754; carry #759 | staging 6c2f4c8 / main 832863d | staging: FAIL 41205948948 → apply 41206399056 → PASS 41206575315 (13:41); production: FAIL 41208395319 → apply 41210622019 (14:44) → PASS 41211534028 (14:51) | 24 h shadow running until ~14:44 UTC 1 Nov | 75 |
| N3 | Move makers onto the centre, by group | #760; carry #770 | staging ef4eed9 / main c36374b | staging VERIFIED; production: FAIL 41215290658 → apply 41215600877 → PASS 41221752484 (17:09) | live 15:47, 16:27 = baseline | 90 |
| N4 | Delivery (push + e-mail queue, receipts) | #757 (main); #777 #780 (staging; carry #793); #789 weekly summary, #790 retry, #791 picture (open) | staging 39134ef, 8ad8884, 7b827c2 / main b4b05b8 | staging 0160: FAIL 41220309779 → apply 41221982432 queued | — | 80 |
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
