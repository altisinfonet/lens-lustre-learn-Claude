# S7 · Privacy text for video + music recognition (site policy, Play, Apple)

**S7 gate clause:** privacy policy + Play Data-safety + Apple privacy-label text updated for video + music recognition.
**SQL (site / in-app policy page):** `supabase/migrations/20261030_0703_s7_privacy_policy_video.sql` · rollback `supabase/rollback/20261030_0703_s7_privacy_policy_video_ROLLBACK.sql` · PROBE `supabase/migrations/PROBE_20261030_0703_s7_privacy_policy_video.sql`.

## Where the policy lives (inspected 2026-10-31 ~04:10 UTC)
The page at `/page/privacy-policy` (site, Android app, iOS app, and the store listings' privacy URL) is **data, not code**: `src/pages/ManagedPageView.tsx:91-98` reads `site_settings.managed_pages` and shows the element whose `slug` is `privacy-policy`; Admin → Pages edits it. `src/components/admin/pages/PageTemplates.ts` holds only a starter template and is not served. So the change is a sanctioned data migration (precedent: `20260805090000_client_error_image_load.sql` fixed `managed_pages` the same way), applied through `apply-migration.yml`.

| Lane | Page updated_at | md5 of content | Mentions video / music? |
|---|---|---|---|
| production | 2026-10-17T05:51:34.199Z (the Owner's text) | 9e2488beef9242f12ce730c6c8ec5e92 | no |
| staging | 2026-04-05T04:13:54.221Z (older text) | a45df80ca998dc39521c385b4670fb52 | no |

The migration refuses any other content (an Owner edit since is never overwritten).

## The text added (three paragraphs) — and the code each sentence rests on
| Sentence | Checked against |
|---|---|
| We store the video, the cover picture you choose, its length, file size and picture size, and a fingerprint (a hash) of its sound | `video_versions` columns `declared_duration_s`, `total_bytes`, `width`, `height`, `audio_sha256` (20261005_0005); DECISION.md A4.4 |
| Usually your phone or browser prepares the video; when WE switch on server preparation for the site, the original is uploaded to our storage, prepared on our own conversion server, deleted within 8 days | `src/lib/video/conversionMode.ts:4-7` (site-wide `video_conversion`, admin only — never a member's choice); device / browser encoder `webEncoder.ts`; server mode `video_sources` (20261012_0002); bucket lifecycle `upload/source/` 8 days (converter-finished-retention/README.md:47); converter = Oracle Always Free VM (`converter/deploy/README.md:4`) |
| A video can be seen by the same people who can see its post | videos RLS = posts RLS (README-vid2.md) |
| Music check: switched off today; would receive only the sound; we keep only title, artist, match closeness (score) and position, never the full reply | 3-mode switch shipped Off, refused ON without the key (VID-4); `video_music_checks.matches` "[{title, artist, score, begin_ms, end_ms}] only; never the raw provider response" (DECISION.md:299) |
| Removed after a report / copyright notice: hidden at once, owner told, can upload a corrected version | `video_takedown` (20261030_0701): `taken_down`, owner notice `video_taken_down`, `taken_down → uploading` new version |
| Deleted video or post: hidden at once; files kept 30 days then permanently deleted | R-100; `video_housekeeping` 30 days; `video_orphan_sweep` + purge worker (S7-a, S7-f) |
| Processors: Cloudflare stores photos and videos; video conversion on our own server (Oracle Cloud) | R2 buckets PHOTOS / MEDIA (`functions/api/video/_lib.ts`); converter VM |

## Google Play — Data safety (Owner clicks; nothing here is done by me)
Play Console → **50mm Retina World** → **Policy and programs** → **App content** → **Data safety** → **Manage** (or **Start**) → **Next** to the **Data types** page:
1. Under **Photos and videos**, tick **Videos** (Photos is already ticked) → **Next**.
2. On the **Videos** card click the pencil (**Edit**) and answer:
   - Is this data collected, shared, or both? → **Collected** only. (Cloudflare, our conversion server and a future music-recognition service work on our behalf — Play counts that as *not* shared.)
   - Is this data processed ephemerally? → **No**.
   - Is this data required or optional? → **Users can choose whether this data is collected** (optional — only members who post a video).
   - Why is this data collected? → tick **App functionality** only.
   → **Save**.
3. **Next** through the remaining pages without changing them → **Save** → **Send for review** (from **Publishing overview** if Play asks).

## Apple — App Privacy label (Owner clicks)
App Store Connect → **Apps** → **50mm Retina World** → **App Privacy** (left menu) → **Edit** next to *Data Types*:
1. Tick **Photos or Videos** (if it is not already ticked — it covers both) → **Save**.
2. Click **Set Up Photos or Videos** and answer:
   - How is it used? → tick **App Functionality** only → **Next**.
   - Is it linked to the user's identity? → **Yes** → **Next**.
   - Is it used for tracking? → **No** → **Save**.
3. Click **Publish** (top right of the App Privacy page).

Nothing else changes: no new data type is needed for music recognition, because only the video's own sound would be sent, to a service working for us, and only once the Owner switches the check on (when the service is chosen, it is named on the policy page first).

## Tests (FAILING first) — local, on copies of the two real pages
Fixture: a scratch Postgres 16 with `site_settings` (+ RLS read for anon), `db_audit_logs` and the real `audit_site_settings` trigger (20260403081955), loaded with each lane's real `managed_pages` read 2026-10-31 ~04:10 UTC with the public key (not committed: the production page carries a contact address).
| Lane | PROBE before | apply | PROBE after | apply again | rollback | PROBE after rollback |
|---|---|---|---|---|---|---|
| staging-shaped | **FAIL G1** (block not on the page) | md5 a45df80c… → f64f1534… | **PASS** (appended; other pages byte-identical) | "already carries the block — no change" | md5 back to a45df80c…, updated_at 2026-04-05T04:13:54.221Z | FAIL G1 |
| production-shaped | **FAIL G1** | md5 9e2488be… → 51a87720… | **PASS** (before Contact, date 31 Oct, processors named, other pages byte-identical) | no change | md5 back to 9e2488be…, updated_at 2026-10-17T05:51:34.199Z | FAIL G1 |

A page edited since (one trailing space added) → apply **REFUSED**, nothing changed. Re-read live 2026-10-31 04:40 UTC: both md5s unchanged.

## Review #727 (independent reviewer, diff only)
- **#1 BLOCKING, fixed:** the first text said members could "choose" server preparation. They cannot: `video_conversion` is one site-wide setting only an admin switches (`src/lib/video/conversionMode.ts:4-7`; `VideoPostComposer.tsx:97` follows it); on the website the browser encodes, not a phone; in server mode the original goes to our storage first. Fail-first: PROBE G1 gained a check ("does not say that WE switch server preparation on"), run on the old text → **FAIL G1** with exactly that line; new text → PASS on both lanes, rollback still exact. Same pass: the cover picture and the match score are now named.
- Non-blocking, recorded: an admin with the Pages editor open could save the whole array afterwards and drop the block (re-run the PROBE later; Owner asked not to edit pages during the apply); G3 only prints a NOTICE where no audit row exists; "before the video is shown" holds only in the enforcing mode (the check is off).

## Runs (apply-migration.yml)
(filled in as they happen: staging PROBE-before → apply → PROBE-after; production after the carry to main)
