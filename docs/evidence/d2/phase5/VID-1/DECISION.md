# VID-1 · Video on Cloudflare R2: device-side HLS, signed-URL upload, data model, copyright-music switch, three-mode switch, 9:16 card

**Unit:** VID-1. This file also carries the data-model half of VID-2, the rules of VID-7, the copyright-music check (R-97 → R-102/R-103) and the offline rule (OFF-8).
**Lane:** D2 + D1. Written by the D3 session; docs only, no SQL, no code.
**Date:** 2026-10-05 · signed by merge (#376, R-88) · **Amended 2026-10-10 (A1, below)** · **Path:** `docs/evidence/d2/phase5/VID-1/` (R-82 rule 2)

## A1 · Amendment, 2026-10-10 (MASTER §3t R-104 + §3u R-105) — read this first

Where this box and the text below disagree, **this box wins**; the sections below are already edited to match. Unit count unchanged (51).

| # | what changes | source | sections |
|---|---|---|---|
| A1.1 | **Copyright music check is a switch, shipped Off.** `copyright_music_check` is a third feature row in the same three-mode switch as `video_posts` / `video_ads`. Off → videos publish with any audio (the audio hash is still stored). Selected members / All members → those members' new videos are checked and a match blocks publishing. **Turning it to Selected/All is refused unless the music-API key is configured** (vault `music_check_api_key`). Every change audit-logged. Supersedes R-97's "always on, no admin switch" and §8's "never for the music check" | R-102, R-103 (F-D2-21 / SEC-VID-3) | §6, §8, §12 |
| A1.2 | **Switch labels, exactly:** "Off" / "Selected members" / "All members"; stored values `off` / `selected` / `everyone`. Admin → **Features** page: one card per feature, member search (name, @username, email), chips with Remove, optional note, history under each card; applies within 60 s, no release | R-103, R-104 | §8 |
| A1.3 | **Every video card is 9:16** (posts and ads; feed, profile, upload preview). A 9:16 video fills it; any other shape is fitted **whole** (contain, never cropped), centred, with a blurred enlarged copy of the same video as fill. Upload preview = posted card. **Supersedes R-100's VID-3 "photo frame 4:5 … 1.91:1" for VIDEO ONLY; photos unchanged** | R-105 | §2, §9 |
| A1.4 | **Upload prefix + server copy (SEC-VID-1):** presigned PUTs go to `upload/video/…` only; the served key `video/…` is never handed to a client. `complete` verifies from `upload/`, then writes the verified bytes to `video/…` itself and deletes the upload objects | SEC-VID-1 (met in #382 code) | §3 |
| A1.5 | **Attested `complete` (F-D1-4, as tightened by SEC):** `video_mark_uploaded` accepts only an HMAC attestation minted by `complete` after its checks and the A1.4 copy. **Gate:** required before `video_posts` is on for anyone except the Owner's own account, before `video_ads` or `copyright_music_check` leave Off for anyone, and before 0004–0006 go to main/production | F-D1-4, SEC 2026-10-05 | §1, §3, §12 |
| A1.6 | **D1's as-built deviations** (#380: 0004–0006) are recorded as the frozen shape | D1 handoff, READMEs vid2/4/7 | §4, §6, §7, §8, A1-D |

### A1-D · D1's deviations, accepted as the frozen shape (#380, `20261005_0004`–`0006`, merged to staging `329a541`, applied by runs #152–#157)

1. **States:** the plan's "processing" is `checking`. Added moves: `ready → taken_down → uploading (v n+1)` (fix after a takedown), any → `deleted` by owner **or admin** (`video_delete`). Deleted / failed videos are **purged after 30 days** (R-100) by `video_housekeeping()` (cron `video-housekeeping` `41 * * * *`); the R2 prefix is queued in `video_r2_purge_queue` for the file worker (D2 / VID-6). Every illegal move is refused for every role, service_role and the table owner included.
2. **Verdict `not_required`** (new): written when the check is Off for that owner (A1.1). It still binds the version's audio hash. **The mode is fixed per version** at `video_mark_uploaded` (on/off for that version never changes later). An **on** check can never close as `not_required` (MC-002); an **off** check can never be judged.
3. **CHECK name** is `ready_needs_check` (was `ready_needs_clean_check`); the gate accepts `clean` / `clean_no_audio` / `clean_library` / `not_required`, bound to this version's audio hash, ±2 s for provider verdicts.
4. **When On, a client-supplied hash is never stored:** only the worker's hash of the served bytes binds an on check. When Off, the hash from `complete` is stored and the video is ready in the same call; with audio but no hash → queued, the worker hashes and closes as `not_required`.
5. **`feature_allowed(feature, uid)` is internal** (not callable through the API, so no member can probe another member's access). The client uses **`feature_allowed_me(feature)`** to show/hide buttons. Admin page reads `feature_admin_state()` and `feature_member_search(q)`.
6. **Member lists are kept whatever the mode** (All → Selected brings the saved list back; Off does not delete it). `feature_access` has a `note` column. The audit is append-only by trigger (UPDATE/DELETE/TRUNCATE refused for every role).
7. **Remedies** go through `video_new_version(...)` (owner, `music_blocked` only): mute / library track / trim (1–20 ranges, ≥ 3 s left). It creates v n+1, not a new upload, re-validated by the internal `video_validate_version()`.
8. **Library:** `music_library_add` (admin, https licence URL, **added inactive**) → `music_library_set_fingerprints` (worker) → `music_library_set_active` (refused before fingerprints, LIB-003); `music_library_audit` append-only.
9. **Limits additions:** poster + playlists ≤ 2 MB; renditions must add up to the total; count rules run under a per-member advisory lock; a replay returns the same row before any limit counts.
10. **Categories (R-100):** a post takes a video only with 1–5 categories (VID-CAT-001, both lane shapes); a video ad carries its own 1–5 active slugs (VID-CAT-001/003).
11. **Hidden from every API role:** idempotency key, manifest hash, audio hashes, **provider**.
12. **Not built yet (stated by D1):** the `music-check` Edge Function (vendor adapter, wake, sweep). Until it ships: Off publishes; On waits in `checking`. Never published unchecked.
13. **Rollback:** 0005's rollback refuses while any video row exists (member data is never dropped); the no-loss kill switch is `feature_set_mode(<feature>,'off')`.

### A1-S · SEC notes carried into the frozen shape (not new units)

- **SEC-VID-4 (LOW):** `ad_videos` has two permissive SELECT paths for authenticated; D1 splits the admin policy into INSERT/UPDATE/DELETE **inside the F-D1-4 attest unit**.
- **SEC-VID-5 (INFO, Owner):** see §13 Owner opens #5 — whether the check mode is sticky across a remedy.
- **SEC-VID-6 (INFO):** video visibility = **posts RLS (privacy + friends)**. Staging `can_view_post` has **no `user_blocks`**, so blocks do not stop playback today (same as photos). If blocks must stop playback, `play-token` (D2) applies them (§9.2).
- **SEC-VID-7 (INFO):** an admin `video_delete` of a member's video is audited together with the VID-4 takedown audit.

> **Supersedes #360** (VID-1 on Cloudflare Stream, 2026-10-04). That PR is closed unmerged; nothing from its Stream flow survives.
> It also folds in SEC's rulings on the earlier R2 draft (`_control\out\SEC\2026-10-05-VID-1-r2-SEC-rulings.md`):
> - **F-D3-17 (MEDIUM):** fixed by §2/§6, the separate audio rendition plus the init-segment parse;
> - **F-D3-15 (LOW):** its 5 conditions are in §3/§9 and are proof items in §12;
> - **N1–N4:** in §9/§10.

**Inputs, verbatim:**
- **R-97, VID-0:** "Cloudflare R2 (not Stream) — near-free (10 GB/month free, egress free); videos compressed/transcoded to HLS renditions on the device before upload (D2), stored in R2, served via CDN."
- **R-97, limits:** "member videos 3 min / 500 MB / 10 a day · video ADS admin-upload only, 5 min / 500 MB, no daily cap, same story-card positions (2,5,10,15, then every 10), like/comment/share as a post."
- **R-97, offline:** "prefetch the first ≥25 s (more when budget allows) of the lowest rendition of feed videos within the OFF-4 cap, oldest evicted, wiped on sign-out."
- **R-97, copyright music (SUPERSEDED by R-102/R-103 for the switch; the block/remedy/retry rules stand):** "ALWAYS ON, no admin switch. Every video (posts AND ads) is checked before publish; a match BLOCKS posting until the music is changed — member chooses: remove sound, replace with a track from the free in-app music library, trim the matched part, or cancel. Server-enforced (a video cannot be published without a clean check result). Checker down → video waits as "checking" and retries automatically, never published unchecked."
- **Owner command (2026-10-05):** "upload to R2 with a signed URL from a Pages Function acting as the member; served via the CDN host; no service role in the client" · "Add a "Report copyright" action on posts."
- **R-91, VID-1:** "resumable upload that survives poor network (… continues after drop or offline, via the OFF-2 outbox). Size and duration limits."
- **R-91, VID-7:** "OFF (default; app exactly as today) · SELECTED USERS · EVERYONE" … "Enforced on the server" … "Changes take effect without a new app release".
- **R-102 (MASTER §3r):** "Build the music check fully now, but it ships **OFF**. An admin switch (Admin panel) turns it ON any day" … "the switch can be turned ON only when the music-API key is configured (server refuses otherwise); if the API is down while ON → video waits as "checking" + automatic retry, never published unchecked; every switch change is audit-logged (who/when)."
- **R-103 (MASTER §3s):** "`copyright_music_check` joins `video_posts` and `video_ads` in the SAME three-mode switch: **Off / Selected members / All members**" … "Changes apply within 60 s, no app release. Every change audit-logged".
- **R-105 (MASTER §3u, Owner verbatim):** "all videos must be 9:16 … any other size must be fit in our card — same process as Instagram."
- **R-104 (MASTER §3t):** F-D1-4 fix = "HMAC attest from complete, verified in the DB. Required before `video_posts` is on for anyone except the Owner's own account, and before production."

> **OWNER SIGN-OFF:** signed by the merge of #376 (R-88). Amendment A1 records Owner rulings R-102, R-103, R-105 and the SEC/D1 conditions; it needs no new signature (GUIDELINE §3: D3 docs need Auditor checks only).

Still open for the Owner (unchanged): the music vendor (§7.1, ACRCloud recommended) and the report fast lane (§10), yes or no.

**Build order** (R-91): after OFF-1 and OFF-2. The shapes in §2–§9 are frozen like an interface file (R-96), **as amended by A1**; neither D1 nor D2 changes one without the Auditor reopening it.

---

## 1 · Secrets and who holds them (none in the repo; none in the browser or app; no service role outside Supabase)

| secret | where | used by | why it is not a service role |
|---|---|---|---|
| **R2 S3 API token, Object Read & Write, scoped to the one video prefix's bucket**, one per lane (`R2_VIDEO_ACCESS_KEY_ID` / `R2_VIDEO_SECRET_ACCESS_KEY`) | Cloudflare **Pages secret** | `functions/api/video/upload-urls.ts` (D2): signs **presigned PUT URLs** | It can only write objects in one bucket; it cannot touch the database |
| R2 **binding** `MEDIA` (the lane's media bucket, read) | Pages binding | `functions/api/video/complete.ts`: verifies what was uploaded | A binding is not a key |
| `MEDIA_TOKEN_KEY` (the D-003 token key, 32 bytes, one per lane) | Pages secret + the CDN Worker's secret (the same value) | `play-token` signs; the CDN Worker `media-authz` verifies | Signs read tokens only |
| R2 API token, **Object Read only**, same bucket | Supabase Edge Function secret | `supabase/functions/music-check` (D1) | Read-only |
| Music-recognition API key | Supabase Edge Function secret **and** vault `music_check_api_key` (A1.1: its presence is what lets the switch leave Off) | `music-check` (D1); `feature_set_mode` checks presence only | — |
| **`VIDEO_COMPLETE_ATTEST_KEY`** (A1.5), ≥ 32 bytes, **one per lane, ≠ `MEDIA_TOKEN_KEY`**; a current and a previous key during rotation | Pages secret **and** Supabase vault `video_complete_attest_key` (same value per lane; the previous key under its own vault name) | `complete` signs; `video_mark_uploaded` verifies | Proves only "this version passed `complete`"; it reads and writes nothing |

**The rules:**
- Pages Functions call Supabase **as the member**: anon key plus the member's JWT, so RLS and the RPCs' `auth.uid()` decide everything.
- **No service-role key exists in Pages, in the client or in the app** (the Phase 1 Unit 2 lesson).
- The only privileged writer is D1's `music-check`, which runs where Supabase's service role already lives.

## 2 · On the device: compress, make HLS renditions, keep audio separate (D2)

1. **Limits are checked first** (§5), for UX only. The server re-checks everything.
2. **Transcode into fMP4 HLS on the device:**

   | rendition | target | role |
   |---|---|---|
   | **240p** | ~300 kbps, **video-only** | **the poor-network rendition:** always made, uploaded first, used for offline prefetch (§9.5) |
   | 480p | ~900 kbps, video-only | |
   | 720p | ~2 Mbps, video-only | |
   | **audio** | AAC stereo 96 kbps, **one separate audio rendition** (`EXT-X-MEDIA TYPE=AUDIO`, one group shared by every variant) | omitted entirely for a muted version |

   - 4 s segments, a keyframe every 2 s.
   - **"240p/480p/720p" name the source's SHORT edge** (a 9:16 720p rendition is 720×1280; a 16:9 one is 1280×720). Every rendition **keeps the source's own aspect: no crop, no padding, no blur baked into the file** (A1.3). The 9:16 card and its blurred fill are drawn by the player (§9.6), so the bytes stay the member's own picture and the music check's audio is untouched.
   - No upscaling: only renditions at or below the source's short edge are made; 240p is always made.
   - One master playlist, one media playlist per rendition, and a `poster.jpg` at 1 s.
   - **Why the audio is separate (SEC F-D3-17):** the server must be able to prove that the audio it checks is the audio viewers hear, without decoding anything (§6.1).
3. **Manifest:** a JSON list of every file with its byte size and sha256, plus the declared duration and `has_audio`. Its own sha256 is the **version id**.
4. **Encoders** (D2 confirms in a spike before the first PR; they need the Auditor's dependency window):
   - **web:** WebCodecs + an fMP4/HLS muxer. A browser without WebCodecs says "Video upload isn't supported in this browser — use the app".
   - **Android:** Media3 Transformer.
   - **iOS:** AVFoundation.
   - All three sit behind one Capacitor plugin interface.
   - **Fallback, if an encoder cannot emit separate audio:** muxed renditions are allowed only if `music-check` then demuxes and checks the AAC of **every** rendition (SEC's fallback). It costs more checks, but stays correct.

## 3 · Upload: presigned URLs, resumable per file (D2, through the OFF-2 outbox)

**Every HLS file is its own small object** (about 0.1–1 MB). Resume means "upload the files not yet confirmed", so there is no long-lived multipart session to expire.

1. **`video_begin_upload(purpose, manifest_sha256, total_bytes, declared_duration_s, has_audio, idempotency_key)`** (RPC, D1, SECURITY DEFINER, `search_path=''`). The **owner comes from `(select auth.uid())` only; a NULL uid is refused**; EXECUTE is granted to `authenticated` only (SEC F-D3-15 condition 5). It checks:
   - `feature_allowed('video_posts' | 'video_ads', uid)` (§8); `purpose='ad'` also needs `has_role(uid,'admin')`;
   - the limits and the daily count (§5);
   - **the bytes-per-declared-second ceiling, as a hard check** (SEC condition 4: 240p ≤ 60 KB/s, 480p ≤ 160 KB/s, 720p ≤ 350 KB/s, audio ≤ 16 KB/s, totals per rendition from the manifest);
   - whether the idempotency key was used before; if so, it returns the same row.
   It inserts `videos` (`state='uploading'`) + `video_versions` (v1) and returns `{video_id, version_no}`.
2. **`POST /api/video/upload-urls {video_id, version_no, manifest}`** (Pages Function, D2, **acting as the member**). It:
   - reads the row through RLS (it must be the owner, `uploading`, and the version and manifest sha256 must match);
   - validates every file name against the **allow-list** `^(master|(240|480|720)p|audio)(_\d{1,4})?\.(m3u8|m4s|mp4)$|^poster\.jpg$` (SEC condition 1: no `/`, no `..`, no other extension);
   - stores the manifest in R2;
   - returns one **presigned PUT URL per file not yet present**, valid for 1 h, for key **`upload/video/<owner_id>/<video_id>/v<n>/<file>`** (A1.4, SEC-VID-1: the served key `video/…` is **never** handed to a client; the manifest also lives under `upload/`) on `<account>.r2.cloudflarestorage.com`. Presigned URLs only work on the S3 endpoint, not on custom domains (Cloudflare R2 docs).
   - **Each URL signs `Content-Type` (fixed by extension: `application/vnd.apple.mpegurl`, `video/iso.segment`, `video/mp4`, `image/jpeg`) and `Content-Length` (the manifest size).** A different type or size → `403 SignatureDoesNotMatch`.
   - **If R2 enforces a signed `x-amz-checksum-sha256`,** that is signed as well. D2 confirms this in the first PR. Either way, `complete` re-verifies the sha256 (step 4).
3. **The client PUTs directly to R2** (bucket CORS allows only the lane's web origin and the Capacitor origins, method PUT). The upload order is 240p, then audio, poster, 480p and 720p, so checking and low-quality playback can start before the big renditions arrive. The **OFF-2 outbox** (kind `video_upload`) stores `{video_id, version_no, done[]}`. After a drop, an offline period or a restart it asks step 2 again, gets fresh URLs for the missing files only, and continues. URL expiry costs nothing.
4. **`POST /api/video/complete {video_id, version_no}`** (Pages Function, as the member, via the `MEDIA` binding). It reads **only the `upload/` prefix** and:
   - `head()`s every manifest entry; any missing → **409 + the list**;
   - streams each object once to verify its **sha256 and size** against the manifest (a mismatch → that file is deleted → 409);
   - **poster:** the first bytes must be JPEG magic `FF D8 FF` (SEC condition 2);
   - **playlists** (SEC condition 3): only **relative** URIs that are in the manifest; no absolute or `//` URI; no `EXT-X-KEY`, `EXT-X-SESSION-KEY`, `EXT-X-SESSION-DATA` or `EXT-X-DEFINE`; `EXT-X-TARGETDURATION` ≤ 6; the summed `EXTINF` per rendition within ±2 s of the declared duration;
   - **init segments (SEC F-D3-17):** it parses `moov/trak/mdia/hdlr` of every `*_init.mp4`. Each video rendition must hold exactly one `vide` and **no `soun`**. The audio rendition must hold exactly one `soun` (and there is none when `has_audio=false`). The master playlist's `CODECS` must agree;
   - **server copy (A1.4, SEC-VID-1):** only after every check passes, it writes the exact bytes it verified to the served key `video/<owner_id>/<video_id>/v<n>/<file>` (re-checking sha256 on the copy) and deletes the `upload/` objects. Nothing the client PUTs later (its URLs live 1 h) can change what viewers get. Any failure → 409, nothing marked. Leftover `upload/` objects are purged by the VID-6 file worker (SEC INFO);
   - **`audio_sha256`** = sha256(`audio_init.mp4` ‖ `audio_*.m4s` in playlist order) of the **served** bytes (§6.1), or none when `has_audio=false`;
   - **attestation (A1.5, F-D1-4 as tightened by SEC):** `attest = hex(HMAC-SHA256(VIDEO_COMPLETE_ATTEST_KEY, "v1|<lane>|<video_id>|<version_no>|<manifest_sha256>|<has_audio>|<audio_sha256 or none>|<issued_at>"))`, minted **after** the checks and the copy, never before;
   - then it calls **`video_mark_uploaded(video_id, version_no, audio_sha256, attest, issued_at)`** as the member. The **only** accepted form is the attested one; the 2- and 3-argument forms are dropped. Before any state change the RPC (internal check function, not callable through the API):
     - rebuilds the message from the **stored row** (lane, video, `current_version`, its `manifest_sha256` and `has_audio`) plus the given `audio_sha256` and `issued_at`; the attested `audio_sha256` must be the one passed;
     - accepts the **current or the previous** vault key; refuses a missing key (**fail closed**), a bad signature, another lane / video / version / manifest / hash, and an `issued_at` older than **15 min** or in the future;
     - covers **every version**, so a remedy (§7, `video_new_version`) is attested by its own `complete` the same way.
     It then sets `state='checking'` (or `ready` at once when the check is Off for this owner, A1.1) and, when On, enqueues the music check.
5. **Abandoned uploads:** `uploading` for more than 48 h → a D1 cron sets `failed` (`abandoned`); a later cleanup deletes the R2 prefix (VID-6).

**Residual (SEC F-D3-15, LOW, accepted with the conditions above):** the video bitstream itself is client-made and the server never decodes it. That is bounded by the byte cap, the per-second ceilings, the playlist and init checks, and the music checker's measured duration (§6). Any harm stays in the uploader's own post.

## 4 · Data model (D1 builds it; names reserved; migration numbers from D1's block)

**Expand only.** `media_objects`, `post_media` and the image path are untouched.

```
videos
  id uuid pk default gen_random_uuid()
  owner_id uuid not null references profiles(id) on delete cascade
  purpose text not null check (purpose in ('post','ad'))
  idempotency_key uuid not null                       -- unique (owner_id, idempotency_key)
  current_version int not null default 1
  state text not null check (state in
        ('uploading','checking','music_blocked','ready','failed','taken_down','deleted'))
  music_check_id uuid references video_music_checks(id)        -- the CLEAN check of current_version
  created_at, updated_at timestamptz not null default now(), ready_at timestamptz
  CONSTRAINT ready_needs_check CHECK (state <> 'ready' OR music_check_id IS NOT NULL)   -- A1-D.3 (as built)

video_versions
  (video_id → videos on delete cascade, version_no int) pk
  manifest_sha256 text not null, total_bytes bigint not null check (total_bytes between 1 and 524288000)
  declared_duration_s numeric(7,2) not null, measured_audio_s numeric(7,2), has_audio boolean not null
  remedy text not null default 'original' check (remedy in ('original','mute','library_track','trim'))
  library_track_id uuid references music_library_tracks(id), trims jsonb      -- [{start_ms,end_ms}] removed
  width int, height int, renditions text[] not null, created_at timestamptz default now()

video_music_checks                       -- append-only: no UPDATE/DELETE policy and no grant
  id uuid pk, video_id uuid, version_no int, provider text not null, attempt int not null,
  verdict text not null check (verdict in ('pending','clean','clean_no_audio','clean_library','match','error','not_required')),
                                         -- not_required = the check was Off for this owner at mark time (A1.1, A1-D.2)
  mode_at_check text,                    -- 'off' | 'on', fixed per version at video_mark_uploaded (A1-D.2); off rows carry provider 'switch_off'
  audio_sha256 text,                     -- sha256 of the exact audio bytes sent to the provider (§6.1)
  matches jsonb,                         -- [{title, artist, score, begin_ms, end_ms}] only; never the raw provider response (SEC N3)
  measured_audio_s numeric(7,2), checked_at timestamptz default now(), next_retry_at timestamptz

music_library_tracks
  id uuid pk, title text, artist text, duration_s numeric, r2_key text,
  license text not null, license_url text not null, attribution text, source text not null,
  provider_fingerprint_ids text[], active boolean default true, added_by uuid, added_at timestamptz

post_videos (post_id pk → posts on delete cascade, video_id → videos on delete restrict)          -- one video per post in v1
ad_videos   (ad_creative_id pk → ad_creatives on delete cascade, video_id → videos on delete restrict)
```

**State machine** (a trigger; these are the only legal moves):

```
uploading ─complete (attested)─▶ checking ─clean* / not_required─▶ ready ─report upheld─▶ taken_down ─new version─▶ uploading (v n+1)
   │      └─check Off for owner: not_required in the same call─▶ ready
   │                   │  ▲               
   │                   │  └─error: retry (stays checking)
   │                   └─match─▶ music_blocked ─new version─▶ uploading (v n+1) │ ─cancel─▶ deleted
   └─48 h─▶ failed
any ─owner or admin video_delete─▶ deleted;  deleted / failed ─30 days─▶ purged (rows + R2 prefix queued)
```

**The publish gate, server-enforced; no admin bypass. The switch (A1.1) only decides whether a version is judged (`on`) or recorded as `not_required` (`off`); it never lets a version skip the gate:**
1. The CHECK `ready_needs_check` on `videos`.
2. **Trigger `tg_videos_ready_guard`** (BEFORE UPDATE), applied to every role **including the service role**. Moving to `ready` requires `music_check_id` → a `video_music_checks` row with:
   - the **same `video_id`** and **`version_no = current_version`**;
   - `verdict in ('clean','clean_no_audio','clean_library')` for an **on** check, or `not_required` for an **off** check (an on check can never close as `not_required`; an off check can never be judged);
   - `audio_sha256` equal to the stored hash of the **current version's served audio rendition bytes** (or no audio with `has_audio=false`). **When on, only the worker's hash binds; a client-supplied hash is never stored** (A1-D.4);
   - for a provider verdict, `measured_audio_s` within ±2 s of `declared_duration_s`.
   A clean result for v1 can never publish v2, and a re-uploaded audio file cannot ride on an old check.
3. **Link triggers** on `post_videos` and `ad_videos`: the video must be `ready` and owned by the post's author (for an ad, uploaded by an admin). This is the same pattern as `trg_post_media_requires_ready`.
4. Feed, profile and ad reads show a video post only while its video is `ready`. `taken_down` hides it at once.
5. No client write path to `state`, `music_check_id`, `video_music_checks` or `audio_sha256`.

**RLS:**
- `videos` / `video_versions`: the owner reads their own rows. Others read only through a link to a post or ad they may already see, and only `ready`.
- `video_music_checks`: the owner reads the verdict and `matches` for their own videos; admins read all of them.
- `music_library_tracks`: signed-in members read `active` rows; admins write through an RPC only.
- "May already see" = **posts RLS (privacy + friends)**; it does **not** include `user_blocks` today (SEC-VID-6, A1-S).
- `ad_videos`: one SELECT path for authenticated; the admin policy is split into INSERT/UPDATE/DELETE (SEC-VID-4, in the F-D1-4 unit).

**What the client may read:**
- **Viewers:** `id · state · width · height · duration · poster url`.
- **The owner, in addition:** the verdict and matches.
- **Never:** the manifest hashes, the idempotency key or `audio_sha256`.

## 5 · Limits (R-97; enforced in `video_begin_upload`; the client checks too, for UX only)

| | member post video | admin video ad |
|---|---|---|
| max duration | **3 min** | **5 min** |
| max size (all renditions + audio + poster) | **500 MB** | **500 MB** |
| per day | **10** per member (rolling 24 h) | **no cap** |
| in progress at once | 3 | 10 |
| who | members passing `feature_allowed('video_posts')` | admins only, and only when `feature_allowed('video_ads')` |
| placement | the feed, as a normal post | the existing story-card positions **2, 5, 10, 15, then every 10** |
| interaction | like / comment / share | **like / comment / share, exactly as a normal post** (VID-5 builds the ad side) |

A remedy (§7) makes a new **version** of the same video; it does not count as a new upload.

## 6 · Copyright music: built complete, shipped Off, switched per member (A1.1, R-102/R-103)

**Which videos are checked:** a version is checked when `feature_allowed('copyright_music_check', owner)` is true **at `video_mark_uploaded`** (mode `on`); otherwise it is recorded as `not_required` (mode `off`) and publishes with any audio, its audio hash stored so the check can be applied later. Posts **and** ads follow the same rule. The mode of a version never changes after it is fixed.
- **Ships Off** on both lanes (seeded `off`, staging verified after run #153).
- **Selected members / All members is refused unless vault `music_check_api_key` is present and non-empty** (FEATURE-003); the member list may be prepared while Off.
- **Key removed while On:** an `on` version waits in `checking`; the worker can only record errors. **Never published unchecked.**
- Until D1's `music-check` Edge Function ships (A1-D.12): Off publishes; On waits in `checking`.

Everything below (§6.1–§7) applies to **`on`** versions only.

### 6.1 · What is checked (SEC F-D3-17)

- **The check covers the audio rendition's own segments:** `audio_init.mp4` + `audio_*.m4s`, concatenated, which is the exact byte stream the player serves.
- `music-check` computes `audio_sha256` over those bytes and stores it with the result. The §4 gate compares it with the current version.
- **No side file is ever checked.** Because the video renditions are proven video-only at `complete` (§3.4), there is no other audio a viewer could hear.

### 6.2 · The flow

1. The attested `video_mark_uploaded` (§3.4) sets `checking` and inserts `video_music_checks(verdict='pending', attempt=1, mode_at_check='on')`. It wakes `music-check` by event, the same pattern as P5-b, not a tight cron. The worker reads its queue from `music_check_due(n)` and the 6-hour alert list from `music_check_overdue()`, and writes results only through `music_check_record_result` (service_role only).
2. **`music-check` (D1) decides the verdict:**

   | situation | verdict |
   |---|---|
   | no audio rendition and `has_audio=false` (proven by the init parse) | **`clean_no_audio`** |
   | the provider finds no match | **`clean`** |
   | every match is in `music_library_tracks.provider_fingerprint_ids` | **`clean_library`** |
   | any other match with score ≥ 70 (the tunable floor of ACRCloud's 70–100 band; a threshold, not a switch) | **`match`**, with title, artist and **begin/end ms** in our audio (ACRCloud: `sample_begin_time_offset_ms` / `sample_end_time_offset_ms`) |

   - It records the provider-measured duration in `measured_audio_s`.
   - When there is no audio, it records the declared duration, already bounded by the §3 ceilings.
3. **Clean** → in one transaction it sets `music_check_id` and `state='ready'`; the gate validates it. Any pending post in the outbox (OFF-5 §2 row 2) then publishes.
4. **Match** → `state='music_blocked'`, a notification, and the §7 screen. **Nothing is published.**
5. **Checker unavailable** (timeout, 5xx, 429, network, quota):
   - the verdict is `error` and **`state` stays `checking`**;
   - `next_retry_at` follows **1 m → 2 m → 5 m → 15 m → 30 m, then every 30 min, indefinitely**;
   - the member sees "**Checking music… we'll post it automatically**";
   - after 6 h of errors admins get an alert (VID-6 channel) and the member sees "Still checking — this is on our side". They can still cancel;
   - **there is no timeout that leads to publishing.**
6. **Cost:** one paid check per **on** version, accepted in R-97; nothing is paid while Off. VID-6 counts checks per day against a budget alert.

## 7 · When music is found

### 7.1 · Vendor (Owner to confirm)

**Recommended: ACRCloud File Scanning.** It returns title, artist, a score from 70 to 100, and the begin/end offsets inside the submitted audio; the "trim" choice needs those offsets.
- **Alternatives:** Audible Magic (the industry standard; higher cost and a contract) or AudD (cheaper).
- `music-check` speaks one internal shape: `{verdict, matches[{title,artist,score,begin_ms,end_ms}], measured_s, audio_sha256}`. A vendor change touches one adapter.

### 7.2 · The blocked screen

The screen says "**This video has copyrighted music, so it can't be posted yet**", shows the matched title and artist, marks the matched range(s) on a timeline, and offers four choices:

| choice | what the device makes | `remedy` | then |
|---|---|---|---|
| **Remove sound** | the same video renditions, **no audio rendition** | `mute` | `complete` proves there is no `soun` anywhere → re-check → `clean_no_audio` |
| **Replace with a free track** | a new audio rendition from a track picked in the in-app library (trimmed or looped to the length, volume set) | `library_track` + `library_track_id` | re-check: a match on that track → `clean_library`; any other match still blocks |
| **Trim the matched part** | cuts each matched range (± 0.5 s) out of the video and audio; shows the new length; offered only if ≥ 3 s remain | `trim` + `trims` | re-check; leftover music blocks again with the new ranges |
| **Cancel** | — | — | `deleted`; the R2 prefix is purged; the draft returns to the composer without the video |

The choices can be combined. **Every new version goes through §3 → §6 again; nothing skips the check.**

### 7.3 · The free in-app library

- **Licence rule:** only tracks whose licence **explicitly permits use in member videos inside an app, including commercial use, with no per-use fee**. Each track carries `license`, `license_url`, `source` and `attribution`, and the attribution is shown under the post automatically.
- **Who adds tracks:** admins only, through an audited RPC. Each track is run through `music-check` once at ingest, so its fingerprint id(s) are recorded (SEC N4).
- **Unclear licence:** the track stays out.
- **Target:** ≥ 30 tracks before launch. This is an Owner task, with the sources chosen by the Owner.

## 8 · The three-mode switch (VID-7): `video_posts`, `video_ads` **and `copyright_music_check`** (A1.1, A1.2)

```
feature_access          (feature text pk: 'video_posts' | 'video_ads' | 'copyright_music_check',
                         mode text not null default 'off' check in ('off','selected','everyone'), note, updated_by, updated_at)
feature_access_members  (feature, user_id → profiles on delete cascade, added_by, added_at, pk (feature,user_id))
                         -- kept whatever the mode (A1-D.6)
feature_access_audit    (append-only by trigger: id, at, actor, feature, action in ('mode','add','remove'), old_value, new_value, user_id, note)
```

- **Labels in the app, exactly:** **"Off"** / **"Selected members"** / **"All members"** → stored `off` / `selected` / `everyone`.
- **Seeded:** all three rows `off`. With every switch Off the app behaves exactly as today.
- **`public.feature_allowed(feature text, uid uuid) returns boolean`:** STABLE, SECURITY DEFINER, `search_path=''`, **internal (no API EXECUTE)**. `mode='everyone'`, or `mode='selected'` and uid is in members.
  - It is called **inside `video_begin_upload`, `video_mark_uploaded`, the link triggers and the ad path: that is the enforcement point.**
  - The client reads **`feature_allowed_me(feature)`** (own access only) to show or hide a button.
- **Admin RPCs:** `feature_set_mode`, `feature_add_member`, `feature_remove_member` (admin only, FEATURE-001; one audit row in the same transaction; a no-op writes none). **`feature_set_mode('copyright_music_check', 'selected'|'everyone')` is refused (FEATURE-003) unless vault `music_check_api_key` is present and non-empty.** The tables have no grants for API roles.
- **Admin → Features page (D2, A1.2):** one card per feature (from `feature_admin_state()`) with the 3-mode selector; "Selected members" shows a member search (`feature_member_search(q)`: name, @username or email) with avatar + name + username and "Add"; chips of added members with "Remove"; optional note; Save; key state for the copyright card; the last 50 changes under each card. Example (R-103): Copyright music check → Selected members → "Neil Basu" → Add → Save ⇒ only Neil's new videos are checked.
- **No release needed, within 60 s (R-103):** enforcement is **immediate** — every server path reads the switch at call time. The client re-reads `feature_allowed_me` at app start and on return to the foreground (no polling timer — the D2 skill's timer rule); a button shown from a stale read is refused by the server, and the client then hides it.
- **Switching `video_posts` / `video_ads` off:** stops new uploads and new links. `ready` videos stay; takedown is VID-4.
- **Switching `copyright_music_check`:** affects only versions marked after the change (the mode is fixed per version).
- **Gate before any non-Owner switch (A1.5, F-D1-4):** until the attested `video_mark_uploaded` is applied on the lane **and** the attest key is set in vault and Pages, `video_posts` may be on only for the Owner's own account, and `video_ads` and `copyright_music_check` stay Off. D1's PROBE (A3) goes red if a video switch is on while the key is missing.

## 9 · Playback via the CDN host (VID-3's input)

1. **Where the videos live:** under **`video/`** in the lane's media bucket, served at **`cdn.50mmretina.com`** (production) and **`cdn-staging.50mmretina.com`** (staging), through the **D-003 `media-authz` Worker** (`docs/D003_AUTHORIZED_DELIVERY_SPEC.md`).
   - **`video/` is a restricted prefix:** no token, no bytes.
   - **R2 public access must be off for `video/`.** That makes D-003's Worker a **launch prerequisite for VID**; without it, video does not ship.
   - The CDN host is a separate hostname with no app cookies, which meets SEC condition 2's "cookieless media host".
2. **`POST /api/video/play-token {video_id}`** (Pages Function, **as the viewer**). It reads the row through RLS:
   - if it is visible and `ready`, the function returns `{master_url, poster_url}` carrying a **prefix token**: HMAC-SHA256 with `MEDIA_TOKEN_KEY` over `prefix=video/<owner>/<id>/v<n>/ \n exp \n sub=viewer uid \n aud=<cdn host>`;
   - **`exp` = 15 min**, refreshed silently by the player (SEC N1: shorter than the earlier 2 h);
   - otherwise it returns **404, never 403**;
   - **blocks (SEC-VID-6):** posts RLS does not apply `user_blocks`. If the Owner wants a block to stop playback (§13 Owner opens #6), `play-token` also returns 404 when either member has blocked the other.
3. **The `media-authz` Worker on `video/`:**
   - verifies the token, the prefix match, `exp` and `aud`;
   - checks a small **revoked-videos list** (KV, written by the takedown RPC path), so a `taken_down` video stops within seconds, not at token expiry (SEC N1);
   - rewrites the playlists so each segment URL carries the same token;
   - **serves a fixed Content-Type by extension, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'`** (SEC condition 2).
4. **Caching:** segments are immutable. The Worker caches them **only after the token check**, under a **token-free cache key** (`caches.default`), and returns `Cache-Control: private, max-age=31536000, immutable` to the client. Playlists get `max-age=60`.
   - This refines D-003 §4's "never cache restricted", whose risk was a token in a shared cache key. The Worker runs before the cache lookup, so no request reaches the cache without a valid token. **SEC to confirm** in the D2 build PR.
5. **Offline (R-97 / OFF-8):** prefetch **as much as the OFF-4 budget allows, at least the first 25 s (7 segments) of the 240p rendition** of each feed video, plus its audio segments. The **oldest are evicted first** inside the shared OFF-4/OFF-7 budget, and **everything is wiped on sign-out** (OFF-5 G6). A prefetched video still needs a valid token when it was fetched; offline playback serves from the device store.
6. **The 9:16 card (A1.3, R-105; D2 `src/lib/video/videoFrame.ts`):** every video card — feed, profile, upload preview, posts **and** ads — is **9:16** (portrait). A video within 1 % of 9:16 fills it edge to edge. Any other shape is shown **whole** (`object-contain`, never cropped), centred, over a **blurred, enlarged copy of the same video** filling the rest (top-bottom for wider, sides for narrower). The poster follows the same rule while loading. **The upload preview is the posted card.** Photos keep `imageFrame.ts` (4:5 … 1.91:1) unchanged. The fill is drawn by the player only; no file is changed (§2).

## 10 · Report copyright

- **Where:** "**Report copyright**" is in the post menu of every post with a video and every video ad. It is **QUEUED** offline (OFF-5 §2 row 15).
- **What it writes:** `post_reports` with `reason='copyright_music'` and `details` (≤ 500 characters). D1 confirmed on staging (05:42 UTC) that `reason` has **no CHECK constraint**; VID-4 may add a closed list (NOT VALID, then validate). Ads go to the `reports` path with the same reason. One report per member per post (unique).
- **The admin queue (VID-4):**
  - It shows the report plus the stored `video_music_checks` for that version.
  - **Upheld** → `state='taken_down'` (hidden at once and added to the Worker's revoked list); the owner is notified and may fix it through §7 as a new version, which is re-checked.
  - **Dismissed** → closed, and the reporter is told.
  - Every action is audit-logged.
- **Optional fast lane** (Owner yes/no): 3 reports in 24 h → `taken_down` pending review. **Only reporters whose accounts are at least 14 days old count** (SEC N2: brigading), with an admin restore.

## 11 · Lane split and Owner actions

| part | owner |
|---|---|
| tables, CHECK, state + ready-guard + link triggers, RLS, RPCs (owner from `auth.uid()`, EXECUTE to `authenticated` only), `feature_allowed` (+ `_me`, admin page RPCs), crons, `supabase/functions/music-check`, the `post_reports` reason · **the attested `video_mark_uploaded` + SEC-VID-4 split (F-D1-4 unit, one T1 PR)** | **D1** (T1: SEC reviews) |
| device encoder plugin, `functions/api/video/{upload-urls,complete,play-token}.ts` (**upload/ prefix + server copy, attest mint**), outbox kind `video_upload`, composer, **9:16 card + blurred fill**, blocked-music screen, library picker, Report copyright, **Admin → Features page (3 cards)**, prefetch, the `video/` branch of `media-authz` | **D2** |
| the D-003 `media-authz` Worker live on both CDN hosts with R2 public access off for `video/` · bucket CORS (PUT from the lane origins) · the R2 write token (Pages) + read token (Supabase) · `MEDIA_TOKEN_KEY` · **`VIDEO_COMPLETE_ATTEST_KEY` per lane, the same value in Pages and vault `video_complete_attest_key`** · a music-API account + key (only when the check is to leave Off) · ≥ 30 licensed library tracks | **Owner** |
| web fMP4/HLS muxer, Capacitor encoder plugin | D2, **dependency window** (Auditor) |

## 12 · Proof (R-82: CI/harness tests, each shown failing first)

1. **Publish gate:** `UPDATE videos SET state='ready'` without a clean check fails, **service role included**. A clean check of v1 cannot make v2 ready. An `audio_sha256` mismatch cannot reach ready.
2. **Match blocks:** a fixture `match` → `music_blocked`, and the `post_videos` insert fails. A `mute` version → `clean_no_audio` → ready → the link succeeds.
3. **Checker down:** the fixture provider returns 503 three times → still `checking`, 3 error rows, never ready. The 4th call is clean → ready.
4. **Library track:** a match on a library fingerprint → `clean_library`; another match in the same audio → `match`.
5. **Ads are checked:** an ad video with `match` cannot be linked in `ad_videos`.
6. **(SEC F-D3-17 a)** A version with a `soun` track inside a video rendition is **rejected at `complete`**.
7. **(SEC F-D3-17 b)** An audio rendition whose bytes differ from the checked bytes cannot reach `ready`.
8. **(SEC F-D3-15, 1–4):**
   - a file name outside the allow-list gets no URL;
   - a non-JPEG poster → 409;
   - a playlist with an absolute URI or `EXT-X-KEY` → 409;
   - an over-ceiling bytes/s is refused by the RPC;
   - `/v/` responses carry nosniff + CSP sandbox + a fixed type.
9. **(SEC F-D3-15, 5)** The RPC called with NULL `auth.uid()` (anon) → refused; EXECUTE is absent for anon/PUBLIC.
10. **Presigned URL:** a PUT with a different Content-Type or Content-Length → 403. An expired URL → 403; the outbox fetches a new one and completes.
11. **Resume:** half the files uploaded, network killed, reload → `complete` returns 409 with exactly the missing files → those are sent → `checking`. One object per file in R2.
12. **Idempotency:** the same key twice → one `videos` row.
13. **Switch:** `off` → `video_begin_upload` is refused for a member even with a crafted request. `selected` → only listed members. One audit row per change.
14. **Playback:**
    - a viewer who cannot see the post → `play-token` 404;
    - a token for video A is rejected on video B's prefix;
    - expired → 403 at the Worker;
    - `taken_down` → 403 within seconds via the revoked list;
    - R2 public access for `video/` → 403 without a token.
15. **Offline:** after a prefetch, an offline device plays ≥ 25 s of the 240p rendition; sign-out leaves 0 video bytes.
16. **Report:** a "Report copyright" made offline is delivered once online, exactly once.

**Added by A1 (each failing first):**

17. **Check switch (A1.1):** Off → a video with music publishes as `not_required` with its hash stored; Selected/All members **refused without the key** (FEATURE-003) and accepted with it; Selected (Neil) → Neil's match → `music_blocked`, another member publishes at the same moment; key removed while On → `checking`, never ready; an on check cannot close `not_required`; one audit row per change. *(D1 `vid7`/`vid4` transcripts, both lane shapes — met in #380.)*
18. **Mode fixed per version:** switching the check On or Off after `video_mark_uploaded` does not change that version's outcome.
19. **Server copy (A1.4):** no URL is ever issued for a `video/…` key; a PUT to `upload/` after `complete` does not change the served bytes; the served audio hash equals the one passed to the RPC.
20. **Attest (A1.5, SEC fail-first set):** no attest / tampered / other lane / other video / other version / other manifest / other `audio_sha256` / `issued_at` > 15 min or in the future / attest key missing → refused with no state change; the **previous** key still accepted; a remedy version needs its own attest; the 2- and 3-argument forms no longer exist; fail-first shows a made-up hash reaching `ready` before the unit. Both lane shapes.
21. **9:16 card (A1.3):** a 16:9, a 3:4, a 9:16 and a 1:2 source each render in a 9:16 card, whole, with no crop; fill top-bottom / top-bottom / none / sides; the upload preview and the posted card have identical geometry; photos still render 4:5 … 1.91:1. *(D2 `videoFrame.test.ts` + a UI-harness scene.)*
22. **SEC-VID-4:** `ad_videos` shows exactly one permissive SELECT policy for `authenticated`.

## 13 · Findings and open items

- **F-D3-15** (LOW, SEC-accepted with conditions) and **F-D3-17** (MEDIUM, SEC) are both designed in, at §3, §6.1, §9 and §12.6–9.
- **F-D3-16** is CLOSED by D1 (staging, 05:42 UTC): no CHECK on `post_reports.reason`.
- **F-D3-18:** VID depends on D-003's `media-authz` Worker, which is **not live**. Ruling R-104: D2 proves it live on staging (curl evidence) in its first video PR. As of #382 (staging `070132a`) the video endpoints answer 503 until `VIDEO_DELIVERY_PRIVATE=1`, so nothing is served before the Worker is live.
- **F-D3-22 (new, MEDIUM, for D1 + SEC):** D1's attest build (`d1/VID-2-upload-attest` `eeb11993`, not pushed, 2026-10-05 12:30) signs `video-complete:v1:<video>:<version>:<audio_sha256|none>`. SEC's tightening (15:19, same day) requires **lane, manifest_sha256, has_audio and issued_at** in the message, a **≤ 15 min** age, **current + previous key**, and remedies covered. A1.5 freezes SEC's shape; D1 rebuilds to it before opening the PR, and D2's `complete` signs the same string.
- **Owner opens:**
  1. the music vendor (needed only before the check leaves Off);
  2. the fast lane yes/no;
  3. one video per post in v1, confirm;
  4. the library tracks and their sources;
  5. **(SEC-VID-5)** a remedy version of a `music_blocked` video re-reads the switch, so if the check was turned Off in between it publishes as `not_required`. Keep (default, as built) or make it sticky ("a version born from a blocked one is always checked")?
  6. **(SEC-VID-6)** should a block between two members stop video playback? Default as built: no (same as photos); yes → `play-token` applies it (§9.2).
- **Sources read 2026-10-05:**
  - Cloudflare R2 docs: presigned URLs support PUT, last up to 7 days, work only on the S3 endpoint and not on custom domains, and enforce a signed `Content-Type`; the Workers API `put` supports a `sha256` integrity check.
  - ACRCloud File Scanning music fields: `sample_begin/end_time_offset_ms`, `score` 70–100.
  - `docs/D003_AUTHORIZED_DELIVERY_SPEC.md`, `docs/D003_CLOUDFLARE_HANDOVER.md`.
