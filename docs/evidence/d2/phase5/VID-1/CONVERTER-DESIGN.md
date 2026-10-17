# VID-1 · Server-side conversion on a FREE Oracle VM — design v2

**Date:** 2026-10-12 · **Status:** DESIGN v2: the independent review's required changes are folded in. Database part written: `supabase/migrations/20261012_0002_vid1_converter_sources.sql` (+ rollback, PROBE; PGlite behaviour 67/67). · **Owner rulings:** A3.2 (no time limit, 500 MB, FREE only). A3.3 is superseded: the Owner created an Oracle Cloud account ("do all needful on behalf me") and said "okay go on".
**Review:** independent design review, verdict **SOUND-WITH-CHANGES** (2026-10-12). Every required change (HIGH 1–4, MEDIUM 5–8, LOW 9) is addressed below and tagged **[R1]**…**[R9]**.
**Amendment A1 (2026-10-13):** which streams are converted, HDR tone mapping, the FFmpeg sandbox as a root-owned template unit, and the poster follow-up — §10. Where §3 or §6 disagrees with §10, §10 applies.

## 1 · Why
The web encoder converts in REAL TIME on the member's device and pauses whenever the tab is hidden. A 7:28 video takes about 7½ minutes with the tab in front (Owner, 2026-10-12: "since last one hour this is processing… can't test anything"). Phones run out of memory on long videos (A4.7). Formats a browser cannot decode (HEVC in Firefox, AVI, ProRes…) cannot be posted at all.

A free Oracle Always Free VM (Ampere A1, 4 OCPU / 24 GB, Mumbai) converts a 1080p three-rendition ladder at **about 2.9× real time** (measured: 150 s of video in 51 s, plus 4 s for audio). The member uploads the ORIGINAL once and may then close the tab.

## 2 · The rules that shape everything
1. **The VM holds no R2 key, no attestation key and no service role.** Pages mints every presigned URL with the R2 binding it already has. The VM's output goes through the SAME gates as a member's device:
   - `upload-urls` — presigned PUT to `upload/video/…` only (SEC-VID-1);
   - `complete` — batched verify, server-side copy to `video/…`, strict judge, attestation in Pages (F-D1-4);
   - `video_mark_uploaded` — HMAC attestation, music check, READY.
2. **What a compromised VM could do, stated honestly.** There is ONE converter identity, so a stolen VM token can:
   - claim queued jobs;
   - read the originals of the jobs it claims;
   - upload a well-formed package for a claimed job. The judge checks structure, not content.

   It can NOT:
   - touch any other object, any other video, or a member's device-path video ([R2]);
   - mint READY without Pages' attestation;
   - **publish anything**: the member publishes, after seeing the result ([R-Q2], §3 step 9).

   Theft alarms: refresh-token rotation with Supabase reuse detection, plus an alert when the VM stops refreshing or heartbeating ([R8]).
3. **The member publishes.** Publishing stays client-side, through the existing SECURITY INVOKER `video_publish_post`. A SECURITY DEFINER "publish as the owner" would test the converter, not the owner, for ban / account-live / feature checks. It also cannot work with the music check, because READY arrives later. And the member's preview-then-publish step is the control against a VM substituting content.

## 3 · Flow
1. **Member** (app in "server conversion" mode) picks any video ≤ 500 MB, plus the optional cover, caption, categories and privacy as today. Then `rpc video_source_begin(purpose, source_bytes, idempotency_key)` returns a `source_id`. Inside the database, it checks:
   - the owner's feature switch, ban and account (`video_owner_may` — stricter than `video_begin_upload`, which checks only the switch);
   - **`video_conversion = 'server'` for the lane — refused otherwise [R7]**;
   - **at most 2 open sources per member [R7]**;
   - the daily and in-progress caps, **counted over device videos AND sources together, each upload once [R5]**.
