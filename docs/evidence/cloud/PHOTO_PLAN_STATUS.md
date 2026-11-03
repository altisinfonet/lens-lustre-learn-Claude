READY v2 (3 Nov 2026, 12:45 UTC). The faults from the Owner's web check are handled and LIVE on main 5dc3fcd4. New Photos = All members (the Owner's choice); nothing else is switched.

| Fault (Owner web check ~11:20Z) | Measured cause | PR (staging / main) | Merged sha (staging / main) | Live check | State |
|---|---|---|---|---|---|
| 1 Credit size / opacity | The file live serves for right-click (post 95717e96 `…-l5-r2048c`, rectify worker / credit-svg) **already has the small credit**: 23 % of the width, alpha 0.41. The old credit: 57 %, alpha 0.82. Live census before and after: 5 credited files, **0 big**, no new uploads. The CI gap: it never measured the credit inside the saved file. | #854 / #855 (CI measurement; fail-first on the first geometry: 55–58 %, alpha 0.8) | 772b3b84 / **5dc3fcd4** | 41636511256 PASS | measured; CI added |
| 2 Feed right-click gave a clean file | By design in Unit A (only full screen was layered) | #854 / #855 | 772b3b84 / **5dc3fcd4** | **41636511256 PASS** (0 new console lines) | **LIVE** |
| 3 Lens focus not seen | No code fault: it plays in Chromium, Firefox and WebKit with motion allowed, and is off under prefers-reduced-motion (Windows "Animation effects" off). Only posts with camera details show the line. | — | — | — | Owner check |

**Real screens:** `_control\out\OWNER\credit-REAL-v2-1..15.png`. The saved files are zoomed at the credit corner, for feed and full screen, in Chromium, Firefox and WebKit, plus the worker path. A log of the right-click target URLs sits beside them.

**Owner list (plain words)**
1. On a computer, open the feed. Right-click a photo uploaded with New Photos on → "Save image as" → open the saved file: the small, faint "© name, 50mm Retina World" sits bottom right. Do the same in full screen. Nothing on screen shows the credit.
2. Lens focus: Windows Settings → Accessibility → Visual effects → **Animation effects**. If it is Off, Windows asks websites not to animate, and the camera line then appears without the blur effect (the approved rule). Tell us if you want it to animate anyway.
3. Still open: the production deploy of the edge function `detect-orphan-files` (supervisor: d1-deploy-functions.yml, target production). Also, photos from before the plan have no small-credit copy, so saving them still gives a clean file (a re-backfill would fix that; it is your decision).

---
READY for New Photos switch-on. Items 1–4 of the Owner's confirmed sheet are LIVE on main and live-checked (3 Nov 2026, 10:50 UTC, local fix runner). New Photos (`photo_set_v2`) is still OFF; the Owner switches it.

| Item | PR (staging / main) | Merged sha (staging / main) | SQL / workflow runs (UTC) | Live check | State |
|---|---|---|---|---|---|
| 1 Gap + slider dots (+ offline camera-line band) | #846 / #847 | cf27807e / **fa3cfa3b** | none | **41604547547 PASS** | **LIVE** |
| 2 Unit A: the credit is never on screen | #848 / #851 | 4d680648 / **fb818f97** | `detect-orphan-files`: staging v7 41611342667 ✓; **production deploy refused by the session's permission system — supervisor item** | **41617507140 PASS** | **LIVE** |
| 3 Unit B: one switch reader; download icon + app save by policy | #849 / #851 | d72556a5 / **fb818f97** | none | 41617507140 PASS | **LIVE** |
| 3b Follow-up: an archive copy never holds up a post | #852 / #853 | e6730ef0 / **f66cdf51** | none | 41621769345 PASS | **LIVE** |
| 4 Rectify the 5 big-credit photos (3 posts) | #850 / #853 | c582b94c / **f66cdf51** | **staging:** 0106 FAIL 41616293894 → apply 41616486235 → PASS 41616642066 · worker 41616752306 (dry) / 41616870328 (1 recorded) · 0107 FAIL 41617056021 → apply 41617313820 → PASS 41617400035 · rollback 41617511510 → FAIL 41617607214 → re-apply 41617704174 → PASS 41617789711. **production:** 0106 FAIL 41620678238 → apply 41620843400 → PASS 41620949533 · worker 41621045367 (dry, 5) / 41621179007 (**5 recorded, 0 failed**) · 0107 FAIL 41621419024 → apply 41621574842 (**3 posts / 5 photos**) → PASS 41621668580 | **41621769345 PASS** | **LIVE** |

