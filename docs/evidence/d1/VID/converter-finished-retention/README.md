# VID-1 · finished converter rows kept until posted or deleted; 30-day cleanup (D1, T1) · `20261013_0006`

Owner requirement, 2026-10-13 (task 10). It must be applied to a lane **before** that lane's Admin → Video Conversion is switched to "server".

## The words, as the schema has them
| Word | Meaning in the database |
|---|---|
| **finished** | `video_sources.status = 'done'` — the converter's package went through `complete`; the row holds `video_id` (`video_sources_done_has_video`). `failed` / `cancelled` rows are *ended*, not finished: they made no video and keep the old rule (purged 2 days after they end). |
| **posted** | a `post_videos` row (written by `video_publish_post`) or an `ad_videos` row names the video. Read only; `video_publish_post` and its helper are not touched. |
| **deleted** | the video's state is `deleted` (`video_delete`, owner or admin), `failed` or `taken_down`. `video_housekeeping` (20261005_0005) purges `deleted` / `failed` videos after 30 days and queues their files; this unit leaves them to it. |
| **released** | a finished row whose video is posted or deleted. Only a released row is purged, by the same 2-day rule. |

## What ships
| Object | Rule |
|---|---|
| `video_source_housekeeping(integer)` (body) | 0002's body with one change: the 2-day purge takes a `done` row only when it is released. |
| `video_source_unposted_cleanup(interval, integer)` (new) + cron job `video-source-unposted-cleanup` (`47 * * * *`) | A finished, unposted video in `checking` / `ready` / `music_blocked`, where the job ended **and** the video last changed more than 30 days ago: its prefix `video/<owner>/<video>/` goes into `video_r2_purge_queue` (the existing queue; SQL never calls storage), the audit trail records `abandoned`, and the video row is deleted — versions, checks and the source row cascade. Less than 30 days is refused. |
| trigger `tg_video_sources_owner_gone` (new) | Account deletion (auth.users → profiles → rows, by cascade): when a source row goes and its owner's profile is gone, the converted video's prefix is queued. In every other delete the profile exists and nothing is queued. |

Nobody new can see or do anything: the owner reads their own rows through the existing RLS policy; the three functions are not executable by PUBLIC, anon or authenticated on either lane shape.

## Proof — `retention-harness.mjs` → `transcript.txt`
PGlite 0.5.9 (PostgreSQL 18.6, in memory). The real migration files are applied; only the platform is stubbed (the harness header lists what). The same 20 cases run on the lane **before** 0006 and **after** it, on a **staging** shape and a **production** shape.

| | staging shape | production shape |
|---|---|---|
| BEFORE 0006 | 10/10 new cases **RED**, 10/10 guards green; PROBE red (R1–R4) | the same |
| AFTER 0006 | 10/10 new + 10/10 guards **GREEN**; PROBE green | the same |
| PROBE mutants | 7, each red, each undone | the same |
| Rollback | housekeeping body md5 + ACL and `cron.job` byte-identical to before; PROBE red again; second rollback refused | the same |
| Re-apply twice | one job, one trigger, PROBE green | the same |
| production **today** (no video objects) | — | 0006 refuses (`VID-RET-PRE-001`), nothing changes |

Cases: a finished unposted row survives the old 2-day expiry (3 and 29 days) · a posted row and an ad-linked row are released · a deleted video's row is released · an unposted video is removed after 31 days with its files queued and the audit row written (also one still `checking`) · the 30 days run from the later of the two clocks · a posted or deleted video is never touched by the cleanup · a deleted account's converted files are queued, once · a stranger reads nothing and can neither cancel nor delete; anon reads nothing; no API role runs the cleanup or the housekeeping or reads the queue.

**Run it:** the two commands are in the harness header (PGlite is not a dependency of this repository; it is installed into a scratch directory).

## Classification
- **VERIFIED (fixture):** everything in the table above.
- **VERIFIED (live, read-only, staging `fpszggreishhuvdpkmdr`, 2026-10-13 11:29Z):** staging's default privileges (the staging shape is built from them); the two video cron jobs; the bodies of `video_source_housekeeping` and `video_housekeeping` equal git's; 0 source rows, 0 converter accounts, mode `"device"`, empty purge queue.
- **MODELLED, not measured:** production's default privileges (not in the collector dump) — the widest this project has measured (PUBLIC + anon + authenticated + service_role on new functions).
- **INFERRED, not run:** the race with publishing. A single PGlite connection cannot interleave two sessions. The link guards lock the video row `FOR UPDATE`; the cleanup takes the same lock (`SKIP LOCKED`) and looks for a link again in a new statement.
- **NOT READ (the database connector went down after 11:29Z):** staging's Postgres and pg_cron versions, its other 14 cron job names, and the catalog's own view of the cascades. The PROBE checks the cascades and prints the pg_cron version and the live counts in its NOTICE.
- **NOT DONE:** applied to nothing. Not staging-applied, not production-applied.

## Outside this unit
- **Storage (no change needed):** converted packages are served from `video/<owner>/<video>/v<n>/…`; the bucket's lifecycle rules cover only `upload/video/` (2 days) and `upload/source/` (8 days), so no rule deletes a converted video before it is posted. The production video bucket, when it is made, needs the same two rules and none on `video/`.
- **Nothing drains `video_r2_purge_queue` yet** (the VID-6 file worker): queued prefixes wait there.
- **A deleted account's videos without a source row** (every device-path video; converted videos whose row was already released) are still not queued — `transcript.txt` line `I1`. That is 20261005_0005's account path.
- **Client (PR #423):** a missing `video_sources` row for a job the app is still polling now means "removed after 30 days unposted, or the account/video was deleted" — and a finished job's video can be gone when the member finally opens it (`videoState` returns `null`; today the `checking` step would poll for ever, and Post from `review` is refused with `VID-LINK-001`).
- **`docs/evidence/d2/phase5/VID-1/CONVERTER-DESIGN.md` §4** still says finished sources are purged after 2 days (D2's file).