2. **Member** sends `POST /api/video/source-url {source_id}`. Pages answers with ONE presigned PUT for `upload/source/<source_id>/source` (the URL is minted only after the owner check): content-length = declared bytes, content-type fixed to `application/octet-stream`, valid 1 h [R-Q4]. The upload shows progress and can be resumed by asking again.
3. **Member** sends `POST /api/video/source-complete {source_id}`. The Function `head`s the object (size == declared, ≤ 500 MB) and records its **ETag** [R6]. Then `rpc video_source_uploaded` sets the status to `queued`. The member may close the app.
4. **VM worker** — a systemd service polling every 10 s, backing off when idle. It signs in as the dedicated converter user (§4, [R9]) and calls `POST /api/video/convert/claim`.
   - The Function verifies the JWT, then calls `rpc video_source_claim()`. The claim takes **the next source in round-robin order by owner, oldest first [R7]**, using FOR UPDATE SKIP LOCKED. It sets a fresh `claim_token`, a 30-min lease and attempts + 1 (at most 3).
   - **One live claim at a time** (enforced in the database; a second claim is refused). A queued job whose owner was switched off or banned is failed (`not_allowed`), never handed out.
   - Pages **re-HEADs the original** (the member's `video_source_uploaded` is not trusted for the ETag), then returns the job and a presigned **GET pinned to the recorded ETag** (signed `If-Match`) [R6]. A missing or changed original fails the job as `source_missing` (final). The GET's lifetime never exceeds the remaining lease [R2].
5. **VM: convert, in an isolated FFmpeg sandbox (§6, [R1])**.
   - Download with a hard byte cap (= declared size).
   - `ffprobe` under limits. Reject anything that is not exactly one video stream with at most one audio stream. Also reject: duration > 15 h (at ~2.9× real time a longer one could not finish inside a claim's 6 h ceiling; refused as `too_long`), resolution > 4096 on either side, fps outside 1–120, attached_pic, or data/subtitle streams. ***Amended A1 (§10.1):*** *extra video/audio/data/subtitle streams and cover pictures are now allowed and ignored; the video and audio streams are chosen and mapped by index.*
   - `planLadder()` (shared code) picks the renditions and bitrates.
   - FFmpeg settings:
     - `-protocol_whitelist file`, with an explicit demuxer allow-list (mov/mp4, matroska/webm, avi, mpegts, 3gp) and **no hls, concat or subfile**;
     - `-map 0:v:0 -map 0:a:0?`, `-map_metadata -1`; ***A1 (§10.1):*** *`-map 0:<index>` of the chosen streams instead, plus `-sn -dn`;*
     - libx264 baseline, keyframes every 2 s (`-force_key_frames expr:gte(t,n_forced*2)`);
     - fragmented MP4 (`-movflags +frag_keyframe+empty_moov+default_base_moof`, 4 s fragments), `-maxrate/-bufsize` = rendition bitrate × 1.2 / × 2;
     - AAC 96 kb/s as a separate rendition.
     - ***Amended A1 (§10.2):*** *an HDR source (PQ, HLG or BT.2020) is tone-mapped to SDR BT.709 8-bit.*
   - Poster = the member's cover if they uploaded one, else the frame at 1 s. ***A1 (§10.4):*** *for now always the frame; the member's cover in server mode is a recorded follow-up.*
   - Then `packageFromFragmented()` — the browser's own packager (`src/lib/video/hlsPackager.ts`, split out on branch `d2/VID-converter-core-20261012`) — does the naming (`240p.m3u8 / 240p.mp4 / 240p_<n>.m4s …`), the playlists (shared `mediaPlaylist()/masterPlaylist()`, never FFmpeg's own text, so they match the strict grammar of #411), the manifest and the sha256 hashes.
   - The VM runs `judgeUploadContent` itself before uploading, to fail fast.
   - It calls `rpc video_source_heartbeat(source_id, claim_token)` every 2 min while working; the lease is extended only while the token and status still match [R2], and a claim lives at most **6 h**.
6. **VM** calls `rpc video_converter_begin_version(source_id, claim_token, manifest_sha256, total_bytes, declared_duration_s, has_audio, rendition_bytes)` [R5]:
   - owner and purpose are taken **from the source row only**;
   - it re-checks the owner's switch, banned and account-live;
   - **one video per source**: unique `video_sources.video_id`; the video's idempotency key is the attempt's **claim token** (unique per attempt, never chosen by the VM);
   - **a retry returns the existing video** (same manifest) or refuses if the manifest differs;
   - it creates the `videos` row and version 1 through `video_validate_version`.
7. **VM** calls `upload-urls`, then `complete`, both on the **converter path**:
   - the Functions accept the converter JWT only when **`video_converter_version(video_id, version_no, claim_token)`** returns the row [R2] (it replaces `video_upload_info` on this path). That means:
     - the caller is the converter account;
     - a `video_sources` row has `video_id = _video_id`;
     - `claim_token` matches;
     - status is `converting`;
     - the lease is live.
   - Otherwise exactly the member rules apply.
   - Presigned PUTs live no longer than the remaining lease.
   - The converter reads its row data through that RPC; `videos` RLS and `video_upload_info` are NOT widened.
   - `complete` signs the attestation as today.
   - `video_mark_uploaded`'s converter branch checks the feature switch **against `_v.owner_id`**, not the caller [R3].
8. Music check, then READY, as today. The source row becomes `done` with its `video_id`.
9. **Publishing ([R-Q2]):** the member's app (job store) sees `done`, shows the READY video for a preview, and the member taps **Post**. The app calls the existing `video_publish_post` with the caption, categories and privacy saved with the job. For ads, it calls the existing admin `linkAdVideo`. If the member never comes back, the unposted video stays theirs, under their uploads, as it does today.
10. **Failures:** `rpc video_source_fail(source_id, claim_token, code, detail)`. `code` is one of a fixed list (`internal`, `unsupported_format`, `no_video`, `too_long`, `too_big`, `damaged`, `source_missing`); the member reads **fixed text** for it, never the VM's words (`detail` goes to the audit trail only). `internal` is retried while attempts remain; the others are final. A failure reported after `complete` went through ends the job as `done`. **`video_source_cancel(source_id)`** lets the member stop a queued or converting job [R8].
11. **Cleanup [R-Q4]:**
    - Pages deletes the source object with its R2 binding when one of its Functions sees the job end:
      - success or failure reported through `convert/finish`;
      - an unusable original at `convert/claim`;
      - a cancel through `source-cancel`.

      **Not on account deletion, and not when the database itself ends a job** (the upload or queue timeout, a lapsed last lease). No code deletes the object then; the lifecycle rule below is the only remover. *(Corrected 2026-10-12, review of #419 L3; see `R2-LIFECYCLE-staging.md` §6.)* The VM gets no DELETE URL.
    - Backstop: a free R2 lifecycle rule expires `upload/video/` after 2 days and `upload/source/` after **8 days**. An original can be needed for about **181 h** after its PUT:
      - up to 24 h before it is queued;
      - up to 48 h in the queue, three times, because every requeue restarts `queued_at`;
      - two requeued attempts of under 6 h each;
      - it is last read at the start of the third attempt.

      8 days is 192 h, so an original is never removed while its job can still run (review #417 finding 4). *(Corrected 2026-10-12, review of #419 M1: the earlier "4 days" counted one requeue only. The derivation is in `R2-LIFECYCLE-staging.md` §1. Live on staging since 2026-10-12T16:59:54Z.)*
    - The VM wipes its job directory after every job and never logs presigned URLs.
    - The media-authz Worker never serves `upload/` (already true; asserted in its test).

## 4 · Database (D1, T1: migration + rollback + PROBE + independent review)

Independent review of #416 (CHANGES-REQUIRED, all fixed): every source counts for the day whatever happens to it (cancel never frees the cap); one upload counts once however many attempts (converter-made videos carry `videos.converted_from`); an open source counts once even if its half-made video is deleted; the converter account cannot use the device path; one live claim; claims skip switched-off/banned owners; fixed member text for failure codes; queued jobs time out after 48 h; the rollback refuses to overwrite later bodies; the PROBE checks constraints, the replaced functions' grants, the cron command and the service role's health read.

- `public.video_sources`, with columns:
  - id (uuid PK), owner_id, purpose (post | ad), idempotency_key (the member's);
  - source_bytes ≤ 524288000, source_etag;
  - status: awaiting_upload | queued | converting | done | failed | cancelled;
  - attempts, claim_token (uuid), lease_until, video_id (UNIQUE, NULL);
  - error, created_at, updated_at.

  RLS: the owner reads their own rows, with no column grant on claim_token. There are no client writes except through RPCs.
- `public.video_source_events` — append-only audit (source_id, at, actor, event, detail). INSERT only through the RPCs; no UPDATE or DELETE grant [R8].
- **`public.video_converter_accounts(user_id PK)`**, written only by migration. It replaces the earlier idea of adding an `app_role` enum value: an enum value cannot be rolled back, cannot be used in the same transaction, and would show up in role pickers. The RPCs check `EXISTS (select 1 from video_converter_accounts where user_id = auth.uid())`. The PROBE asserts at most one row and that this user holds NO `user_roles` row [R9]. 20261012_0002 leaves the table EMPTY (every converter function refuses); a separate provisioning migration lists the user once it exists, and marks its profile **banned and hidden**, so the existing banned policies refuse its posts and comments — that migration's PROBE checks it.
- RPCs:
  - member: `video_source_begin`, `video_source_uploaded`, `video_source_cancel`;
  - converter: `video_source_claim`, `video_source_heartbeat`, `video_converter_begin_version`, `video_converter_version` (the claimed video's facts for upload-urls/complete — the may-act check), `video_source_fail`, `video_source_done`;
  - change: the converter branch of `video_mark_uploaded` (owner's switch, [R3]).
- Account deletion: the existing account-deletion path removes `video_sources` rows (ON DELETE CASCADE from the owner). Nothing deletes their objects: `delete-my-account` and `delete-user` contain no video code, and the housekeeping sweep purges rows, not objects. The lifecycle rules are the only remover: originals after 8 days, `upload/video/` parts after 2 days [R8]. *(Corrected 2026-10-12, review of #419.)*
- Housekeeping: its own cron job, every 5 min (`video_source_housekeeping`); the existing health check reads `video_converter_health()` as the service role:
  - expired leases go back to `queued` (attempts + 1), and become `failed` after 3;
  - `done`, `failed` and `cancelled` sources are purged after 2 days;
  - **alerts**: the VM heartbeat is older than 10 min while jobs are queued, or the oldest queued job is older than 30 min [R8].

## 5 · Pages Functions
- New:
  - `source-url`, `source-complete` (member; source-complete records the ETag);
  - `convert/claim` (converter; ETag-pinned GET, lifetime ≤ lease);
  - `convert/finish` (converter: done / fail with a code; deletes the original only after the database accepted the claim and ended the job).
  - Heartbeat, begin_version: the VM calls the RPCs directly through PostgREST with its JWT (no Pages endpoint needed).
- Changed: `upload-urls` and `complete` accept the converter path only through `video_converter_version(video_id, version_no, claim_token)`.
- The attestation key stays in Pages, unchanged.

## 5b · Notes from the independent review of #417 (APPROVE-WITH-NITS)
- `convert/claim` reads the lane's configuration before taking a claim, and hands a claim back at once (`fail 'internal'`, requeued) if anything fails after it — a claim is never stranded for 30 minutes (finding 1, fixed).
- The signed `If-Match` on the source GET is correct SigV4, but R2's enforcement on a presigned GET is not yet proven: a **staging smoke test** before go-live — GET with the header 200, without it 403, after an overwrite 412. The VM also compares the response's ETag with `job.source_etag` and stops at the declared byte count (finding 2).
- A member's source PUT URL stays valid for its hour; overwriting after queueing only fails their own job; an orphan after cancel is removed by the 8-day rule (finding 3, accepted; was "4-day", corrected 2026-10-12).
- A source GET URL is not re-issued for a held claim: a VM that restarts mid-download fails the job as `internal` (one attempt) (finding 6, accepted).

## 6 · The VM [R1]
- Ubuntu 24.04 aarch64, unattended security upgrades, ~~Ubuntu Pro (free for personal use) enabled, so `universe` FFmpeg gets security patches. Without Pro, the fallback is~~ a pinned static FFmpeg build with CVE tracking.
  - ***Amended (§10.5, owner ruling R-VM-1, 2026-10-13):*** *no paid or chargeable process, so Ubuntu Pro is not used. What this section called the fallback is the design: a pinned, sha256-verified official static FFmpeg build, updated by Claude against published security advisories through a reviewed pull request.*
- SSH only from the Owner's IP (OCI security list), key-only. No inbound port; the worker is outbound-only.
- **Two identities.** The worker (Node 22) runs as `converter`, which owns the refresh token (file 0600). Every ffprobe/ffmpeg runs as a **separate transient systemd unit** (`systemd-run --uid=ffjob`, or DynamicUser) with:
  - `PrivateNetwork=yes`, `InaccessiblePaths=/var/lib/converter/secrets`, `ReadWritePaths=` = that job's directory only;
  - `NoNewPrivileges`, empty `CapabilityBoundingSet`, `PrivateDevices`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`, `ProtectKernelTunables/Modules/Logs`, `ProtectControlGroups`, `RestrictNamespaces`, `RestrictSUIDSGID`, `LockPersonality`, `SystemCallFilter=@system-service`, `MemoryMax`, `CPUQuota`, `TasksMax`;
  - `RuntimeMaxSec` = 3 × video length + 10 min.
  - ***Amended A1 (§10.3):*** *not a transient `systemd-run` unit — the same properties in a root-owned template unit, `converter-ff@<job>.service`, which polkit lets `converter` only start or stop.*
- Job directory: a **size-capped filesystem** (a loop-mounted 4 GB ext4), one sub-directory per job, wiped after each job.
- One job at a time (also enforced in the database). The worker keeps its current claim token on disk (0600) so a restart can `fail` or finish the job instead of waiting out the lease.
- Oracle may reclaim an IDLE Always Free instance (under about 20 % CPU/network/memory for 7 days), and Ampere capacity in Mumbai is often unavailable. That is acceptable **best-effort only**:
  - the jobs live in the database;
  - the admin switch falls back to device mode;
  - the queue-age alert shows when the VM is gone;
  - the re-create script runs from the Owner's PC (OCI API).
  - No fake load is generated to dodge reclamation.

## 7 · Bucket separation proof [R4]
`s3-presign-upload` signs PUTs (host-only signature, no length cap) for any path containing the caller's uid. If its token could write the video bucket, a member could overwrite served bytes after attestation, which would defeat SEC-VID-1 today, converter or not.
- **Staging:** the `s3_storage_settings` bucket ≠ `50mm-staging-video`, and its token is scoped to that other bucket. Evidence: a PUT signed with the photo token to `50mm-staging-video` is refused (403). Recorded as `docs/evidence/d2/phase5/VID-1/BUCKET-SEPARATION-staging.md`, and re-run as a PROBE step.
- **Production:** the same proof is a precondition of production promotion (a separate production video bucket, new keys).

## 8 · Client
- A lane setting `video_conversion = device | server` (site setting, admin-switchable, **enforced in `video_source_begin`** [R7]).
- Server mode: no in-browser encode. The app uploads the original with progress and says "you can close this page". The job store tracks the source id; when the video is ready, the member previews it and taps Post (§3.9).
- Device mode stays as the fallback, and for the app path.

## 9 · Build order (staging only; production only on the Owner's "go production")
1. D1 migration + rollback + PROBE, then the independent review, then apply to staging (apply-migration.yml).
2. Pages Functions + tests, then review, then merge.
3. VM: the hardened units, the worker (`packageFromFragmented`), ~~Ubuntu Pro~~ the pinned FFmpeg (§10.5). The converter credentials go to the VM with **one Owner double-click** (Claude never sees the secret).
4. Client server mode + job-store states.
5. Bucket separation proof (§7).
6. End-to-end on staging: a 7:28 phone video, an HEVC .mov, an AVI. Each posted from Chrome, Edge and Firefox with the tab closed during conversion, and played back.

## 10 · Amendment A1 (2026-10-13)
**Decided by the session for the Owner: iPhone videos must work and keep their colours.** Implemented in PR #420 (the converter worker, `converter/`). Where §3 or §6 says otherwise, this section applies. The independent reviewer checks the code against it.

### 10.1 Which streams are converted (replaces the stream refusals of §3 step 5)
- **Video:** the first stream whose `codec_type` is video, that is **not** a cover picture (`disposition.attached_pic`) and whose codec FFmpeg knows. It is mapped **by its index** (`[0:<index>]` / `-map 0:<index>`), never `0:v:0`, so a cover picture listed first can never be the one converted. A file with no such stream, including a file that holds only a cover picture, is refused as `no_video`. Video streams whose codecs FFmpeg does not know are refused as `unsupported_format`.
- **Audio:** the stream marked `default`, else the first audio stream, counting only streams whose codec FFmpeg knows. iPhone spatial audio (APAC) is listed by ffprobe as `unknown` and skipped. The chosen stream is mapped by index and streams are never mixed. A file whose audio FFmpeg cannot decode at all gets a version without sound, as the browser path does with sound it cannot decode.
- **Everything else is allowed and ignored:** timed metadata (`mebx`), timecode (`tmcd`), subtitles, attachments, cover pictures and further audio tracks are never mapped. Mapping is explicit, `-sn -dn` is set as well, plus `-map_metadata -1` and `-map_chapters -1`.
- **Still refused** *(as amended by the re-review of #420, N5 — OWNER GOAL "any format, like Instagram": everything a phone records is accepted; what is refused is beyond any camera, and it is refused as "too large", never as "export it as MP4", which would not help)*:
  - width or height above 4096: `too_big`;
  - under 1 fps: `unsupported_format` (not a usable video stream);
  - above 240 fps for a source up to 1920×1080 in either orientation (iPhone slow motion records 240 fps), or above 120 fps above that — so **4K at 120 fps is accepted**: `too_big`. The output stays at most 30 fps (the `fps` filter runs first, so scaling and encoding work at ≤ 30 fps; only decoding sees the source rate). *(Review of #420, M2; re-review N5.)*
  - more than 1,072,300,032 decoded pixels per second (width × height × fps) — just above DCI 4K120 (4096 × 2160 × 120 = 1,061,683,200), so UHD/DCI 4K120 and 1080p240 (497,664,000) pass: `too_big`. *(Review of #420, M2; re-review N5: was 4096 × 2160 × 60 and `unsupported_format`.)*
  - The fps limits and the pixel-rate ceiling carry **1 % slack** (`FPS_SLACK`): a phone's variable-rate file reports an average rate a hair off its nominal one (a 120 fps clip can say 120.04), and a real 120 / 240 fps recording must never be "too big".
  - The work a 4K120 source costs is bounded by the per-run time cap (3 × length + 10 min); one that reaches it is `too_long` (below). Decoding speed of 4K120 HEVC on the Ampere VM is **not yet measured**.
  - longer than 15 h: `too_long`;
  - a conversion that reaches its own time cap (3 × length + 10 min): `too_long`, final rather than retried, because it would reach the cap again. An ffprobe that times out is `damaged`. *(Review of #420, M2.)*
  - no readable size or length, or a length that rounds to 0.00 s (the declared length has two decimals; the database requires it above 0): `damaged`. Only a length above the database's 24 h is `too_long`. *(Re-review N6f.)*
  - a demuxer outside the allow-list, or more than 64 streams (a bound for hostile files): `unsupported_format`.
- **A clip too short for its sound** *(re-review N6f)*: the database's bytes-per-second rule for `audio` (16,384 B/s, no slack) cannot be met by a clip so short that the audio rendition's fixed overhead (its ~700-byte init segment) alone exceeds it (≈ 0.04 s). When the database's arithmetic refuses the package for that reason ONLY, the video is kept and the sound dropped (`has_audio: false`, log `job.audio_dropped`), as the browser path does with sound it cannot use — never a failure.

### 10.2 HDR is tone-mapped to SDR BT.709 (adds to §3 step 5's FFmpeg settings)
- **When:** the source's transfer is PQ (`smpte2084`) or HLG (`arib-std-b67`), or its primaries are `bt2020`. The source is then tone-mapped to SDR BT.709 8-bit **once**, at the largest rendition's size, and the smaller renditions are scaled down from that (as revised after the review of #420; first written as per-rendition):
  `zscale=tin=<src>:pin=<src>:min=<src>:rin=<src>:t=linear:npl=100:p=<src>,format=gbrpf32le,zscale=p=709,tonemap=tonemap=hable:desat=0:peak=<P>,zscale=t=709:m=709:r=limited,format=yuv420p,limiter=min=16:max=235:planes=1,limiter=min=16:max=240:planes=6`
- **Peak and clamp** (review of #420):
  - `<P>` is the content's peak in units of 100 nits. It comes from the file's HDR10 MaxCLL, else the mastering display's peak. Without either, it is PQ's own maximum (10,000 nits, so nothing a PQ file holds can clip) or HLG's nominal 1,000 nits (zscale maps HLG's full signal to about 10.07).
  - Measured on a 10-bit PQ frame with 100 / 1,000 / 2,000 / 4,000-nit bands, the limited-range luma came out as follows. Before the change: 151 / 235 / 247 / 254, so everything from 1,000 nits up was clipped into super-white. After: 138 / 214 / 224 / 231, strictly increasing and all legal.
  - The `limiter` clamps make sure nothing leaves the legal limited range (out-of-gamut colours, scaling overshoot). It runs again after each rendition's scale.
  - A BT.2020 file with an SDR transfer gets the gamut conversion only (`tonemap=clip`: identity up to white).
- **Source description stated explicitly:** the source's transfer, primaries, matrix and range are written into the chain.
  - A value the file does not state takes the HDR default: BT.2020 primaries, the BT.2020 non-constant-luminance matrix, limited range.
  - For a file with BT.2020 primaries but no PQ/HLG transfer, the transfer defaults to BT.2020's SDR curve.
  - `p=` is repeated on the first zscale because zscale takes any output property not stated from the frame. With an untagged frame that fails with "no path between colorspaces" (measured).
- **Tags and poster:** the outputs are tagged `bt709` (`-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv`). The poster goes through the same chain.
- **SDR sources are untouched:** no tone mapping, no tags added.
- **What FFmpeg must have:** `zscale` (libzimg) and `tonemap`. The pinned static build (§10.5) has both; its installer refuses a build without them, and the converter workflow checks them again before its tests.
  - The worker's start-up self-test also converts an HDR-tagged source, so a VM whose FFmpeg lacks them claims nothing.
  - CI converts a synthetic 10-bit PQ / BT.2020 HEVC source and checks that every rendition is 8-bit BT.709 and that the package passes the judge with no problems.
- **Dolby Vision (iPhone):** the HLG-compatible base layer is converted; the Dolby Vision metadata is ignored.

### 10.3 The FFmpeg sandbox is a root-owned template unit (amends §6)
- **Why the change:** §6 runs every ffprobe/ffmpeg as `systemd-run --uid=ffjob -p …`. But the worker runs as the unprivileged user `converter`. Starting a **transient** unit is polkit's `org.freedesktop.systemd1.manage-units` action, with no unit name or properties a rule could inspect. A grant would therefore let a stolen worker start any unit, with any properties, **as root**: the compromised-VM case of §2 would become root on the VM.
- **What replaces it:** the same properties live in the root-owned `converter/deploy/converter-ff@.service`.
  - The polkit rule `50-converter-ff.rules` lets `converter` only `start` or `stop` units named `converter-ff@<uuid>.service`.
  - The worker hands over *what* runs in `<job>/.run/{tool,args,timeout}`.
  - `ffjob-run` (root-owned, inside the sandbox) runs only the pinned `/opt/converter/ffmpeg/current/bin/ffmpeg` or `…/ffprobe` (§10.5; first written as `/usr/bin/…`).
- **Time cap:** `RuntimeMaxSec` (3 × length + 10 min) has no effect on `Type=oneshot`, so it becomes `ffjob-run`'s `timeout` (at most 6 h, a claim's ceiling). `TimeoutStartSec` is the backstop.
- **Extra hardening** beyond the §6 list: `MemoryDenyWriteExecute`, `IPAddressDeny=any`, `RestrictAddressFamilies=AF_UNIX`, `PrivateIPC`, `ProtectClock`, `ProtectHostname`, `ProtectProc=invisible`.
- **The worker unit itself** (`converter.service`) is hardened too, including `NoNewPrivileges` and `RestrictSUIDSGID`. Its job directories get their set-group-ID bit by inheritance from the jobs root, never by request.
- **Proof:** on systemd 255, the converter workflow's `sandbox-check.sh` shows:
  - the polkit grant works, and no other unit or verb is allowed;
  - the secrets and the worker's state are unreadable from inside a run;
  - a run has no network and cannot write outside its own job directory;
  - the time cap ends an endless run;
  - the self-test passes under the real `converter.service`.
- **Smaller note:** the secret on the VM is the converter account's email and password in a 0600 file. The worker keeps its Supabase session (and the rotating refresh token) in memory only; §6 spoke of a refresh-token file.

### 10.4 Known follow-up: the poster in server mode
§3 step 5 says the poster is "the member's cover if they uploaded one, else the frame at 1 s". The claim carries no cover, so for now the converter always uses the frame at min(1 s, duration/2). **Follow-up:** bring the member's chosen cover into server mode, for example as a cover object stored beside the original that the claim hands out.

### 10.5 FFmpeg is a pinned static build, not Ubuntu's (owner ruling R-VM-1, amends §6)
**Owner ruling R-VM-1 (2026-10-13): no paid or chargeable process. Ubuntu Pro is NOT used.** Ubuntu's own `ffmpeg` is in `universe`, whose security fixes come only through Ubuntu Pro — so Ubuntu's `ffmpeg` package is not used and not installed, and §6's fallback becomes the design: a pinned, checksum-verified official static FFmpeg build, updated by Claude against published security advisories.
- **The build:** one official static GPL build from BtbN/FFmpeg-Builds, release line 9.0, pinned in `converter/deploy/ffmpeg.pin`:
  - release `autobuild-2026-09-30-13-08`, version `n9.0.2-17-g2a571b6068` (FFmpeg tag n9.0.2 plus 17 commits of branch `release/9.0`, commit `2a571b606854520cf89804d8030c8b328e621689`; BtbN's build scripts at commit `6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b`);
  - `aarch64` (the VM): `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n9.0.2-17-g2a571b6068-linuxarm64-gpl-9.0.tar.xz`, sha256 `91afcd7695d4bbbb9e0057aa10baaf9875ec4e1a97303f9059ec971336a2ab46`;
  - `x86_64` (CI): `…/ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0.tar.xz`, sha256 `68ee646831adaae2495618346f3bba94ff207ff83bbd34d643e7004730d66269`.
  - The sha256 values were checked three ways on 2026-10-13: BtbN's published `checksums.sha256` for the release, the digest GitHub reports for each asset, and hashing both downloaded files.
  - The last autobuild of a month is pinned because BtbN keeps that one for **two years** (daily builds for 14 days; their README, "Release Retention Policy"), so the exact file stays downloadable; a pin must never be left to grow that old.
- **What changed from FFmpeg 6.1 to 9.0 for the converter (found by CI on the first run with the pinned build, both architectures):** FFmpeg 9 writes the colour transfer and primaries it finds **on the frames**; the `-color_trc` / `-color_primaries` output options alone no longer tag a file (measured with the same command: 6.0 wrote `smpte2084` / `bt2020`, 9.0.2 wrote `unknown`). The self-test made its HDR source with those options only, so on 9.0.2 the source was not HDR and the self-test — which gates every start of the worker — failed. The source is now tagged on its frames (`setparams`, `selftest.ts` `HDR_TAG_FILTER`), which both versions honour. Members' videos were not affected: the converter's own outputs get their BT.709 tags from `zscale`, which sets them on the frames (the real-FFmpeg HDR test checks every rendition's tags, and passes on 9.0.2). Nothing else in the converter's test suite differed between the two versions.
- **The pin is checked before it is used:** the release must be a dated `autobuild-…` tag (never the moving `latest`), and the URL must be exactly BtbN's release download of that tag and file over HTTPS, or the installer refuses.
- **Install** (`ffmpeg-lib.sh`, used by `setup.sh` and `update-ffmpeg.sh`, as root): HTTPS-only download (or a supplied copy) → **refused unless the sha256 is the pinned one** → only `ffmpeg`, `ffprobe` and the build's `LICENSE.txt` extracted, installed `root:root` under `/opt/converter/ffmpeg/<version>-<arch>/`, with a `SOURCE` file (URL, sha256, source commits) → refused unless it has `zscale`, `tonemap`, `limiter`, `libx264`, `libx265` → `/opt/converter/ffmpeg/current` swapped atomically (`ln -sfn` + `mv -T`; the old one becomes `previous`). `ffjob-run` runs only `current`.
- **Update** (`update-ffmpeg.sh`): the same install, then (with `converter.service` stopped) the worker's self-test through the real sandbox with the new build; on success the pin is recorded and only `current` + `previous` are kept; on failure `current` and `previous` are put back as they were, the failed build removed, and the script exits 1. The worker is restarted either way if it was running.
- **The worker sets its own umask (0007).** Job directories must be group-writable for the FFmpeg runs (user `ffjob`, group `convjob`). The unit sets `UMask=0007`, but the update script runs the worker's self-test outside the unit, under root's mask (022): the directories came out 0750 and every FFmpeg run ended "killed" — found by CI the first time the update path ran, on both architectures. The worker now sets the mask itself at start (`job.ts` `setWorkerUmask`, called first in `main.ts`), so it behaves the same inside the unit, from `update-ffmpeg.sh`, and from a manual `node worker.mjs --selftest`.
- **CI** installs the same pinned build the same way on `ubuntu-24.04` and `ubuntu-24.04-arm` (GitHub's arm64 runner, free for a public repository) and runs the full real-FFmpeg suite, `setup.sh`, `sandbox-check.sh --selftest`, the real update path, the refusals (a pin naming another URL; a file whose sha256 is not the pin's — and the same file accepted once its sha256 is right) and a rollback against it.
- **Security tracking (R-VM-1: Claude, the working session — no Owner action):** at least monthly, and whenever an FFmpeg CVE is published, Claude reads FFmpeg's security page (https://ffmpeg.org/security.html) and the NVD list for FFmpeg against the pinned version; a fix in a newer point release or on the release branch → a PR that updates `ffmpeg.pin` → independent review → CI on both architectures → `update-ffmpeg.sh` on the VM. The sandbox (no network, no secrets, one job directory, syscall filter, memory and time caps) limits what an FFmpeg bug could reach; it does not replace the update. **Not automated:** nothing alarms by itself when the pin grows old; the monthly check is a procedure.
- **Licence obligations of the build (checked 2026-10-13).** The build is **GPL version 3**: it is configured `--enable-gpl --enable-version3` (read from the x86_64 binary), holds libx264 and libx265, and ships the GPL v3 text as `LICENSE.txt`. It is not a `nonfree` build.
  - Running a GPL program is unconditional; the GPL's duties (give the licence, offer the complete corresponding source) attach to handing a copy to someone else. The converter only runs FFmpeg on our own VM, as a separate program started by the worker (nothing is linked into our code), and members receive converted videos, which the licence does not cover. So nothing has to be published and our code's licence is unaffected.
  - Kept anyway, so the copy is always accompanied by its licence and source: `LICENSE.txt` beside the binaries, and `SOURCE` naming the download URL, sha256, FFmpeg's source commit and BtbN's build-scripts commit (which name every bundled library and version). The installer refuses a build without `LICENSE.txt`; CI checks both files.
  - Rules that keep it that way: the binaries are never committed, never uploaded as a CI artifact (only `worker.mjs` is) and never shipped in the app; handing them to a third party would bring the source-offer duty and needs a decision first; a `nonfree` build is never pinned (CI refuses one).
  - BtbN's build scripts are MIT-licensed; only their published output is used. BtbN's README sets no further condition on using the builds. Patent licences for H.264/HEVC are a separate matter, the same whichever FFmpeg build encodes, and are not changed by this choice.
- **Everything else** on the VM comes from Ubuntu's main archive, whose security fixes are free; `setup.sh` checks that `unattended-upgrades` is on and warns if not. The earlier marker file and worker warning about FFmpeg security updates (review of #420, M4) are removed with the dependency they watched.

### 10.6 Notes from the re-review of #420 (APPROVE-WITH-NITS), as implemented
- **N1:** `sandbox-check.sh` writes its InaccessiblePaths probe and changes the directory modes **as user `converter`** (the directories are converter's): root never creates, chmods or writes through a name in a converter-writable directory.
- **N2:** `converter-ff@.service` has `OOMPolicy=kill`. A run that ends with 137 (SIGKILL) counts as the time cap only when it lasted at least the cap handed over; earlier it is `killed` (→ `internal`, retried), never `too_long`.
- **N3:** `sandbox-check.sh --selftest` refuses while `converter.service` is running (a `start` would then be a no-op returning 0), and proves each check ran in THIS start: the worker's own result line (`"event":"worker.selftest"` / `"worker.netcheck"` with `"ok":true`) must be in the journal after a cursor taken just before the start. (First written against the unit's start time and exit status; CI showed those read zero once a finished oneshot is unloaded, so that check failed although everything had run and passed.)
- **N4:** `CONVERTER_R2_BUCKET` is required. A presigned URL outside the lane's R2 host/bucket pin ends that job (`fail internal`, requeued) and the worker **stops claiming** with an `ALERT` log and exit status 4, which `converter.service` does not restart (`RestartPreventExitStatus=4`): a misconfiguration must not fail every member's job.
- **N5 (Owner: "accept 4K120" — any format the phone records):** 4K at 120 fps is accepted; what remains refused for frame rate or pixel rate is beyond any camera and ends `too_big`, never `unsupported_format` (§10.1).
- **N6:**
  - a/b/c — the setup message names every value to fill in; the `pro status` reading and its marker are gone with Ubuntu Pro (§10.5); `setup.sh` checks that unattended upgrades are on and warns if not.
  - d — the network check has a positive control (outside the unit, the same user can reach 169.254.169.254 where it exists; where it does not, the script says so instead of claiming proof).
  - e — a member's cancel (a lost claim) neither counts toward nor resets the internal back-off streak.
  - f — a clip too short for its sound keeps its video and loses the sound; a length that rounds to 0.00 s is `damaged` (§10.1). The database rule's lack of an allowance for init segments stays a D1 follow-up.
  - g — a refresh answered 429 / 408 is transient (the refresh token is kept, no theft alarm).
