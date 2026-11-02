**Smart photo plan runner: status** (file: `docs/evidence/cloud/PHOTO_PLAN_STATUS.md`; never merge this PR)

Last update: 2026-11-02 18:56 UTC (local runner, third run — stopped after the carry + live check; U5 next)

| Unit | PRs | Merged (staging / main) | SQL / workflow runs (UTC) | Live check | % |
|---|---|---|---|---|---|
| U0 measure | #820 · carry #822 | 8cf88d4f / dd8209e6 | read-only, 40 live photos 10:34 | ✓ (with #822) | 100 |
| U1a camera details (DB) | #821 · carry #822 | 33692afb / dd8209e6 | **staging:** PROBE 41435125694 FAIL A1 (expected) 11:15 · apply 41444038665 ✓ 12:22 · PROBE 41444176542 **PASS** 12:22 · **production:** PROBE 41453960303 FAIL A1 (expected) 13:33 · apply 41454507922 ✓ 13:37 · PROBE 41454710509 **PASS** 13:38 (photo_set_v2 = off, 0 rows) | 41462810560 (14:34) ✓ | 100 |
| U1b upload path (client) | #823 · #826 · #828 · carry #831 | 932271d5 + 7a79a9a5 + d560e4bf / c723e498 | `detect-orphan-files`: staging 41490540929 refused 17:22 (Supabase CLI v3.0.0, released 12:18 UTC, now asks before deploying; nothing changed) → #828 adds `--yes` → **staging 41501021698 ✓ 18:32 (version 5, verify_jwt true)** → **production 41504182315 ✓ 18:50 (version 33, verify_jwt true)** | 41504451476 ✓ | 100 (code + function live, switch OFF) |
| U2 display | #825 · #829 · carry #831 | e71c59fb + 0e2cf81f / c723e498 | no SQL. #829: the switch-OFF snapshots held age-based reach figures, stale from 15:32 UTC (every PR's unit tests red, e.g. 41491197888); fixed clock in that test, snapshots unchanged | 41504451476 ✓ | 100 (switch OFF) |
| U3 download removal | #827 · carry #831 | 67f9a389 / c723e498 | no SQL | 41504451476 ✓ | 100 (switch OFF) |
| U4 save mobile data + review follow-ups | #830 · carry #831 | 492aa191 / c723e498 | no SQL | 41504451476 ✓ | 100 (switch OFF) |
| U5 backfill | — | — | — | — | 0 (design chosen, see below) |
| U6 competition auto-delete | — | — | — | — | 0 |
| U7 delete old big files | — | — | — | — | 0 (waits for the Owner, see list) |
| App bump | — | — | — | — | 0 |

**Live check 41504451476 (18:51 UTC, main c723e498, live bundle confirmed to contain the U4 code before the check):** Chromium / Firefox / WebKit — `/`, `/feed`, `/notifications` all 200 with text, same text on both loads; console lines identical to the 2 Nov 14:34 check 41462810560 (9 = 9, **0 new**).

**What each unit does (all behind switch `photo_set_v2`, OFF on both lanes):**
- U1b: new post photos stored as WebP 2048 (with "© name, 50mm Retina World") / 1080 / 600 / 320 under marker `-l4`; competition keeps full size + `-l4f` copies; camera details (7 keys, never GPS) saved after the post. Review: nothing blocking.
- U2: camera line (app feed), ⓘ sheet (app full screen), slide-open strip (web), no-EXIF states, owner Hide/Show; 320 copies in grids; blur placeholder. Review: nothing blocking.
- U3: no member download anywhere; admin/judge keep it on competition entries (web only); full screen = credited 2048; app long-press save off. Review: nothing blocking.
- U4: "Save mobile data" (Edit profile, kept on this device): on mobile data photos one size down (feed 600, full screen 1080, inline 600); videos start 720p on Wi-Fi, 480p on mobile data, 240p (cap 480p) with Save mobile data, 240p-only on a slow network (as today). Review follow-ups: (1) feed shows 600 + 1080, never the 2048 — done; (2) My Photos / notification 320 tiles fall back if the 320 is missing (to the credited 2048, never a competition full size) — done; (3) "arrow keys move the viewer behind the ⓘ sheet" — tested first: **not a bug** (test passes on the old code); no fix shipped, test kept; (4) the hashtag page's full screen had no ⓘ — added (app). Review: nothing blocking. 34 new tests, 24 seen failing first.

**Known limits (recorded):** iPhone / desktop browsers cannot say Wi-Fi vs mobile data: there videos start on 480p (not 720p), and "Save mobile data", if turned on, always saves. The feed photo decides "v2 or not" once per photo appearance (U2 design).

**U0 result (true saving, measured on live, 40 public photos):** stored per photo 1,028 KB → 537 KB (−47.7 %); full-screen open 735 → 357 KB (−51.4 %); grid tile 37 → 12 KB (−66.8 %). Evidence: `docs/evidence/photo-plan/U0/`.

**U5 — design chosen (not started).** The new display code reaches a photo's copies only through the `-l4` URL marker; the S3 backfill tool writes a different ladder (`post-images/<owner>/d/<media>/w600|1080|1440`, only for posts with `post_media` rows). So U5 = (a): a worker writes a `-l4` set (credited 2048 / 1080 / 600 / 320, never overwriting) beside each old photo through a Pages route that accepts only those sibling keys, then an audited, reversible SQL RPC swaps `posts.image_urls` / `thumbnail_urls` to the new URLs only when every sibling exists. Covers legacy posts too, and is what U7 needs ("the live site reads only new copies"). Old apps keep working (the new URL is a normal WebP). Dry-run + census PROBE per lane, staging first.

**U6 — open question for the build:** "results final" must be read from the live schema (rounds publish results per round; `round_results_published`); to be measured before writing the SQL.

**Not verified, and why:** no phone test with the switch on (the Owner switches); real-network blur/size behaviour measured only in jsdom.

Every new behaviour ships behind a switch that is OFF on live. I never switch anything on.

**Owner list (plain words)**
_Nothing needed yet._ The switch-on steps come at the end, after the old photos are converted (U5). U7 (deleting the old big files) will wait until you have switched the new photos on yourself.
