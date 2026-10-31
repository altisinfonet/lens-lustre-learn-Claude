N0 COMPLETE

# Notification centre runner — status

Heartbeat: 2026-10-31 15:39 UTC (measured) — Carry #770 (N7 rows, N5 CI guard, N3 gate SQL, live-check) MERGED to main c36374b after rerun green (P23 flake root-caused: CategoryStrip.tsx re-mounted chips; fix PR #773) and independent review. Production N3: PROBE FAIL 41215290658 (15:33, expected) → apply 41215600877 running. N6 staging: PROBE FAIL 41214915432 (15:31, expected) → apply 41215352352 running. New PRs: #774 N5 nightly live stray count (review nothing blocking), #775 N7 tabs (review blocker fixed, re-review running). #766 N1 rebased (conflict in guard allow-list only), CI running. Branch for status only; never merged.

| Step | What | PR | Merged sha (staging / main) | SQL runs (lane · run id · result · UTC) | Live check | % |
|---|---|---|---|---|---|---|
| N0 | Measure (read-only map) | #748; carry #759; map #765 (merged 0fffef3) | staging d4aa554 / main 832863d | staging 41202968098 PASS 13:19; production 41206791083 PASS 13:49 | live check 13:46 Chromium: same as baseline | 100 ✅ |
| N1 | Capture live-only pieces into git | #766 | — | — | — | 40 |
| N2 | Centre, switch OFF, 24 h shadow | #754; carry #759 | staging 6c2f4c8 / main 832863d | staging: FAIL 41205948948 → apply 41206399056 → PASS 41206575315 (13:41); production: FAIL 41208395319 → apply 41210622019 (14:44) → PASS 41211534028 (14:51) | 24 h shadow running until ~14:44 UTC 1 Nov | 75 |
| N3 | Move makers onto the centre, by group | #760 (centre gate); carry #770 | staging ef4eed9 / main c36374b | staging: FAIL 41207874341 → apply 41209816765 → PASS 41211568429; production: FAIL 41215290658 (15:33) → apply 41215600877 (running) | live check after deploy: pending | 65 |
| N4 | Delivery (push + e-mail queue, receipts) | #757 (part 1: push builder) | — | — | — | 10 |
| N5 | Guard (CI stray-insert test + nightly count) | #752 CI guard (carry #770); #774 nightly count | staging 0ad80af / main c36374b | — | — | 70 |
| N6 | Admin Notification Centre page | #764 | staging 11e5d18 | staging: FAIL 41214915432 (15:31) → apply 41215352352 (running) | — | 60 |
| N7 | Member screens | #755 rows (carry #770), #762 settings table, #775 tabs, #773 feed focus fix | staging 2d295e1, cd2b6ac / main c36374b | — | — | 62 |
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
