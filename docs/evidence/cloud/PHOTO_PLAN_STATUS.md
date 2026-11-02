**Smart photo plan runner: status** (file: `docs/evidence/cloud/PHOTO_PLAN_STATUS.md`; never merge this PR)

Last update: 2026-11-02 15:18 UTC (local runner, resumed run)

| Unit | PRs | Merged (staging / main) | SQL / workflow runs (UTC) | Live check | % |
|---|---|---|---|---|---|
| U0 measure | #820 · carry #822 | 8cf88d4f / dd8209e6 | read-only, 40 live photos 10:34 | ✓ (with #822) | 100 |
| U1a camera details (DB) | #821 · carry #822 | 33692afb / dd8209e6 | **staging:** PROBE 41435125694 FAIL A1 (expected) 11:15 · apply 41444038665 ✓ 12:22 · PROBE 41444176542 **PASS** 12:22 · **production:** PROBE 41453960303 FAIL A1 (expected) 13:33 · apply 41454507922 ✓ 13:37 · PROBE 41454710509 **PASS** 13:38 (photo_set_v2 = off, 0 rows) | d2-live-check 41462810560 on dd8209e6 14:34: Chromium/Firefox/WebKit, home + /feed + /notifications 200 with text, same text both loads; console lines identical to the 1 Nov check 41339223796 (9 = 9, 0 new) | 100 |
| U1b upload path (client) | #823 · pin #826 | 932271d5 / — | function `detect-orphan-files` deploy 41454742939 refused (verify_jwt not pinned) → #826 pins the live value `true` (staging 41454742939, production 41462864810) | — | 75 |
| U2 display | #825 | e71c59fb / — | — | — | 70 |
| U3 download removal | #827 (CI green, in review) | — | — | — | 50 |
| U4 save mobile data | — | — | — | — | 0 |
| U5 backfill | — | — | — | — | 0 |
| U6 competition auto-delete | — | — | — | — | 0 |
| U7 delete old big files | — | — | — | — | 0 |
| App bump | — | — | — | — | 0 |

**What each merged unit does (all behind switch `photo_set_v2`, OFF on both lanes):**
- U1b: new post photos stored as WebP 2048 (with "© name, 50mm Retina World") / 1080 / 600 / 320 under marker `-l4`; competition keeps full size + `-l4f` copies; camera details (7 keys, never GPS, no timezone offset) saved after the post; a failure never blocks the post. Independent review: nothing blocking.
- U2: camera line (app feed), ⓘ bottom sheet (app full screen), slide-open strip (web), no-EXIF states, owner Hide/Show; 320 copies in profile/wall grids, My Photos, notification thumbnails; blur placeholder; WebP-encoder check. Independent review: nothing blocking.

**U0 result (true saving, measured on live, 40 public photos):** stored per photo 1,028 KB → 537 KB (−47.7 %); full-screen open 735 → 357 KB (−51.4 %); grid tile 37 → 12 KB (−66.8 %). Lower than the 85–90 % first estimate because posts never kept camera originals (today's "original" is already a 2560 px WebP q0.92). Evidence: `docs/evidence/photo-plan/U0/`.

**Why run 41435125694 failed:** not a dispatch problem (it ran on `staging` for target staging; branch check passed). It was the PROBE *before* the apply and failed as designed: `PROBE FAIL A1 … (0100 not applied)`.

**Known follow-ups (recorded, not blocking):** feed srcset for `-l4` photos should include the 1080 copy (U3 helper finding; fix in U4 PR); MyPhotos / notification 320 tiles need an onError fallback; arrow keys move the viewer behind an open ⓘ sheet.

Every new behaviour ships behind a switch that is OFF on live. I never switch anything on.

**Owner list (plain words)**
_Nothing needed yet._ (The switch-on steps come at the end, after the old photos are converted.)
