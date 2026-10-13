# PR #420 — re-review fixes (N1–N6, R-VM-1): each new control shown failing first

Date: 2026-10-13. Unit: VID-1 converter worker (VM). Base of the comparison: head `253f0521`
(the head the independent re-review approved with nits).

## 1 · TypeScript controls (vitest)

Method: the new and changed tests were kept; `converter/src/` alone was put back to `253f0521`
(`git stash push -- converter/src`), the tests run, the source restored (`git stash pop`, compared
with a copy taken before: identical apart from line endings), and the tests run again.

| Run | Result | File |
|---|---|---|
| new tests, **pre-fix** source | **13 failed**, 93 passed, 4 skipped (9 of 11 files failed) | `prefix-run-failures.txt` |
| same tests, fixed source | **0 failed**, 144 passed, 3 skipped (14 files; includes the 3 packager/codec files CI also runs) | `postfix-run.txt` |

The 13 that failed first, by finding:

| Finding | Test (file) | Why it failed before the fix |
|---|---|---|
| N2 | `launcher.test.ts` "137 … is the time cap only when the run lasted the cap" | 137 after 3 s of a 60 s cap was `timedOut` (→ `too_long`) |
| N4 | `config.test.ts` "CONVERTER_R2_BUCKET is required" | a missing bucket loaded without error |
| N4 | `download.test.ts` "pinned to … host AND /<bucket>/upload/" | with no bucket, any path on the host passed |
| N4 | `job.test.ts` "PUT URL outside the lane's R2 pin … marked fatal" | no `fatal` marker on the outcome |
| N4 | `worker.test.ts` "refused by the R2 pin … the loop STOPS claiming" | the loop kept claiming (`fatal` undefined) |
| N5 | `probe.test.ts` "the refusals that remain" | 242 fps (within slack) and 4K120 were `unsupported_format` |
| N6e | `worker.test.ts` "a lost claim … neither counts … nor resets" (2 tests) | a lost claim counted as internal: 5 back-offs instead of 3 |
| N6f | `dbRules.test.ts` "only the sound too dense" | `onlyTheSoundIsTooDense` did not exist |
| N6f | `dbRules.test.ts` "a declared length of 0 … is damaged" | it was `too_long` |
| N6f | `e2e.ffmpeg.test.ts` "a clip so short its sound cannot fit …" (real FFmpeg) | the job failed `too_big`: `VID-LIM-006 audio is 17086 bytes/s, above its ceiling of 16384` |
| N6g | `auth.test.ts` "a refresh answered 429 / 408 / 5xx is transient" | a 429 fell through to the password sign-in |
| R-VM-1 | `config.test.ts` "no security-updates marker setting" (titled "the old Ubuntu Pro marker setting is gone" when this run was made) | `noUpdatesMarker` was still in the config |

Local machine: Windows, Node 24.20.0, vitest 3.2.4, FFmpeg 6.0 (gyan essentials) + ffprobe. The
pinned FFmpeg 9.0.2 is a Linux build; it runs the same suite in CI on x86_64 and arm64.

## 2 · Shell controls (cannot run on Windows — proven in CI, `d2-converter.yml`)

No systemd locally, so these are proven by the workflow run on the PR's head, on both
architectures. Each has its own control against passing for the wrong reason:

| Finding | Control in CI | Why it could not pass on `253f0521` |
|---|---|---|
| N1 | step "sandbox-check.sh, run as root, never writes through a link the worker planted": user `converter` plants `state/.sandbox-check` and `secrets/.sandbox-check` as links to a root-only (0600) file; after the check that file must still be `root:root 600`, 0 bytes, and every line PASS | the old script wrote the probe text through the link as root and made the target 0644 |
| N2 | `grep -qx 'OOMPolicy=kill'` on the installed `converter-ff@.service` | the key was absent |
| N3 | step "sandbox-check.sh --selftest REFUSES while converter.service runs": must exit non-zero, print `FAIL  converter.service is active — stop it first`, and must NOT print "self-test passed" | the old script printed "self-test passed" without running anything and exited 0 |
| N4 | `grep -qx 'RestartPreventExitStatus=4'` on the installed `converter.service` | the key was absent |
| N6d | the positive-control line (PASS where 169.254.169.254 answers outside the unit, otherwise a NOTE) | `--netcheck-control` did not exist |
| R-VM-1 | pinned FFmpeg installed by `update-ffmpeg.sh` on both architectures; `LICENSE.txt` + `SOURCE` present; `--enable-gpl --enable-version3`, never `nonfree` | the scripts and the pin did not exist |
| R-VM-1 | step "a wrong URL and a tampered file are refused; … rolled back": (0) a pin naming another host → `pin: FFMPEG_URL_… must be exactly`; (1) a file whose sha256 is not the pin's → `REFUSED: … does not have the pinned sha256`, nothing installed; (2) **the same file with its right sha256 is accepted and activated** (so 1 was the checksum's doing), then fails the self-test → rolled back | new control |

