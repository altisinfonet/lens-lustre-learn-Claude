# Converter VM — deployment

The server-side video converter of `docs/evidence/d2/phase5/VID-1/CONVERTER-DESIGN.md` (v2):
a Node 22 worker on the free Oracle Always Free VM (Ubuntu 24.04 aarch64) that claims a
member's uploaded original, converts it with FFmpeg into the same HLS package the browser
makes, and sends it through the same gates (`upload-urls` → `complete` → `finish`).

**This folder is reviewed in a pull request first. Nothing here has been run on the VM.**

## What runs where

| Piece | Runs as | Can |
|---|---|---|
| `converter.service` — the worker (`/opt/converter/worker.mjs`) | user `converter` | outbound HTTPS to Supabase / Pages / R2; read its credentials; write its claim file and the job space; **start/stop `converter-ff@<uuid>.service` only** (polkit) |
| `converter-ff@<job>.service` — every ffprobe / ffmpeg run | user `ffjob` | read/write **that job's directory only**; no network, no secrets, no capabilities, syscall filter, 12 GB / 3.5 CPU / 256 tasks, time cap |

The VM holds no R2 key, no attestation key and no service role (design §2). The only secret on
it is the converter account's email + password, in
`/var/lib/converter/secrets/credentials.json` (`converter:converter`, `0600`), written by a
separate Owner-run step. The worker refuses to start if that file is readable by anyone else.

### Why a template unit, not `systemd-run` (design amendment A1, §10.3)

The design (§6) names `systemd-run --uid=ffjob -p …`. An unprivileged worker cannot do that:
starting a *transient* unit is polkit's `manage-units` with no unit name or properties a rule
can inspect, so allowing it would let a stolen worker start any unit **as root**. Instead the
same properties live in the root-owned `converter-ff@.service`, and
`50-converter-ff.rules` lets user `converter` do exactly two things: `start` and `stop` a unit
named `converter-ff@<uuid>.service`. The worker hands over *what* to run in
`<job>/.run/{tool,args,timeout}`; `ffjob-run` (root-owned, inside the sandbox) runs only
`/usr/bin/ffmpeg` or `/usr/bin/ffprobe`. The design's `RuntimeMaxSec = 3 × length + 10 min`
is `ffjob-run`'s `timeout` (RuntimeMaxSec has no effect on `Type=oneshot`), capped at 6 h
(a claim's ceiling); `TimeoutStartSec=6h10min` is the backstop.

## Files

| File | Installed at |
|---|---|
| `setup.sh` | run once (idempotent) |
| `sandbox-check.sh` | run after setup: proves the sandbox on this machine |
| `converter.service` | `/etc/systemd/system/` (`@NODE_BIN@` filled in) |
| `converter-ff@.service` | `/etc/systemd/system/` |
| `var-lib-converter-jobs.mount` | `/etc/systemd/system/` — 4 GB ext4 image, `loop,nodev,nosuid,noexec` |
| `ffjob-run` | `/usr/local/lib/converter/ffjob-run` (root, 0755) |
| `50-converter-ff.rules` | `/etc/polkit-1/rules.d/` |
| `converter.env.example` | `/etc/converter/converter.env` (root:converter 0640) — no secrets |

## Deploy (after the PR is reviewed)

1. **Build** on a dev machine or CI, from the repo root:
   ```
   npm ci
   npm run converter:build      # → converter/dist/worker.mjs + worker.mjs.sha256
   ```
2. **Copy** `converter/dist/worker.mjs`, `worker.mjs.sha256` and this `deploy/` folder to the VM
   (e.g. `scp -r` into `~/converter-deploy/`).
3. **Set up** (installs `ffmpeg` and `polkitd` from Ubuntu if missing; Node 22 must already be there):
   ```
   cd ~/converter-deploy/deploy
   sudo bash setup.sh --worker ../worker.mjs
   ```
4. **Configure** `/etc/converter/converter.env`: the lane's site origin, Supabase URL and anon key,
   and the lane's R2 host (`CONVERTER_R2_HOST`, `<account id>.r2.cloudflarestorage.com` — the only
   host a presigned URL may name) and video bucket (`CONVERTER_R2_BUCKET`).
5. **Ubuntu Pro — security updates for FFmpeg (once, by the Owner).** Ubuntu's FFmpeg is in
   `universe`, which gets security fixes only through Ubuntu Pro's `esm-apps`. Pro is free for
   personal use (up to 5 machines):
   1. sign in at https://ubuntu.com/pro and copy your personal token;
   2. on the VM: `sudo pro attach <token>` (type or paste it there; **never** put the token in this
      repository, a file, or a chat), then `sudo pro status` — `esm-apps` must say `enabled`;
   3. run `sudo bash setup.sh` again. It checks `pro status`: without `esm-apps` it prints a loud
      WARNING and writes `/etc/converter/ffmpeg-no-security-updates`, which the worker reports at
      every start ("ffmpeg receives no security updates"); with it, the marker is removed.

   **Fallback** (design §6), if Pro cannot be used: a pinned static FFmpeg build with CVE
   tracking — `ffjob-run` then points at that binary instead of `/usr/bin/ffmpeg`, and someone
   owns following FFmpeg's security announcements and replacing the build.
