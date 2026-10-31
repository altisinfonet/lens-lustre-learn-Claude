N0 COMPLETE

# Notification centre runner — status

Heartbeat: 2026-10-31 16:15 UTC (measured) — GitHub runner pool saturated (~90 queued runs repo-wide), so applies and CI wait. N1 staging: PROBE FAIL 41216994890 (16:11, expected) → apply next when the lane is quiet. Production N3: PASS probe still waits for the production lane (other runners keep it busy). Three-engine live check on main 41216517578: all 9 page loads 200 with text, console messages identical to the 14:15 run. New PRs since last beat: #779 N7 app headlines + big-moment cards, #780 N4 push follows the centre (quiet hours, every type; review caught and I fixed a dropped new-posts opt-out before any switch is on), #781 N7 quiet hours (SQL 0180 + settings row), #782 settings-table fix (new-posts phone switch, dropped in #762 on a wrong premise). All behind switches that are OFF. Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748; carry #759; map #765 (merged 0fffef3) | staging d4aa554 / main 832863d | staging 41202968098 PASS 13:19; production 41206791083 PASS 13:49 | live check 13:46 Chromium: same as baseline | 100 ✅ |
| N1 | Capture live-only pieces into git | #766; carry #778 | staging 0abac4e | staging: FAIL 41216994890 (16:11) → apply next | — | 75 |
| N2 | Centre, switch OFF, 24 h shadow | #754; carry #759 | staging 6c2f4c8 / main 832863d | staging: FAIL 41205948948 → apply 41206399056 → PASS 41206575315 (13:41); production: FAIL 41208395319 → apply 41210622019 (14:44) → PASS 41211534028 (14:51) | 24 h shadow running until ~14:44 UTC 1 Nov | 75 |
| N3 | Move makers onto the centre, by group | #760; carry #770 | staging ef4eed9 / main c36374b | staging: FAIL 41207874341 → apply 41209816765 → PASS 41211568429; production: FAIL 41215290658 → apply 41215600877 (15:44) → PASS pending | live 15:47 Chromium = baseline | 75 |
| N4 | Delivery (push + e-mail queue, receipts) | #757 builder (carry #778); #777 receipts + alarm; #780 push follows centre | staging 39134ef | — | — | 55 |
| N5 | Guard (CI stray-insert test + nightly count) | #752 CI guard (carry #770); #774 nightly count | staging 0ad80af / main c36374b | — | — | 70 |
| N6 | Admin Notification Centre page | #764; carry #778 | staging 11e5d18 | staging: FAIL 41214915432 → apply 41215352352 → PASS 41216460747 (15:51) | — | 75 |
| N7 | Member screens | #755 (main), #762, #773, #775 tabs, #779 headlines/cards, #781 quiet hours, #782 new-posts switch | staging 2d295e1, cd2b6ac, ac1f5fa / main c36374b | — | — | 75 |
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
