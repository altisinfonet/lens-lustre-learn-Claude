# S7 · "Video complete" — gate table (re-checked live 2026-10-31)

**S7 gate:** all VID gates PASS on staging and live; the Owner tests on a phone and in 3 browsers.
**How re-checked:** every video PROBE in `supabase/migrations/` was dispatched again through `apply-migration.yml` on **staging** (ref `staging`) and **production** (ref `main`) between 05:26 and 05:42 UTC on 2026-10-31. Every PROBE ends in ROLLBACK and raises on any miss, so a green run = PASS. CI rows are the latest green runs of the push to each branch.
**Scope decisions in force (Owner, 2026-10-30):** short clips **dropped**; video card stays **9:16** (A1.3); cost alarm at **8 GB**.

## Gate table
| Gate | What it proves | Staging (run · PASS) | Production (run · PASS) |
|---|---|---|---|
| VID-7 switches | three-mode switches Off / Selected members / All members; refuses the music check ON without the music-API key | 41172592922 | 41172594832 — live: `video_posts` **Selected (6 accounts)**, `video_ads` **Selected (1)**, `copyright_music_check` **Off**, music-API key not configured |
| VID-2 videos | tables, state machine, publish gate, RLS, limits, 30-day purge | 41172976888 | 41172979080 |
| VID-2 attest (A1.5) | no unattested upload path; if any video switch is not Off the lane's upload-signing key exists | 41172760243 | 41172762144 — live: **attest key configured**, so Selected / All members is allowed |
| VID-1 upload info | owner-only upload facts | 41173212397 | 41173214199 |
| VID-1 no duration cap | no length limit (Owner rule), 500 MB encoded size | 41173253691 | 41173255827 |
| VID-1 bucket separation | video files never in the public photo bucket | 41173294611 | 41173296172 |
| VID-1 duplicate / publish | post-media-only duplicate rule; atomic publish; publish as definer | 41173348413 · 41173387595 · 41173469488 | 41173350200 · 41173389312 · 41173471139 |
| VID-1 server converter | sources queue, converter account, finished-job retention | 41173431686 · 41173551434 · 41173508197 | 41173433489 · 41173553336 · 41173510491 |
| VID-4 music check | built complete, shipped **Off** | 41173165546 | 41173167319 |
| VID-4 takedown (S7-b) | admin takedown hides at once, owner notified, audited; copyright report switch Off | 41173633039 | 41173636097 |
| VID-6 file deleter (S7-a/f) | purge queue claim/done, 30-day rule, orphan sweep | 41173591955 | 41173594426 |
| VID-6 alarms (#724) | 8 GB video storage alarm + 6-hour music wait, via `ops_alarms` | 41168213981 (04:22) | 41169465209 (04:39) |
| Privacy text (#727) | Privacy Policy page describes video, music recognition (off), removal | 41171073798 (05:05) | 41172309529 (05:22) |

| CI check (browser side) | staging | main |
|---|---|---|
| Browser encodes a real video into HLS the server accepts (`d2-video-encode.yml`) | 41171549945 | 41172838722 |
| App origin journey, https://localhost (`d2-app-origin.yml`) | 41171549890 | 41172838670 |
| Back returns to the feed — Chromium, Firefox, WebKit (`d2-nav-harness.yml`) | 41171550002 | 41172838711 |
| Unit tests incl. video card / ad / takedown (`d2-vitest.yml`) | 41171550019 | 41172838642 |
| Converter worker builds aarch64 + x86_64 (`d2-converter.yml`, path-triggered) | 41071126141 (S7-f) | carried in #697 |
| Live site home + /feed, 3 engines (`d2-live-check.yml`) | — | 41172366566 (05:24) |

**Result: every VID gate PASSES on staging and on production.** What is left for S7 is only the Owner's part below (phone + 3 browsers, rollout) and the Android release (1.2.33).

## What I found that you should know
- On the live site video is **already partly switched on**: Video posts = "Selected members" with 6 accounts, Video ads = "Selected members" with 1 account. That is allowed: the upload-signing key is configured on production. I changed nothing.
- Video Conversion stays "device" (phones and browsers prepare videos). The live converter is running (worker 1.3.0 on both lanes, local session 30 Oct) and only takes work when you choose "server".

## Owner steps — staged rollout (click-only; I never switch anything)
The buttons on screen read **Off / Selected / All**.
1. Admin → **Video Feature** → **Video Posts** → under *Members* look at the 6 people listed. If you want to start with only yourself: tick everyone except your own account → **Remove**. Leave *Who can use it* on **Selected** → write a note (e.g. "Owner test") → **Save**.
2. Test on your phone (Android app) and in Chrome, Firefox and Safari: make a post with a video, open it in the feed and on your profile, play it, delete it. Also try **Upload resume** (switch `photo_upload_resume`, already All members): start a photo upload, turn Wi-Fi off for 10 seconds, turn it back on — it should carry on.
3. If all is well, add a few members: same page → *Members* → search a name → tick → **Add** (stay on **Selected**). Wait a day.
4. Everyone: same page → *Who can use it* → **All** → **Save**. (To undo at any time: choose **Off** → **Save**; the member list is kept.)
5. Video ads work the same way under Admin → **Video Feature** → **Video Ads** (only admins upload ads).
6. Leave **Copyright music check** on **Off** (it refuses to turn on until a music-recognition service is chosen and its key is set).
