# VID-1 · Server-side conversion on a FREE Oracle VM — design v2

**Date:** 2026-10-12 · **Status:** DESIGN v2: the independent review's required changes are folded in. Database part written: `supabase/migrations/20261012_0002_vid1_converter_sources.sql` (+ rollback, PROBE; PGlite behaviour 67/67). · **Owner rulings:** A3.2 (no time limit, 500 MB, FREE only). A3.3 is superseded: the Owner created an Oracle Cloud account ("do all needful on behalf me") and said "okay go on".
**Review:** independent design review, verdict **SOUND-WITH-CHANGES** (2026-10-12). Every required change (HIGH 1–4, MEDIUM 5–8, LOW 9) is addressed below and tagged **[R1]**…**[R9]**.

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
   - `ffprobe` under limits. Reject anything that is not exactly one video stream with at most one audio stream. Also reject: duration > 15 h (at ~2.9× real time a longer one could not finish inside a claim's 6 h ceiling; refused as `too_long`), resolution > 4096 on either side, fps outside 1–120, attached_pic, or data/subtitle streams.
   - `planLadder()` (shared code) picks the renditions and bitrates.
   - FFmpeg settings:
     - `-protocol_whitelist file`, with an explicit demuxer allow-list (mov/mp4, matroska/webm, avi, mpegts, 3gp) and **no hls, concat or subfile**;
     - `-map 0:v:0 -map 0:a:0?`, `-map_metadata -1`;
     - libx264 baseline, keyframes every 2 s (`-force_key_frames expr:gte(t,n_forced*2)`);
     - fragmented MP4 (`-movflags +frag_keyframe+empty_moov+default_base_moof`, 4 s fragments), `-maxrate/-bufsize` = rendition bitrate × 1.2 / × 2;
     - AAC 96 kb/s as a separate rendition.
   - Poster = the member's cover if they uploaded one, else the frame at 1 s.
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
- Ubuntu 24.04 aarch64, unattended security upgrades, **Ubuntu Pro (free for personal use) enabled**, so `universe` FFmpeg gets security patches. Without Pro, the fallback is a pinned static FFmpeg build with CVE tracking.
- SSH only from the Owner's IP (OCI security list), key-only. No inbound port; the worker is outbound-only.
- **Two identities.** The worker (Node 22) runs as `converter`, which owns the refresh token (file 0600). Every ffprobe/ffmpeg runs as a **separate transient systemd unit** (`systemd-run --uid=ffjob`, or DynamicUser) with:
  - `PrivateNetwork=yes`, `InaccessiblePaths=/var/lib/converter/secrets`, `ReadWritePaths=` = that job's directory only;
  - `NoNewPrivileges`, empty `CapabilityBoundingSet`, `PrivateDevices`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`, `ProtectKernelTunables/Modules/Logs`, `ProtectControlGroups`, `RestrictNamespaces`, `RestrictSUIDSGID`, `LockPersonality`, `SystemCallFilter=@system-service`, `MemoryMax`, `CPUQuota`, `TasksMax`;
  - `RuntimeMaxSec` = 3 × video length + 10 min.
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
3. VM: the hardened units, the worker (`packageFromFragmented`), Ubuntu Pro. The converter credentials go to the VM with **one Owner double-click** (Claude never sees the secret).
4. Client server mode + job-store states.
5. Bucket separation proof (§7).
6. End-to-end on staging: a 7:28 phone video, an HEVC .mov, an AVI. Each posted from Chrome, Edge and Firefox with the tab closed during conversion, and played back.
