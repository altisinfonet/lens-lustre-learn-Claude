# S7 · VID-6 video alarms (cost line + music-check wait)

**Plan (S7):** "cost alerts (VID-6)". **Owner decision (2026-10-30 ~15:20 UTC, #617):** alarm at **8 GB** of R2 storage per lane-month, raised as a row in `public.ops_alarms` so `alarm-relay.yml` delivers it (ALARM issue → GitHub e-mails the Owner). No e-mail address in git.
**SQL:** `supabase/migrations/20261030_0702_s7_vid6_video_alarms.sql` · rollback `supabase/rollback/20261030_0702_s7_vid6_video_alarms_ROLLBACK.sql` · PROBE `supabase/migrations/PROBE_20261030_0702_s7_vid6_video_alarms.sql`.
**Gate sentence:** the lane raises an `ops_alarms` row when its stored video reaches 8 GB and when a member has waited over 6 h for the music check; PROBE FAIL before / PASS after on staging and production.

## What was missing (inspected on `staging` e68965dc)
| Gap | Evidence |
|---|---|
| Nothing measured how much video a lane stores | no reader of `video_versions.total_bytes` / `video_sources.source_bytes` outside the upload path |
| The 6-hour music-wait alert list was never read | `music_check_overdue` (20261005_0006:288) has no caller in `src/`, `functions/`, `converter/` or any migration; DECISION.md:397 "after 6 h of errors admins get an alert (VID-6 channel)" |

## What it does
- `ops_alarm_settings.video_storage_alarm_bytes` = **8,000,000,000** (8 GB read as 10^9 — the lower reading, never late).
- `ops_video_storage_bytes()` = sum of every `video_versions.total_bytes` (served renditions; deleted / failed versions stay counted until the 30-day purge) + every `video_sources.source_bytes` (converter originals). These are the declared, server-checked sizes (VID-LIM-002).
- `ops_video_alarms()` every 15 min (cron `ops-video-alarms`): `video-storage` open while bytes ≥ the line; `video-music-overdue` open while `music_check_overdue(6 h)` has rows. Both through `ops_alarm_set` (20261103_0300) — the same channel as uptime / dead-man alarms: Admin → Health banner on each lane, ALARM issue for production.

## Decisions
- **D-VID6-1 Measured from the database, not from Cloudflare.** The database holds the exact size of every video file it serves or converts; reading Cloudflare's R2 analytics would need a new Cloudflare API token as a secret (an Owner step) and an HTTP call from the cron job (P9 forbids). Not counted, and named in every alarm's detail: photos (PHOTOS bucket; legacy `image_urls` photos have no recorded size), private photo derivatives, folders queued for purge but not yet deleted (emptied within the hour by the converter's purge tick, S7-f).
- **D-VID6-2 The current amount, not a month average.** R2 bills the month's average; alarming on the current amount alarms earlier than the bill crosses 8 GB-month, never later.
- **D-VID6-3 Paid music checks per day:** not counted. The copyright music check ships **Off** and is refused ON without the music-API key, so there are no paid checks; a per-day budget is an Owner decision to make when the check is switched on.

## Tests (FAILING first)
- Local proof on two lane-shaped fixtures (`vid6-fixture/run.sh`, transcript `vid6-fixture/transcript.txt`): real table DDL from 0005 / 0002 / 0006 plus the real 20261103_0300. Staging-shaped: one member, no video. Production-shaped: an admin, a 400 MB video, a 300 MB source, an open uptime alarm, one real video waiting 9 h. Each: PROBE **FAIL G1** before → apply → PROBE **PASS** → rollback → PROBE **FAIL G1** → apply → PROBE **PASS**.
- The PROBE catches defects: granting EXECUTE to `authenticated` → FAIL G1; leaving converter sources out of the sum → FAIL G3 ("measured 400006000, expected 700006000").
- Rollback closes only `video-storage` / `video-music-overdue`; the open uptime alarm stayed open.
- Static checks P5 / P6 / P7 / P9 / P28 / P35 pass and list `ops-video-alarms [*/15 * * * *]`.

## Runs (apply-migration.yml)
(filled in as they happen: staging PROBE-before → apply → PROBE-after; production after the carry to main)
