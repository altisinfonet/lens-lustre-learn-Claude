N0 COMPLETE

# Notification centre runner — status

Heartbeat: 2026-10-31 16:35 UTC (measured) — N1 staging VERIFIED (FAIL 41216994890 → apply 41218922667 → PASS 41219638033, 16:31, 10/10 equal). Carry #778 MERGED to main b4b05b8 (N0 map, N7 settings, N6 admin page + SQL 0120, N4 push builder, feed focus fix, N1 capture); live build b4b05b8: home/feed/notifications 200, same text, console 4/2/2 = baseline (Chromium), three-engine workflow dispatched. MERGED to staging: #775 tabs (128d558), #777 receipts (8ad8884), #774 N5 nightly (4527b1d). Staging now: N4 0160 PROBE (expect FAIL) run 41220309779; then 0160 apply → PASS; then 0130. Production: N3 PASS probe waits for the production lane (other runners busy), then N6 0120 and N1 0150. Reviews caught and I fixed: CI typecheck error in quiet hours (I had used a narrower tsc config — now always tsc -b), 'You won!' wrong for runner-up awards, admin 'on for everyone' label inaccurate (#785), guide claim about 'On' (#783). Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748; carry #759; map #765 (merged 0fffef3) | staging d4aa554 / main 832863d | staging 41202968098 PASS 13:19; production 41206791083 PASS 13:49 | live check 13:46 Chromium: same as baseline | 100 ✅ |
| N1 | Capture live-only pieces into git | #766; carry #778 | staging 0abac4e / main b4b05b8 | staging: FAIL 41216994890 → apply 41218922667 → PASS 41219638033 (16:31); production next | — | 85 |
| N2 | Centre, switch OFF, 24 h shadow | #754; carry #759 | staging 6c2f4c8 / main 832863d | staging: FAIL 41205948948 → apply 41206399056 → PASS 41206575315 (13:41); production: FAIL 41208395319 → apply 41210622019 (14:44) → PASS 41211534028 (14:51) | 24 h shadow running until ~14:44 UTC 1 Nov | 75 |
| N3 | Move makers onto the centre, by group | #760; carry #770 | staging ef4eed9 / main c36374b | staging: FAIL 41207874341 → apply 41209816765 → PASS 41211568429; production: FAIL 41215290658 → apply 41215600877 (15:44) → PASS pending | live 15:47 Chromium = baseline | 75 |
| N4 | Delivery (push + e-mail queue, receipts) | #757 (main b4b05b8); #777 receipts (staging 8ad8884); #780 push follows centre | staging 39134ef, 8ad8884 / main b4b05b8 | staging 0160: PROBE 41220309779 running | — | 60 |
| N5 | Guard (CI stray-insert test + nightly count) | #752 (main); #774 nightly (staging 4527b1d) | staging 0ad80af, 4527b1d / main c36374b | staging 0130 next | — | 80 |
| N6 | Admin Notification Centre page | #764 (main b4b05b8); #785 label fix | staging 11e5d18 / main b4b05b8 | staging: FAIL → apply → PASS 41216460747; production next | live 16:27 = baseline | 80 |
| N7 | Member screens | #755, #762 (main), #773 (main), #775 (staging), #779, #781, #782 open | staging 2d295e1, cd2b6ac, ac1f5fa, 128d558 / main b4b05b8 | 0180 with #781 | live 16:27 = baseline | 80 |
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