**Real screens:** `_control\out\OWNER\credit-REAL-1..10.png` (index + right-click target log), `gapdots-REAL-1..10.png`.

**Owner list (plain words)**
1. **Switch New Photos on and look on the web:** open www.50mmretina.com → Admin → **Photos** → **New Photos** → **Selected members** and add yourself (or **All members**). Then check:
   - (a) the feed: no "© name" on any photo; tight gap; dots close together;
   - (b) open a photo full screen: no credit visible; on a computer, right-click the photo → "Save image as": the saved file has the small credit, bottom right;
   - (c) no download icon on posts;
   - (d) the 3 fixed posts from 2–3 Nov (uploaded while New Photos was on) look clean.
2. Good to know: full screen shows a clean 1080 px copy, so zoom is a little softer than before.
3. Tell the chat "web OK" → then the one app version 1.2.38.

---
**Earlier record (2 Nov, runner U0–U7)** — kept below unchanged.


**Smart photo plan runner: status** (file: `docs/evidence/cloud/PHOTO_PLAN_STATUS.md`; never merge this PR)

Last update: 2026-11-02 23:40 UTC (local runner, fourth run — U5/U6/U7 + sign-in fix on main, app 1.2.37 built, production census PASS 598/598)

| Unit | PRs | Merged (staging / main) | SQL / workflow runs (UTC) | Live check | % |
|---|---|---|---|---|---|
| U0 measure | #820 · carry #822 | 8cf88d4f / dd8209e6 | read-only, 40 live photos 10:34 | ✓ (with #822) | 100 |
| U1a camera details (DB) | #821 · carry #822 | 33692afb / dd8209e6 | **staging:** PROBE 41435125694 FAIL A1 (expected) 11:15 · apply 41444038665 ✓ 12:22 · PROBE 41444176542 **PASS** 12:22 · **production:** PROBE 41453960303 FAIL A1 (expected) 13:33 · apply 41454507922 ✓ 13:37 · PROBE 41454710509 **PASS** 13:38 (photo_set_v2 = off, 0 rows) | 41462810560 (14:34) ✓ | 100 |
| U1b upload path (client) | #823 · #826 · #828 · carry #831 | 932271d5 + 7a79a9a5 + d560e4bf / c723e498 | `detect-orphan-files`: staging 41490540929 refused 17:22 (Supabase CLI v3.0.0, released 12:18 UTC, now asks before deploying; nothing changed) → #828 adds `--yes` → **staging 41501021698 ✓ 18:32 (version 5, verify_jwt true)** → **production 41504182315 ✓ 18:50 (version 33, verify_jwt true)** | 41504451476 ✓ | 100 (code + function live, switch OFF) |
| U2 display | #825 · #829 · carry #831 | e71c59fb + 0e2cf81f / c723e498 | no SQL. #829: the switch-OFF snapshots held age-based reach figures, stale from 15:32 UTC (every PR's unit tests red, e.g. 41491197888); fixed clock in that test, snapshots unchanged | 41504451476 ✓ | 100 (switch OFF) |
| U3 download removal | #827 · carry #831 | 67f9a389 / c723e498 | no SQL | 41504451476 ✓ | 100 (switch OFF) |
| U4 save mobile data + review follow-ups | #830 · carry #831 | 492aa191 / c723e498 | no SQL | 41504451476 ✓ | 100 (switch OFF) |
| U5 backfill | #832 · carry #833 · sign-in fix #837 · carry #839 | 83000083 + 34b13954 / 3d9f9760 + 2d4ea118 | **staging:** PROBE 41514251258 FAIL A1 (expected) 19:54 · apply 41514428601 ✓ · PROBE 41514534347 **PASS** · `detect-orphan-files` 41514649231 ✓ · copies dry-run 41514677532 (2) → run 41514822543 ✓ 2/2 recorded (sizes + credit checked on the CDN) · census 41515035895 **PASS** 2/2 · swap PROBE 41515536452 FAIL S1 (expected) → swap 41515642089 ✓ → PROBE 41515785819 **PASS** → rollback 41515956002 ✓ (URLs byte-identical) → swap again 41516084403 ✓. **production:** PROBE 41518615738 FAIL A1 (expected) 20:25 · apply 41519121704 ✓ 20:29 · PROBE 41519706443 **PASS** 20:30 (598 photos pending) · `detect-orphan-files` 41519736975 ✓ (v34) · copies 41519876024 ✗ sign-in 400 = **production Auth CAPTCHA on the password grant** (coordinator, 21:10) → fixed in #837 (server-side session like the live converter, nobody signed out), on main via #839 · copies dry-run 41531788769 ✓ (signed in server-side; 598 photos) · run 41532098889 (55-min cap, resumable) → census 41540207771 FAIL: 280 of 598 recorded (expected mid-run) · run 2 41540299340 ✓ 318/318 recorded, 0 failed · **census 41546776688 PASS 23:37: 598 of 598** (516 posts ready to swap; 37 avatars-bucket + 20 Supabase-storage photos stay as they are) | 41534680371 ✓ (0 new console lines) | 100 runner side (the swap waits for the Owner) |
| U6 competition auto-delete | #834 · carry #835 | 31f3dce2 / 22fa3a4e | **staging:** PROBE 41520718664 FAIL A1 (expected) · apply 41520835443 ✓ · PROBE 41520965510 **PASS** (2 competitions, none final) · `photo-retire.yml` dry-run 41523936652 (0). **production:** PROBE 41523553680 FAIL A1 (expected) 20:55 · apply 41523719198 ✓ 20:56 · PROBE 41523820005 **PASS** 20:57 (0 competitions; switch off; dry run 0). `photo-retire.yml` **disabled** (cron OFF on live until proven) | 41524138226 ✓ (console lines identical to 41504451476, 0 new) | 100 (switch OFF) |
| U7 delete old big files | #836 · carry #839 | c6b3f1e3 / 2d4ea118 | **production:** PROBE 41532167532 PASS (598 photos still old, 0 swapped, nothing queued; 0104 refuses until the switch is on + swap). **staging:** PROBE 41524801074 FAIL U1 (expected) · apply 41526828483 ✓ (6 queued: 2 due, 4 kept — still named elsewhere / rungs of a kept photo) · PROBE 41527051932 **PASS** · retire dry-run 41528077071 (2 files, 24,858 bytes) → run 41528159135 ✓ deleted 2 · PROBE 41528334675 **PASS** (deleted 2, 24,858 bytes); posts still show their new copies (200). **production:** Owner item (needs the switch on + swap) | — | 80 (production = Owner) |
| App bump 1.2.37 | #838 · carry #840 | 5ef72346 / e92d4669 | android-build #140 41534590843 ✓ (versionCode 1140, versionName 1.2.37) — .aab for the supervisor to save + scan | 41534680371 ✓ | 100 |