## 3 · The checksum refusal, also run locally (Git Bash, the real x86_64 file)

`pin-refusal-local.txt`: `ffmpeg-lib.sh` sourced with the real `ffmpeg.pin` and the real
downloaded file. One byte appended → `REFUSED`, nothing installed. A pin naming another host,
the moving `latest` tag, or no source commit → refused. Control: the untouched file → `OK`.

## 4 · The pin, verified three ways (2026-10-13)

| | x86_64 | aarch64 |
|---|---|---|
| file | `ffmpeg-n9.0.2-17-g2a571b6068-linux64-gpl-9.0.tar.xz` | `ffmpeg-n9.0.2-17-g2a571b6068-linuxarm64-gpl-9.0.tar.xz` |
| BtbN `checksums.sha256` | `68ee6468…30d66269` | `91afcd76…36a2ab46` |
| GitHub asset `digest` | same | same |
| `sha256sum` of the download | same | same |

Release `autobuild-2026-09-30-13-08` (published 2026-09-30T13:09:24Z). FFmpeg commit
`2a571b606854520cf89804d8030c8b328e621689` = tag `n9.0.2` + 17 commits (GitHub compare: ahead 17,
behind 0). BtbN tag commit `6c9aec5fc9a72ec3abedd1fa84db141fa18cf52b`. The x86_64 binary's
configuration holds `--enable-gpl --enable-version3 --enable-libzimg --enable-libx264
--enable-libx265` and no `--enable-nonfree`; its `LICENSE.txt` is the GPL version 3.

## 5 · Found by CI on the pinned build: FFmpeg 9 takes colour tags from the frames

The first run with the pinned build (run 38393331861, head `7c63687c`) failed the same two
real-FFmpeg tests on **both** architectures (145 passed, 2 failed):
"the self-test passes … its HDR case tone-mapped" (`ok: false`) and "HDR highlights …"
(`plan.toneMap` was null). Every other test passed on FFmpeg 9.0.2.

Cause, measured with the same command on both versions (ffprobe 9.0.2 reading the result:
`color_range, color_space, color_transfer, color_primaries`):

| FFmpeg | source made with the `-color_*` output options only | with `setparams` on the frames |
|---|---|---|
| 6.0 | `tv,bt2020nc,smpte2084,bt2020` | `tv,bt2020nc,smpte2084,bt2020` |
| 9.0.2 | `tv,bt2020nc,unknown,unknown` | `tv,bt2020nc,smpte2084,bt2020` |

So on 9.0.2 the self-test's "HDR" source was not HDR, and the self-test — which gates every start
of the worker — refused. Fix: the tags are put on the frames (`selftest.ts` `HDR_TAG_FILTER`); the
highlights test's source likewise. Members' videos were never affected: the converter's outputs
get their BT.709 tags from `zscale` on the frames (the HDR test asserts each rendition's tags; it
passed on 9.0.2 throughout).

Reproduced locally with the Windows build of the **same release and source commit**
(`ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-9.0.zip`, sha256 `a0e45723…7a58d278`, as in BtbN's
`checksums.sha256`):

| FFmpeg 9.0.2 | Result |
|---|---|
| committed code (`7c63687c`) | 2 failed, 12 passed — the same two as CI |
| new control "the self-test's HDR source carries its tags on the frames", with the frame tags taken out again | **fails**: `transfer ""`, `primaries ""`, `hdr false` (and the self-test fails) |
| fixed | whole converter suite: 14 files, **145 passed**, 3 skipped (POSIX-only), 0 failed |
| fixed, on FFmpeg 6.0 | real-FFmpeg file: 15 passed |

## 6 · Found by CI: the "ran in this start" proof of N3 read the wrong thing

Run 38395036552 (head `33770727`): all 147 tests passed on both architectures with the pinned
build, and every sandbox line said PASS — but `sandbox-check.sh --selftest` still failed two
lines, although the journal printed right below them showed `worker.selftest ok:true` and
`worker.netcheck ok:true`:

```
  (converter.service did not run anew: started at 0 -> 0 µs, status 0)
FAIL  self-test failed under converter.service
```

Cause: the proof compared the unit's `ExecMainStartTimestampMonotonic` before and after. Once a
oneshot has finished, systemd unloads the unit and `systemctl show` reads zeros. Fix: the proof is
now the worker's own result line (`"event":"worker.selftest"` / `"worker.netcheck"` with
`"ok":true`) in the journal after a cursor taken just before the start (`journalctl --sync`
first). The check stays as strict as intended — a start that runs nothing still fails:
tested with stand-ins for `systemctl` / `journalctl` (8 cases: ran and passed; start returned 0
but nothing ran; `ok:false`; another event's `ok:true`; no cursor → fails closed), and on real
systemd 255 by the workflow.
