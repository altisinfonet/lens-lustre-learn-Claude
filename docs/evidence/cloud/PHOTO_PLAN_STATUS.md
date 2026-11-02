**Smart photo plan runner: status** (file: `docs/evidence/cloud/PHOTO_PLAN_STATUS.md`; never merge this PR)

Last update: 2026-11-02 12:25 UTC (local runner, resumed run)

| Unit | PRs | Merged (staging / main) | SQL / workflow runs | Live check | % |
|---|---|---|---|---|---|
| U0 measure | #820 | 8cf88d4f / — | read-only, 40 live photos 10:34 UTC | n/a (docs only) | 100 |
| U1a camera details (DB) | #821 | 33692afb / — | staging: PROBE before 41435125694 FAIL A1 (expected, objects missing) · apply 41444038665 success 12:22Z · PROBE after 41444176542 PASS 12:22Z · production: waits for carry to main | — | 60 |
| U1b upload path (client) | — | — | — | — | 0 |
| U2 display | — | — | — | — | 0 |
| U3 download removal | — | — | — | — | 0 |
| U4 save mobile data | — | — | — | — | 0 |
| U5 backfill | — | — | — | — | 0 |
| U6 competition auto-delete | — | — | — | — | 0 |
| U7 delete old big files | — | — | — | — | 0 |
| App bump | — | — | — | — | 0 |

**U0 result (true saving, measured on live, 40 public photos):** stored per photo 1,028 KB → 537 KB (−47.7 %); full-screen open 735 → 357 KB (−51.4 %); grid tile 37 → 12 KB (−66.8 %). Lower than the 85–90 % first estimate because posts never kept camera originals (today's "original" is already a 2560 px WebP q0.92). Evidence: `docs/evidence/photo-plan/U0/`.

**Why run 41435125694 failed:** not a dispatch problem (it ran on `staging` for target staging, branch check passed). It was the PROBE run *before* the apply, and it failed exactly as designed: `PROBE FAIL A1: post_photo_camera / post_photo_camera_hidden missing (0100 not applied)`.

Every new behaviour ships behind a switch that is OFF on live. I never switch anything on.

**Owner list (plain words)**
_Nothing needed yet._