**Live check 41504451476 (18:51 UTC, main c723e498, live bundle confirmed to contain the U4 code before the check):** Chromium / Firefox / WebKit — `/`, `/feed`, `/notifications` all 200 with text, same text on both loads; console lines identical to the 2 Nov 14:34 check 41462810560 (9 = 9, **0 new**).

**What each unit does (all behind switch `photo_set_v2`, OFF on both lanes):**
- U1b: new post photos stored as WebP 2048 (with "© name, 50mm Retina World") / 1080 / 600 / 320 under marker `-l4`; competition keeps full size + `-l4f` copies; camera details (7 keys, never GPS) saved after the post. Review: nothing blocking.
- U2: camera line (app feed), ⓘ sheet (app full screen), slide-open strip (web), no-EXIF states, owner Hide/Show; 320 copies in grids; blur placeholder. Review: nothing blocking.
- U3: no member download anywhere; admin/judge keep it on competition entries (web only); full screen = credited 2048; app long-press save off. Review: nothing blocking.
- U4: "Save mobile data" (Edit profile, kept on this device): on mobile data photos one size down (feed 600, full screen 1080, inline 600); videos start 720p on Wi-Fi, 480p on mobile data, 240p (cap 480p) with Save mobile data, 240p-only on a slow network (as today). Review follow-ups: (1) feed shows 600 + 1080, never the 2048 — done; (2) My Photos / notification 320 tiles fall back if the 320 is missing (to the credited 2048, never a competition full size) — done; (3) "arrow keys move the viewer behind the ⓘ sheet" — tested first: **not a bug** (test passes on the old code); no fix shipped, test kept; (4) the hashtag page's full screen had no ⓘ — added (app). Review: nothing blocking. 34 new tests, 24 seen failing first.

**Known limits (recorded):** iPhone / desktop browsers cannot say Wi-Fi vs mobile data: there videos start on 480p (not 720p), and "Save mobile data", if turned on, always saves. The feed photo decides "v2 or not" once per photo appearance (U2 design).

**U0 result (true saving, measured on live, 40 public photos):** stored per photo 1,028 KB → 537 KB (−47.7 %); full-screen open 735 → 357 KB (−51.4 %); grid tile 37 → 12 KB (−66.8 %). Evidence: `docs/evidence/photo-plan/U0/`.