6. **Check the sandbox** (no credentials needed):
   ```
   sudo bash sandbox-check.sh --selftest
   ```
   Every line must say `PASS`. `--selftest` also runs, under the real `converter.service`
   sandbox, the worker's self-test (synthetic SDR and HDR videos, converted and judged by the
   server's own rules) and its network check: names resolve and HTTPS goes out, while the
   instance-metadata address 169.254.169.254 is unreachable (`IPAddressDeny=link-local`; DNS keeps
   working because the worker asks systemd-resolved at 127.0.0.53 — Ubuntu's default).
7. **Credentials**: the separate provisioning step writes
   `/var/lib/converter/secrets/credentials.json` as `{"email": "…", "password": "…"}`,
   `converter:converter`, mode `0600`. Never print it.
8. **Start**:
   ```
   sudo systemctl enable --now converter.service
   journalctl -u converter.service -f
   ```
   At every start the worker stops any run a crash left behind, sweeps old job directories, runs
   its self-test (and exits if it fails — systemd retries every 30 s), then polls for jobs. Each
   log line is one JSON object; no URL query, token or password is ever logged.

### Updating the worker
`sudo bash setup.sh --worker ../worker.mjs && sudo systemctl restart converter.service`
(a restart ends the current job with `fail internal`, which requeues it).

## Behaviour summary (for the reviewer)

- Polls `POST /api/video/convert/claim` every 10 s; while idle the wait doubles to 60 s.
- One job at a time. The claim is written to `/var/lib/converter/state/claim.json` (0600) before
  any work; a restart ends it with `finish fail internal` instead of waiting out the 30-min lease.
- Heartbeat (`video_source_heartbeat`) every 2 min for the whole job; a refused heartbeat
  (claim gone) stops the job at once.
- Download with the signed `If-Match` sent exactly, at most the declared bytes, ETag and size
  checked (`source_missing` otherwise).
- ffprobe under limits, then stream selection and the remaining refusals (design §3 step 5 as
  amended by A1, §10): the first real video stream (never a cover picture) and the default audio
  stream (else the first), both mapped by index; metadata / timecode / subtitle tracks, cover
  pictures and other audio are ignored.
- FFmpeg: one run for all video renditions (decode once), one for audio, one for the poster;
  H.264 Baseline at the browser's codec strings/levels, keyframes every 2 s, ~4 s fMP4 fragments,
  AAC-LC 48 kHz as its own rendition; `-protocol_whitelist file` and the demuxer allow-list on
  every run over a member's file. Rate control is sized so no rendition can exceed the database's
  bytes-per-second ceiling, short clips included (buffer and maxrate scaled to ceiling × length).
  HDR sources (PQ / HLG / BT.2020) are tone-mapped ONCE at the largest rendition's size to SDR
  BT.709 8-bit (zscale + tonemap hable, peak from the file's HDR10 metadata or PQ 10,000 / HLG
  1,000 nits, clamped to the legal limited range) and tagged bt709; SDR sources are untouched.
- `packageFromFragmented()` (the browser's own packager), then the server's own
  `manifestProblems` + `judgeUploadContent` and the database's own version arithmetic
  (`video_validate_version`, mirrored exactly) before anything is declared or uploaded.
- `video_converter_begin_version` → `upload-urls` → PUTs (with the signed headers) →
  `complete` rounds → `finish done`. The job directory is wiped after every job.
- A run that hits its own time cap ends the job as `too_long` (final, not retried). After a job
  ends `internal` the worker backs off (30 s, 1, 2, 4 min … ≤ 15 min); after 3 in a row it
  re-runs its self-test and claims nothing until it passes.

## Known limits / follow-ups

- The poster is always the frame at min(1 s, duration/2): the claim carries no member cover
  (a recorded follow-up, design §10.4).
- HDR tone mapping needs FFmpeg's `zscale` (libzimg) and `tonemap`; Ubuntu 24.04's FFmpeg has
  both. The start-up self-test converts an HDR-tagged source, so a VM without them claims nothing.
- Tone mapping runs in floating point (once, at the largest rendition's size): HDR conversions are
  slower than SDR ones; not yet measured on the Ampere VM.
- `MemoryDenyWriteExecute=yes` on the FFmpeg runs is proven on x86_64 (CI); on the aarch64 VM the
  start-up self-test is the proof — if it fails there, check `journalctl -u 'converter-ff@*'`.
