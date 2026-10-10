# VID · upload screen + upload pipeline (D2, first video PR)

**Rule.** VID-1 `docs/evidence/d2/phase5/VID-1/DECISION.md` (signed, #376) §2, §3, §5, as ruled by R-97/R-100/R-102/R-103/**R-104**:
- upload screen: preview in the **9:16 video card** — **Owner, 2026-10-05, in this session: "all videos must be 9:16 … any other size must be fit in our card — same process as Instagram"**, which supersedes R-100/R-104's photo-frame rule *for video only* (photos unchanged) — **CategoryChips 1–5 required**, limits **3 min / 500 MB**;
- **SEC-VID-1** (condition of this PR): upload to an upload prefix; `complete` copies server-side; the client never PUTs to the served key;
- **F-D3-18** (first video PR): prove the media-authz Worker is live on staging (curl);
- dependency window (video only): one web fMP4/HLS muxer, pinned, MIT/Apache/BSD, lazy chunk only.

Server side is D1's #378–#380 (VID-7/VID-2/VID-4): `video_begin_upload`, `video_mark_uploaded`, `feature_allowed_me`, the publish gate and the link triggers.

## Design
| Piece | File | What it does |
|---|---|---|
| Shared rules | `src/lib/video/shared/{rules,mp4,playlist,judge}.ts` | Pure, no aliases, imported by the app AND the Functions: file allow-list (SEC cond. 1), content types, **`upload/video/…` vs `video/…` keys**, canonical manifest + sha256 version id, D1's `rendition_bytes`, upload order, ISO-BMFF reader (`hdlr`, fragment durations), playlist builder + judge (SEC cond. 3), `judgeUploadContent` (SEC cond. 2, 3, F-D3-17). |
| `POST /api/video/upload-urls` | `functions/api/video/upload-urls.ts` | As the member (their JWT; no service role). Owner + `uploading` + manifest sha = the DB's. Stores the canonical manifest server-side. One SigV4 presigned PUT per missing file, **key under `upload/video/` only**, 1 h, signs content-type, content-length, host, x-amz-checksum-sha256. |
| `POST /api/video/complete` | `functions/api/video/complete.ts` | Presence → size + sha256 (a mismatch deletes the upload object) → `judgeUploadContent` → **copies each file to `video/…` itself, re-verifying each hash as it copies** → `video_mark_uploaded(video, version, audio_sha256)` with audio_sha256 = sha256(audio.mp4 ‖ audio_n.m4s), VID-1 §6.1. |
| F-D3-18 guard | `functions/api/video/_lib.ts` `requirePrivateDelivery` | Both endpoints answer **503 VID-ENV-002** until the lane sets `VIDEO_DELIVERY_PRIVATE=1`, i.e. until the media host stops serving `upload/` and `video/` without a token. |
| Web encoder | `src/lib/video/webEncoder.ts` + `hlsPackager.ts` (lazy chunk `webEncoder-*.js`, 41 KB with mp4-muxer) | Audio decoded whole → AAC; video frames captured in real time → per-rendition scale → H.264, keyframe every 2 s; 240p always, 480p/720p only at or below the source (no upscaling); poster at 1 s; each rendition muxed alone (one `vide` / one `soun`); ~4 s segments; durations read back from the fragments. No H.264/AAC encoder → "Video upload isn't supported in this browser — use the app." |
| Device job | `src/lib/video/uploadJobs.ts` + `jobDeps.ts`, `components/video/VideoUploadBridge.tsx` (lazy) | IndexedDB `retina-video-uploads` (job + every encoded file): begin → PUT missing → complete → wait for the check → **post + link**. Both idempotency keys made once at creation (video key → `video_begin_upload`; post key → `posts_user_idempotency_key`, 23505 read back). Back-off, paused offline, per member, **wiped on sign-out**. |
| Video card | `src/lib/video/videoFrame.ts` | The card is always **9:16**. A 9:16 video (±1 %) fills it; any other shape is fitted **whole** (`object-contain`, never cropped), centred, the rest filled by a blurred, enlarged copy of the same video (Instagram's treatment) — above/below for wider videos, at the sides for narrower. |
| Upload screen | `components/video/VideoPostComposer.tsx`, `VideoPostButton.tsx` | Button shown only when `feature_allowed_me('video_posts')` (re-read every 60 s and on focus, R-103); composer lazy-loaded. Preview in the 9:16 card (height capped at 62 % of the screen so the form stays reachable). Limits said before encoding. Post off until 1–5 categories. |

## Proof (R-82: guard shown failing first + synthetic test)
| Kind | File | Result |
|---|---|---|
| Functions vs fake R2 + fake Supabase | `src/lib/video/__tests__/videoFunctions.test.ts` (16) | SigV4 reproduces **AWS's documented presigned-URL example** byte for byte. Every URL is `upload/video/…`; nothing under `video/` until `complete`; **a re-PUT after `complete` leaves the served bytes unchanged**; missing → 409 + list; mismatch → deleted + 409; video init with `soun` / audio init without one / absolute URI / `EXT-X-KEY` / non-JPEG poster → 409; 503 while delivery is public. |
| Device job, end to end against the REAL handlers | `src/lib/video/__tests__/uploadJobs.test.ts` (8) | Link drops after 5 PUTs → resumes, **no file uploaded twice**; offline → nothing sent; replayed begin → 1 video; publish retried after a lost answer → **1 post**; refusal → `failed`, said; music match → parked; per member; sign-out wipe. |
| Packager | `src/lib/video/__tests__/hlsPackager.test.ts` (6) | VID-1 §2 file set, 4 s segments, server rules pass, `vide`/`soun` split, muted = no audio codec, upload order, no upscaling. |
| Upload screen + card | `src/components/video/__tests__/VideoPostComposer.test.tsx` (5), `src/lib/video/__tests__/videoFrame.test.ts` (4) | 9:16 fills the 9:16 card with no fill layer; 16:9 fitted whole (`object-contain`) in the same 9:16 card with the blurred fill; Post off until a category; 4:00 and 600 MB refused before encoding; fill axis per shape. |
| **Mutants (fail first)** | `mutants.txt` | **13 / 13 caught**: presign the served key · complete does not copy · no `hdlr` check · absolute URIs allowed · poster not checked · uploads while public · new video key per attempt · post key not read back · photo frame instead of 9:16 · non-9:16 with no fill · Post without categories · no length limit · mismatch not deleted. |
| **Real browser** | `tools/uishot/video-encode-harness.mjs`, CI `d2-video-encode.yml` → `encode-harness.json` | Real Chromium encodes a real 1280×720 video with sound → 14 files, **240p/480p/720p + separate audio**; a 360×640 one with "remove sound" → 240p only, no audio. Both: `judgeUploadContent` + manifest rules **0 problems**, every hash matches, every rendition under its ceiling, **ffprobe opens master.m3u8** with the expected streams. VP9+Opus via the test seam (Playwright's Chromium has no H.264/AAC encoder). |
| UI gate | scenes `video-composer-landscape`, `video-composer-portrait` | 8 shots, 0 problems; axe clean (0 nodes). |
| **F-D3-18** | `F-D3-18-curl.txt` | **NOT live.** No-token requests to `video/…`, `upload/video/…`, `private/…` on cdn-staging and cdn → R2's own HTML 404, no 403; control: a real object → **200 to anyone**. Hence the 503 guard above. |

## Dependency (window R-104)
`mp4-muxer` **5.2.2**, exact, **MIT**; deps `@types/dom-webcodecs`, `@types/wicg-file-system-access` (types only). In `package-lock.json` and `bun.lock`. Loaded only in the lazy `webEncoder` chunk; P13 budget PASS (entry unchanged in kind: no muxer, no encoder in `index-*.js`).

## Declared changes to existing tests
`src/lib/offline/__tests__/signOutWipe.test.ts`: the wipe result gained `videoUploads`; the two exact-shape expectations now include `videoUploads: true`; one new test proves the jobs and their files are emptied. Nothing weakened.

## Findings
- **F-D2-24 · Owner ruling to record (R-105?):** video card = 9:16 for every video, fitted not cropped (this PR). VID-1 §9/VID-3 and R-100's "same frame as photos" need D3's amendment; the feed player PR follows the same rule.
- **F-D2-22** · VID-1 is inconsistent with itself: §3's allow-list (SEC cond. 1) admits `(_\d{1,4})?` only, so `240p_init.mp4` is refused, while §2/§6.1 say `*_init.mp4`. Built to the regex (the security condition): init = `<rendition>.mp4`, audio init = `audio.mp4`. → D3's amendment; D1's music worker hashes `audio.mp4 ‖ audio_n.m4s`.
- **F-D2-23** · a video post is written as two statements (insert `posts`, then `post_videos`), each idempotent by key; between them a text-only post exists for a moment. An atomic `post_publish_with_video` RPC (D1) would remove that window.
- **F-D3-18** · media-authz Worker not live (above). Owner/Cloudflare action before any video is uploaded on a lane.

## What the lane needs before uploads open (Owner / Cloudflare, none in the repo)
Pages env per lane: `MEDIA` (R2 binding to the lane's media bucket), `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_UPLOAD_KEY_ID` + `R2_UPLOAD_KEY_SECRET` (one bucket, Object Read & Write), bucket CORS (PUT from the lane origin + Capacitor origins, headers content-type + x-amz-checksum-sha256), the media-authz Worker live → then `VIDEO_DELIVERY_PRIVATE=1`. `video_posts` stays **Off** until then.
