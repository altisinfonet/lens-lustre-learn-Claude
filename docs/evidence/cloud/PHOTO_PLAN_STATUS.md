**Smart photo plan runner: status** (file: `docs/evidence/cloud/PHOTO_PLAN_STATUS.md`; never merge this PR)

Last update: 2026-11-02 18:20 UTC (local runner, third run, resumed after the Owner pause at 15:25)

| Unit | PRs | Merged (staging / main) | SQL / workflow runs (UTC) | Live check | % |
|---|---|---|---|---|---|
| U0 measure | #820 · carry #822 | 8cf88d4f / dd8209e6 | read-only, 40 live photos 10:34 | ✓ (with #822) | 100 |
| U1a camera details (DB) | #821 · carry #822 | 33692afb / dd8209e6 | **staging:** PROBE 41435125694 FAIL A1 (expected) 11:15 · apply 41444038665 ✓ 12:22 · PROBE 41444176542 **PASS** 12:22 · **production:** PROBE 41453960303 FAIL A1 (expected) 13:33 · apply 41454507922 ✓ 13:37 · PROBE 41454710509 **PASS** 13:38 (photo_set_v2 = off, 0 rows) | d2-live-check 41462810560 on dd8209e6 14:34: Chromium/Firefox/WebKit, home + /feed + /notifications 200 with text, same text both loads; console lines identical to the 1 Nov check 41339223796 (9 = 9, 0 new) | 100 |
| U1b upload path (client) | #823 · pin #826 · deploy fix #828 | 932271d5 + 7a79a9a5 (#826, 17:21) / — | `detect-orphan-files` staging deploy 41490540929 (17:22) **refused**: Supabase CLI v3.0.0 (released 12:18 UTC today, installed by `setup-cli` `latest`) now asks "Deploy 1 Function?" and cannot ask in CI; nothing changed. Fix #828 adds `--yes` (the workflow already confirms: functions == confirm, lane-guarded). #826's earlier red check = VID-1 attempt 1, runner apt hang (infrastructure), attempt 2 green | — | 85 |
| U2 display | #825 · test clock #829 | e71c59fb + 0e2cf81f (#829) / — | no SQL. **#829:** the U2 switch-OFF snapshots contain reach figures that grow with the post's age; they were stale from 15:32 UTC, so every PR's "Unit tests" check went red (e.g. 41491197888). Fixed clock in that test only (snapshots unchanged) | — | 90 |
| U3 download removal | #827 | 67f9a389 / — | no SQL | — | 90 |
| U4 save mobile data + review follow-ups | #830 (CI re-running after #829) | — | no SQL | — | 80 |
| U5 backfill | — | — | — | — | 0 |
| U6 competition auto-delete | — | — | — | — | 0 |
| U7 delete old big files | — | — | — | — | 0 (waits for the Owner, see list) |
| App bump | — | — | — | — | 0 |

**What each unit does (all behind switch `photo_set_v2`, OFF on both lanes):**
- U1b: new post photos stored as WebP 2048 (with "© name, 50mm Retina World") / 1080 / 600 / 320 under marker `-l4`; competition keeps full size + `-l4f` copies; camera details (7 keys, never GPS) saved after the post. Review: nothing blocking.
- U2: camera line (app feed), ⓘ sheet (app full screen), slide-open strip (web), no-EXIF states, owner Hide/Show; 320 copies in grids; blur placeholder. Review: nothing blocking.
- U3: no member download anywhere; admin/judge keep it on competition entries (web only); full screen = credited 2048; app long-press save off. Review: nothing blocking.
- U4 (#830): "Save mobile data" (Edit profile, kept on this device): on mobile data photos one size down (feed 600, full screen 1080, inline 600); videos start 720p on Wi-Fi, 480p on mobile data, 240p (cap 480p) with Save mobile data, 240p-only on a slow network (as today). Review follow-ups: (1) feed shows 600 + 1080, never the 2048 — done; (2) My Photos / notification 320 tiles fall back if the 320 is missing (to the credited 2048, never a competition full size) — done; (3) "arrow keys move the viewer behind the ⓘ sheet" — checked with a test first: **not a bug** (the test passes on the old code), no fix shipped, test kept as a lock; (4) the hashtag page's full screen had no ⓘ — added (app). Review of #830: nothing blocking. 33 + 1 new tests, 24 seen failing first.

**Known limits (recorded):** iPhone / desktop browsers cannot say Wi-Fi vs mobile data: there videos start on 480p (not 720p), and "Save mobile data", if turned on, always saves. The feed photo decides "v2 or not" once per photo appearance (U2 design).

**U0 result (true saving, measured on live, 40 public photos):** stored per photo 1,028 KB → 537 KB (−47.7 %); full-screen open 735 → 357 KB (−51.4 %); grid tile 37 → 12 KB (−66.8 %). Evidence: `docs/evidence/photo-plan/U0/`.

**Next (in order):** merge #828 + #830 → staging deploy of `detect-orphan-files` → carry U1b + #826 + U2 + U3 + #828 + #829 + U4 to main (one cherry-pick PR; trial pick of the first four onto origin/main is conflict-free) → production deploy of `detect-orphan-files` → live check (Chromium/Firefox/WebKit). Then U5, U6, U7 (last), app bump.

**U5 design question found while scoping (not started):** existing photos are only reachable to the new display code through the `-l4` URL marker, but the S3 backfill tool writes a different ladder (`post-images/<owner>/d/<media>/w600|1080|1440`, only for posts with `post_media` rows, read through `media_ladder_feed`). So U5 must either (a) write `-l4` sibling sets beside each old photo and swap `posts.image_urls`/`thumbnail_urls` to them through an audited, reversible SQL RPC, or (b) teach the v2 display to read the S3 ladder (+ add 320 and credited 2048 rungs to it). (a) also covers legacy posts without `post_media` and is what U7 needs ("the live site reads only new copies"). Planned: (a), with dry-run + census PROBE per lane.

Every new behaviour ships behind a switch that is OFF on live. I never switch anything on.

**Owner list (plain words)**
_Nothing needed yet._ (The switch-on steps come at the end, after the old photos are converted.)
