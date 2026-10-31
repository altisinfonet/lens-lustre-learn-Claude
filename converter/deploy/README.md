# Converter VM — deployment

The server-side video converter of `docs/evidence/d2/phase5/VID-1/CONVERTER-DESIGN.md` (v2):
a Node 22 worker on the free Oracle Always Free VM (Ubuntu 24.04 aarch64) that claims a
member's uploaded original, converts it with FFmpeg into the same HLS package the browser
makes, and sends it through the same gates (`upload-urls` → `complete` → `finish`).

**This folder is reviewed in a pull request first.** The VM runs two lanes, staging and live — see [Two lanes on one VM](#two-lanes-on-one-vm-staging-and-live-s7).

## What runs where

| Piece | Runs as | Can |
|---|---|---|
| `converter.service` — the worker (`/opt/converter/worker.mjs`) | user `converter` | outbound HTTPS to Supabase / Pages / R2; read its credentials; write its claim file and the job space; **start/stop `converter-ff@<uuid>.service` only** (polkit) |
| `converter-ff@<job>.service` — every ffprobe / ffmpeg run | user `ffjob` | read/write **that job's directory only**; no network, no secrets, no capabilities, syscall filter, 12 GB / 3.5 CPU / 256 tasks, time cap |

The VM holds no R2 key, no attestation key and no service role (design §2). Its secrets are the
converter account's email + password, in
`/var/lib/converter/secrets/credentials.json` (`converter:converter`, `0600`), written by a
separate Owner-run step, and that account's current **refresh token**, in the session file
`/var/lib/converter/state/session.json` (`converter:converter`, `0600`), which the worker keeps
up to date itself ([The persisted session](#the-persisted-session-and-seeding-it-live-captcha)).
The worker refuses either file if it is readable by anyone else.

### Why a template unit, not `systemd-run` (design amendment A1, §10.3)

The design (§6) names `systemd-run --uid=ffjob -p …`. An unprivileged worker cannot do that:
starting a *transient* unit is polkit's `manage-units` with no unit name or properties a rule
can inspect, so allowing it would let a stolen worker start any unit **as root**. Instead the
same properties live in the root-owned `converter-ff@.service`, and
`50-converter-ff.rules` lets user `converter` do exactly two things: `start` and `stop` a unit
named `converter-ff@<uuid>.service`. The worker hands over *what* to run in
`<job>/.run/{tool,args,timeout}`; `ffjob-run` (root-owned, inside the sandbox) runs only
the pinned `/opt/converter/ffmpeg/current/bin/ffmpeg` or `…/ffprobe`. The design's `RuntimeMaxSec = 3 × length + 10 min`
is `ffjob-run`'s `timeout` (RuntimeMaxSec has no effect on `Type=oneshot`), capped at 6 h
(a claim's ceiling); `TimeoutStartSec=6h10min` is the backstop.

## Files

| File | Installed at |
|---|---|
| `setup.sh` | run once (idempotent) |
| `sandbox-check.sh` | run after setup: proves the sandbox on this machine (`--lane live` for the live lane; both lanes against each other) |
| `lane-lib.sh` | the two lanes' names; renders the live lane's units from the staging files |
| `ffmpeg.pin` | the ONE FFmpeg build: release tag, exact URL and sha256 per architecture (x86_64 + aarch64), source commits → `/opt/converter/ffmpeg.pin` |
| `ffmpeg-lib.sh`, `update-ffmpeg.sh` | install / update that build → `/opt/converter/ffmpeg/<version>-<arch>/` (`bin/`, `LICENSE.txt`, `SOURCE`), `current` + `previous` links |
| `converter.service` | `/etc/systemd/system/` (`@NODE_BIN@` filled in) |
| `converter-ff@.service` | `/etc/systemd/system/` |
| `var-lib-converter-jobs.mount` | `/etc/systemd/system/` — 4 GB ext4 image, `loop,nodev,nosuid,noexec` |
| `ffjob-run` | `/usr/local/lib/converter/ffjob-run` (root, 0755) |
| `50-converter-ff.rules` | `/etc/polkit-1/rules.d/` |
| `converter.env.example` | `/etc/converter/converter.env` (root:converter 0640) — no secrets |
| `converter-live.env.example` | `/etc/converter/converter-live.env` (root:converter-live 0640) — no secrets |
| `install-session.sh` | run from here, as root, only to SEED a lane's session (stdin from `converter/tools/seed-session.mjs`) |

## Deploy (after the PR is reviewed)

1. **Build** on a dev machine or CI, from the repo root:
   ```
   npm ci
   npm run converter:build      # → converter/dist/worker.mjs + worker.mjs.sha256
   ```
2. **Copy** `converter/dist/worker.mjs`, `worker.mjs.sha256` and this `deploy/` folder to the VM
   (e.g. `scp -r` into `~/converter-deploy/`).
3. **Set up** (installs `polkitd`, `curl`, `xz-utils` from Ubuntu if missing, and the pinned
   FFmpeg — see below; Node 22 must already be there):
   ```
   cd ~/converter-deploy/deploy
   sudo bash setup.sh --worker ../worker.mjs
   ```
   It also checks that Ubuntu's own security updates are applied automatically
   (`unattended-upgrades`, on by default on Ubuntu 24.04) and warns if not. Nothing here is paid
   or needs a subscription or a token (owner ruling R-VM-1).
4. **Configure** `/etc/converter/converter.env`: the lane's site origin, Supabase URL and anon key,
   and the lane's R2 host (`CONVERTER_R2_HOST`, `<account id>.r2.cloudflarestorage.com` — the only
   host a presigned URL may name) and video bucket (`CONVERTER_R2_BUCKET`, **required**).
5. **Check the sandbox** (no credentials needed; `converter.service` must be stopped — the script
   refuses otherwise, so a running worker cannot make the checks pass without running them):
   ```
   sudo bash sandbox-check.sh --selftest
   ```
   Every line must say `PASS`. `--selftest` also runs, under the real `converter.service`
   sandbox, the worker's self-test (synthetic SDR and HDR videos, converted and judged by the
   server's own rules) and its network check: names resolve and HTTPS goes out, while the
   instance-metadata address 169.254.169.254 is unreachable (`IPAddressDeny=link-local`; DNS keeps
   working because the worker asks systemd-resolved at 127.0.0.53 — Ubuntu's default). The
   positive control runs the same user outside the unit: where the metadata address answers there,
   the unit's refusal is proven to be `IPAddressDeny`'s doing (otherwise it prints a NOTE).
6. **Credentials**: the separate provisioning step writes
   `/var/lib/converter/secrets/credentials.json` as `{"email": "…", "password": "…"}`,
   `converter:converter`, mode `0600`. Never print it.
7. **Start**:
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

### Purge tick (S7-f)
The worker also empties the lane's video purge queue (S7-a: deleted videos' R2 files after the
30-day keep). Once an hour by default it calls `POST /api/video/purge {limit: 5}` on
`CONVERTER_API_BASE` with its own converter session (refreshed by the worker; no pasted token),
**one request per loop turn, before the next job poll** — never inside a job, never during the
self-test — and keeps going while full pages come back, at most 20 requests per tick. A tick ends
early on a page that deleted nothing; any error (401 after the usual refresh-and-retry, 5xx, no
network) is one log line and the next try is an interval later. It never fails a job or stops the
worker. Each tick logs one line, counts only:
`journalctl -u converter.service | grep worker.purge` →
`{"event":"worker.purge","ok":true,"capped":false,"calls":1,"claimed":0,"done":0,"failed":0,"objects":0}`.
Interval: `CONVERTER_PURGE_EVERY_MS` in the lane's env file (default `3600000`; `0` turns it off;
otherwise 60000–86400000). `tools/video-purge/run.mjs` remains for manual / one-off runs.

### If the worker stopped claiming (exit 4)
If a presigned URL ever names another host or bucket than `CONVERTER_R2_HOST` /
`CONVERTER_R2_BUCKET`, the worker refuses it, ends that job (`fail internal`, requeued), logs
`worker.stopped_not_claiming` at level `ALERT`, and exits with status 4. `RestartPreventExitStatus=4`
keeps systemd from restarting it: either the env file is wrong or the lane is handing out
unexpected URLs, and a person must look (`journalctl -u converter.service | grep ALERT`) before
`sudo systemctl start converter.service`.

## Two lanes on one VM: staging and live (S7)

The VM runs **two converter instances side by side**, one per lane. Lane separation is a
security control: neither lane's worker, nor any FFmpeg run of either lane, can read the other
lane's credentials, claim state or members' job files, or start/stop the other lane's runs.
`lane-lib.sh` holds the names; the repository's unit files ARE the staging lane, and
`setup.sh --lane live` renders the live lane's from them (a fixed list of substitutions, tested
by `converter/test/lane.test.ts`).

| | staging (default) | live (`--lane live`) |
|---|---|---|
| worker user / FFmpeg user / job group | `converter` / `ffjob` / `convjob` | `converter-live` / `ffjob-live` / `convjob-live` |
| secrets, state (0700, the worker's) | `/var/lib/converter/{secrets,state}` | `/var/lib/converter-live/{secrets,state}` |
| job space (own ext4 image, `loop,nodev,nosuid,noexec`) | `/var/lib/converter/jobs` (`var-lib-converter-jobs.mount`) | `/var/lib/converter-live/jobs` (`var-lib-converter\x2dlive-jobs.mount`) |
| worker unit / sandbox template | `converter.service` / `converter-ff@.service` | `converter-live.service` / `converter-live-ff@.service` |
| env file (root:\<worker\> 0640, no secrets) | `/etc/converter/converter.env` | `/etc/converter/converter-live.env` |
| worker bundle | `/opt/converter/worker.mjs` | `/opt/converter-live/worker.mjs` |
| API / Supabase / bucket | staging.50mmretina.com / staging ref / `50mm-staging-video` | www.50mmretina.com / `jtdtehuqtinjxropkkcn` / `50mm-video` |

Shared, root-owned, read-only to both: the pinned FFmpeg (`/opt/converter/ffmpeg/current`),
`ffjob-run`, the polkit rule, Node. **What each lane can read:**

- **A worker** reads its own credentials, writes its own state and job space. The other lane's
  directories are 0700 / 2750 to another user and group (file modes), AND its unit has
  `InaccessiblePaths=-<other lane's base>` (staging hides `/var/lib/converter-live`, live hides
  `/var/lib/converter`), so they are invisible even if a mode is ever wrong.
- **An FFmpeg run** (`ffjob` / `ffjob-live`) writes only its own job directory; both lanes'
  secrets and state, `/etc/converter` and the other lane altogether are `InaccessiblePaths`.
- **polkit**: `converter` may start/stop only `converter-ff@<uuid>.service`, `converter-live` only
  `converter-live-ff@<uuid>.service` — never the other lane's (a stolen staging worker cannot
  stop, start or race a live member's run). Each lane's job space is its own mount because the
  worker sweeps its whole jobs root at start-up and stops every stray run of its own prefix: a
  shared one would let one lane wipe the other's jobs.
- `sandbox-check.sh --lane <lane> --selftest` proves all of it on the machine, with positive
  controls (the other lane's probe files are made readable by mode for a moment; outside the
  sandbox they CAN be read, inside they cannot).

Resources: each lane's FFmpeg run keeps its own caps (12 GB, 3.5 CPU); two runs at once can
exceed the VM's 24 GB, so the staging runs carry the higher `OOMScoreAdjust` (500 vs live's 300):
under memory pressure the kernel ends a staging run first (it is requeued).
`update-ffmpeg.sh` stops both workers for the swap and self-tests the new build through BOTH
lanes' sandboxes before keeping it.

### Installing the live lane (after the PR is merged; staging must already be installed)

Needs ~4 GB free disk for the live job space (`df -h /var/lib`). From the copied `deploy/` folder
(with this PR's `worker.mjs` beside it, as in "Deploy" above):

```
cd ~/converter-deploy/deploy
# 1. staging first: the new polkit rule, ffjob-run and staging units (the live lane hidden from it)
sudo bash setup.sh --worker ../worker.mjs
# 2. the live lane: users, dirs, its own 4 GB job space, units, env file from the example
sudo bash setup.sh --lane live --worker ../worker.mjs
# 3. fill in the live env file's two REPLACE values (the live anon key, the R2 account host)
sudoedit /etc/converter/converter-live.env
# 4. prove both lanes, each against the other (both workers stopped while their --selftest runs)
sudo systemctl stop converter.service
sudo bash sandbox-check.sh --selftest
sudo bash sandbox-check.sh --lane live --selftest
sudo systemctl start converter.service
# 5. the Owner-run credentials step for the live account (video-converter@50mmretina.com,
#    registered on production by migration 20261013_0007) writes
#    /var/lib/converter-live/secrets/credentials.json  converter-live:converter-live 0600
# 6. start the live worker
sudo systemctl enable --now converter-live.service
journalctl -u converter-live.service -f
# 7. the live project wants a CAPTCHA for password sign-in: if the log shows auth.reseed_required,
#    seed the session from the Owner's PC (see "The persisted session, and seeding it" below):
#    node converter/tools/seed-session.mjs --url https://jtdtehuqtinjxropkkcn.supabase.co | ssh … sudo bash converter-deploy/deploy/install-session.sh --lane live
```

Re-running `setup.sh` (either lane) changes nothing; it prints `unchanged:` for every file.
Updating the live worker: `sudo bash setup.sh --lane live --worker ../worker.mjs && sudo systemctl restart converter-live.service`.

## The persisted session, and seeding it (live CAPTCHA)

**Why.** The LIVE Supabase project enforces a CAPTCHA (Turnstile) on password sign-in; staging does
not. Nobody can solve a CAPTCHA on the VM, so a live worker that signs in with its password gets
`HTTP 400 captcha_failed` (measured 2026-10-18 01:58Z, `converter-live`). Refresh grants are never
CAPTCHA-gated (supabase/auth `internal/api/middleware.go` `isIgnoreCaptchaRoute`: `/token` with
`grant_type` `refresh_token`, `pkce` or `id_token` skips it), so the worker keeps its refresh token
across restarts instead of signing in again.

**How the worker keeps it** (`converter/src/auth.ts`):

- The file is `CONVERTER_SESSION_FILE` (set in the unit: `<base>/state/session.json`), `0600`, owned
  by the lane's worker, in its `0700` state directory — which is `InaccessiblePaths` for every
  FFmpeg run of both lanes and for the other lane's worker (`lane.test.ts`, `sandbox-check.sh` 3, 3b, 7).
- At start the saved refresh token is tried first; the password is only the fallback.
- Every grant rotates the refresh token. The new one is written (temp file, fsync, rename, fsync the
  directory) **before** the access token is used. A crash can leave the file at most one rotation
  behind, which Supabase accepts on purpose (supabase/auth `internal/tokens/service.go`: the parent
  of the active token, "the client was not able to store the result", gets the active one back).
  If the write fails, nothing is used and no further grant is made until it succeeds: two behind
  would count as reuse and end the session. One process per lane, one grant at a time (single-flight).
- A refused refresh token is cleared from the file (`{"refused_at": …}`) and the password is tried.
  If the password answers CAPTCHA, the worker logs **`auth.reseed_required`** (level `ALERT`), stays
  up (no crash loop, nothing claimed) and makes no further network sign-in for 1, 2, 4 … minutes, at
  most 1 h. It looks at the session file every minute: a newly seeded token is used at once.
- Staging signs in with its password exactly as before; the file just saves a password grant per restart.

**When to seed:** once for the live lane (now), and again only if `journalctl -u converter-live.service | grep reseed_required`
shows the session was lost (revoked, the account's sessions signed out, unused for longer than the
project's session limits, or a refused reuse).

**How to seed** (Owner's PC → VM; Claude writes the click file). The tool needs Node, nothing installed:

```
set SUPABASE_SERVICE_ROLE_KEY=<the LIVE service-role key, read from the Owner's key file>
node converter/tools/seed-session.mjs --url https://jtdtehuqtinjxropkkcn.supabase.co ^
  | ssh -i %USERPROFILE%\.ssh\oracle_50mm_ed25519 ubuntu@<vm> sudo bash converter-deploy/deploy/install-session.sh --lane live
```

- `seed-session.mjs` checks that the key is that project's `service_role` key, that the account
  `video-converter@50mmretina.com` already exists (it never signs one up), then
  `POST /auth/v1/admin/generate_link {type:"magiclink"}` (no e-mail is sent) and
  `POST /auth/v1/verify {type:"magiclink", token_hash}` — neither route carries the CAPTCHA
  middleware (supabase/auth `internal/api/api.go`). It prints **only** `{"refresh_token":"…"}` to
  stdout, refuses if stdout is a terminal, refuses a key on the command line, and never prints or
  stores the key. It changes no password and no other user; the `/verify` call starts one new
  session for the converter account (and marks its e-mail confirmed if it was not).
- `install-session.sh --lane live` (root) accepts only that exact JSON on stdin, stops the lane's
  worker, has the worker user write `state/session.json` `0600` (temp file, sync, rename), checks
  owner and mode, and starts the worker again. The token never appears on a command line or in a log.
- Then: `journalctl -u converter-live.service -n 30` shows `worker.start` and no `auth.reseed_required`.

**If a session file is stolen** it gives a session as the converter account — the same rights as
its password: claim/finish converter jobs on that lane, nothing more (no R2 key, no service role) —
until that session is revoked. Do not count on Supabase's reuse detection to catch it: a token one
rotation behind is accepted by design (the crash-safety case above), so a copy can keep up beside the
worker; only a copy two or more rotations behind is refused and ends the session
(`auth.refresh_refused` in the log). To **revoke** (verified in supabase/auth `internal/api/logout.go`,
`scope=others`): run the seed step with `--revoke-others` — it makes a new session, signs out every
OTHER session of the converter account (the stolen one included) with that new session's own token,
and installs the new one on the VM. Access tokens already issued stay valid until they expire (at
most 1 h). Then find how the file left the VM: only root and the lane's worker user can read it.


## FFmpeg: pinned, and how it is kept up to date

Owner ruling R-VM-1: **no paid or chargeable process.** Ubuntu's own `ffmpeg` package is in
`universe`, which gets security fixes only through a subscription the ruling excludes — so it is
**not used and not installed**. The converter runs ONE official static build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) (GPL, release line 9.0), pinned in
`ffmpeg.pin` by its dated release tag and, for both `x86_64` (CI) and `aarch64` (the VM), the
**exact URL and sha256** of the file. `setup.sh` / `update-ffmpeg.sh`:

- refuse a pin whose URL is not exactly BtbN's release download of that tag and file, or whose
  tag is the moving `latest`;
- download that exact file over HTTPS (or take `FFMPEG_TARBALL`) and **refuse it unless its sha256
  is the pinned one**;
- install only `ffmpeg`, `ffprobe` and the build's `LICENSE.txt`, root-owned, to
  `/opt/converter/ffmpeg/<version>-<arch>/`, with a `SOURCE` file (URL, sha256, source commits);
- refuse a build without the `zscale`, `tonemap`, `limiter` filters or the `libx264`, `libx265`
  encoders;
- point `/opt/converter/ffmpeg/current` at it atomically (the old one becomes `previous`) —
  `ffjob-run` runs only `current`.

CI (`d2-converter.yml`) installs the same pinned build the same way on `ubuntu-24.04` and
`ubuntu-24.04-arm` (free for a public repository) and runs the whole real-FFmpeg suite, the sandbox
check, the update path, the refusals and a rollback against it.

**Updating** (a pull request, never an edit on the VM):
1. Pick the **last autobuild of a month** (`autobuild-YYYY-MM-<last day>-…`) of a supported release
   line. BtbN keeps the last build of each month for **two years** and daily builds for 14 days
   (their README, "Release Retention Policy") — so a month-end file stays downloadable, and a pin
   must never be left to grow that old.
2. Put in `ffmpeg.pin`: the tag; the `linux64-gpl-<line>` and `linuxarm64-gpl-<line>` file names,
   their exact URLs and their sha256 (from the release's `checksums.sha256`, cross-checked with
   the digest GitHub shows for the asset and by hashing the download); FFmpeg's commit (the
   `g<hash>` in the file name, in full) and the commit of BtbN's tag.
3. Open the PR: CI proves the build on both architectures.
4. After merge, on the VM: `sudo bash update-ffmpeg.sh` — verifies, stops `converter.service` (the
   current job is requeued), swaps `current`, runs the worker's self-test through the real sandbox
   with the new build, **rolls back to `previous` if it fails**, keeps only `current` + `previous`,
   and starts the worker again.

**Security tracking (R-VM-1: done by Claude, the working session — no Owner action).** At least
monthly, and whenever an FFmpeg CVE is published, Claude reads FFmpeg's security page
(https://ffmpeg.org/security.html — the CVEs fixed in each release) and the NVD list for FFmpeg
(https://nvd.nist.gov/vuln/search?query=ffmpeg) against the pinned version. A fix in a newer
point release or on the release branch → Claude updates the pin by the four steps above (PR,
independent review, CI on both architectures, then `update-ffmpeg.sh` on the VM). The sandbox (no
network, no secrets, one job directory, syscall filter, memory and time caps) limits what an
FFmpeg bug could reach, but does not replace the update. Everything else on the VM gets Ubuntu's
free security updates through `unattended-upgrades` (setup.sh warns if it is off).

### Licence of the FFmpeg build

The pinned build is **GPL version 3** (configured `--enable-gpl --enable-version3`; it contains
libx264 and libx265, which are GPL). What that asks of us, and how it is met:

- **Running it is unconditional.** The GPL's conditions apply when a copy is handed to someone
  else. The converter only *runs* FFmpeg on our own VM; members receive the converted videos,
  which the GPL does not cover. So no source has to be published and our own code is unaffected
  (the worker starts FFmpeg as a separate program; nothing is linked).
- **The licence and the source pointer stay with the binaries.** The installer keeps the build's
  own `LICENSE.txt` beside them and writes `SOURCE`: the exact download URL and sha256, FFmpeg's
  source commit and the commit of BtbN's build scripts (which name every bundled library and its
  version). CI checks both files are there.
- **Never hand the binaries on.** They are not in this repository, not in a CI artifact (only
  `worker.mjs` is uploaded), not in the app. Passing them to a third party would bring the GPL's
  source-offer duty with it — if that is ever wanted, decide it first.
- **Never pin a `nonfree` build** (it may not be redistributed at all); CI refuses one.
- BtbN's build *scripts* are MIT-licensed; we use their published output, not the scripts.
- Patent licences for H.264/HEVC are a separate matter from this copyright licence and are the
  same whichever FFmpeg build encodes; not changed by this choice.

## Behaviour summary (for the reviewer)

- Polls `POST /api/video/convert/claim` every 10 s; while idle the wait doubles to 60 s.
- S7-f: once an hour (`CONVERTER_PURGE_EVERY_MS`), one `POST /api/video/purge` per loop turn before
  the claim until the queue is drained (≤ 20 per tick); errors wait for the next interval
  ("Purge tick (S7-f)" above).
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
  re-runs its self-test and claims nothing until it passes. A job the member cancelled (claim
  gone) neither counts toward that streak nor resets it.
- Sources up to 4K at 120 fps are accepted (≤ 1080p: up to 240 fps); the output is always
  ≤ 30 fps. Anything faster or larger than 4096×2160×120 pixels per second is `too_big`.
- A clip so short that its sound alone breaks the database's bytes-per-second rule keeps its
  video and loses its sound (`job.audio_dropped`); a length that rounds to 0 is `damaged`.

## Known limits / follow-ups

- The poster is always the frame at min(1 s, duration/2): the claim carries no member cover
  (a recorded follow-up, design §10.4).
- HDR tone mapping needs FFmpeg's `zscale` (libzimg) and `tonemap`; the pinned build has both
  (checked at install). The start-up self-test converts an HDR-tagged source, so a VM without them
  claims nothing.
- Tone mapping runs in floating point (once, at the largest rendition's size): HDR conversions are
  slower than SDR ones; not yet measured on the Ampere VM.
- `MemoryDenyWriteExecute=yes` on the FFmpeg runs is proven in CI on x86_64 and aarch64 (GitHub's
  arm64 runner, not the Ampere VM itself); on the VM the start-up self-test is the final proof — if
  it fails there, check `journalctl -u 'converter-ff@*'`.
