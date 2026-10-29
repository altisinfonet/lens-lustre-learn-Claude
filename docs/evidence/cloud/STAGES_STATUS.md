# STAGES runner — status

Updated: 2026-10-29 17:50 UTC · runner branch `status/stages-runner` · never merged.

## Done per stage

| Stage | % | State |
|---|---|---|
| S0 | 95 | Server half PASS, re-checked live today. Only the Owner's phone test ("Video OK") is left. |
| S2 Observability | 80 | Live: telemetry SQL (prod run 40748803628, PROBE PASS 40748916102), client telemetry, outside monitor + alert, Admin → Health page. Open: native crash / OOM / ANR per build — PR #552 (CI + review). |
| S3 Media | 60 | Not started by this runner yet (merged + staging-applied before). |
| S8 Live debt | 40 | Not started by this runner yet. |
| S11 Reliability | 0 | Not started. |
| S10 remainder | 0 | Waits for PR #538 (supervisor). |
| S12 / S5 | — | Confirm only (switches stay OFF). |
| S9 Release | 0 | Last. |

## Units

| Stage | Unit | PR | Merged staging / main | SQL runs | Live check |
|---|---|---|---|---|---|
| S0 | Live video config answers the app | — | — | — | 2026-10-29 17:16 UTC: `/config/site-settings` 200 (video_conversion = "device"); OPTIONS `/config/site-settings` and `/api/video/play-token` with Origin `https://localhost` → 204 + ACAO `https://localhost`; POST play-token with no id → 400 VID-REQ-002 (correct refusal). PASS |
| S2 | Native crash / OOM / ANR per build | #552 | open | to run after merge | — |

## Owner list (plain words, click-only)

1. **S0 phone test.** On your phone open the 50mm Retina app, open the feed, scroll to any video, let it play with sound. If it plays, reply "Video OK".