**What U5–U7 do:**
- **U5 backfill** (`docs/evidence/photo-plan/U5/`): a worker (`s3-media-backfill.yml`, job `photo-set`) writes the v2 set (credited 2048 / 1080 / 600 / 320, `-l4` names; the whole old name is kept, so no two photos can collide) BESIDE every old post photo, through Pages routes that derive every key, never overwrite, never delete, and record a photo only after one HEAD per copy. The census PROBE counts old photos still without their set. The **swap** (0102) moves posts to the new URLs one post at a time, keeps the full before/after, rolls back byte for byte, and **refuses on production while `photo_set_v2` is off** (it changes what every member sees, old apps included). The credit was drawn by the Linux runner and checked on a real staging copy.
- **Production sign-in (fixed, not an Owner item):** production Auth has CAPTCHA on password sign-in (`captcha_failed`), so the worker now gets its session server-side the way the live converter does (#837). It signs nobody out, and CAPTCHA stays on.
- **U6 competition full size** (`docs/evidence/photo-plan/U6/`): "results final" was measured from the live schema as round 4 published (`competition_round_publish`; the live trigger sets phase/status to `result` from exactly that row). A daily database job (04:10 UTC) runs only while the new switch **`competition_fullsize_purge`** is set to All members. It moves a v2 entry (`-l4f`) to its credited 2048 copy 30 days after final results and queues the full-size file. Anything still named elsewhere is kept. `photo-retire.yml` deletes the queue through `/api/media/retire`, which refuses any copy and any full-size file whose 2048 copy is missing. Old pre-v2 entries are never touched. Production has 0 competitions; staging has 2, none final.
- **Found and fixed in U6:** Admin → Features dropped unknown switches, so **`photo_set_v2` had no card and could not be clicked.** It now appears under Admin → **Photos** → *New Photos* and *Competition Full Size*.
- **U7 old big files** (`docs/evidence/photo-plan/U7/`): 0104 queues each swapped photo's old file, its old thumbnail and its `-l3` rungs. It runs only when no post still shows an old file and, on production, only while `photo_set_v2` is set to All members. Anything still named elsewhere (and the rungs of a kept photo) is kept. Nothing is deleted until `photo-retire.yml` with kind `post_old` is run by hand, dry run first (count + bytes). Every step is reversible until that run, and the swap rollback never points a post back at a queued or deleted file. Proven end to end on staging.
- **App 1.2.37** (#838): the one app version for the plan. Every new behaviour is behind switches that are OFF on live.

**Production U7 dry-run estimate (read-only, 2 Nov 20:34 UTC, public posts):** 597 old photos → 1,899 candidate files, 1,844 present, **556,702,446 bytes ≈ 531 MB** to free.

**Known limits (recorded):** iPhone and desktop browsers cannot tell Wi-Fi from mobile data, so videos start at 480p there and "Save mobile data" always saves. Photos past slot 50 of a post are not backfilled (no post has more than 10). Old photos outside the photo bucket stay as they are and are never deleted: on production, 37 avatars-bucket files and 20 Supabase-storage photos. `photo-retire.yml` is disabled until the Owner turns on competition deletion (item 3).

**Not verified, and why:**
- No phone test with the switch on, because the Owner switches it.
- The production 2048 copies were checked by the server (one HEAD per copy before each record, 598/598), not by eye; the eye check of the credit was on staging.
- No competition is final on either lane, so U6 has run only in the fixture and as a dry run.
- Blur and size behaviour on a real network was measured only in jsdom.

Every new behaviour ships behind a switch that is OFF on live. I never switch anything on.

**Owner list (plain words)** — the live photos are ready: every old photo has its new copies (census PASS 598/598, 2 Nov 23:37 UTC).
1. **Switch the new photos on:** open www.50mmretina.com → Admin → **Photos** → **New Photos** → choose **All members** (or first **Selected members** and add yourself to try it). Look at the feed, a full-screen photo (the small "© name, 50mm Retina World" bottom-right), the camera line under a photo, and Edit profile → "Save mobile data". Then type **"swap OK"** in the Claude chat — a session then moves the OLD photos to their new copies (20261110_0102; it refuses until you have switched on).
2. **Delete the old big files (≈ 531 MB on live):** after the swap, look at a few old posts; if they look right type **"delete old files go"**. A session then queues them (20261110_0104), shows you the exact count + size (dry run), and deletes. You already said "delete originals yes"; this is only the go after you have seen the new photos live.
3. **Competition full size after 30 days:** when you want it, Admin → **Photos** → **Competition Full Size** → **All members**, and type "competition delete on" (a session re-enables the daily delete job). Today no competition on live has final results, so nothing would be deleted yet.
4. **App 1.2.37:** the supervisor saves and scans the .aab after the build; you upload it to Play as usual.
