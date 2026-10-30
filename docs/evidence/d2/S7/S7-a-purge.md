# S7-a · Purge-queue file deleter

**Plan (S7, verbatim):** "purge-queue file deleter". **Builder:** S7 cloud session, 2026-10-30.
**SQL:** `supabase/migrations/20261030_0700_s7a_video_purge_worker.sql` · rollback `supabase/rollback/20261030_0700_s7a_video_purge_worker_ROLLBACK.sql` · PROBE `supabase/migrations/PROBE_20261030_0700_s7a_video_purge_worker.sql`.

## What was missing (inspected on `staging` 1a50f7f)
| Gap | Evidence |
|---|---|
| Nothing deleted the files in `video_r2_purge_queue` | no reader of the table outside SQL; `docs/evidence/d1/VID/converter-finished-retention/README.md` "Nothing drains `video_r2_purge_queue` yet" |
| A video whose post (or ad) is deleted stayed `ready` for ever | `post_videos.post_id … ON DELETE CASCADE`; `video_housekeeping` purges only `deleted` / `failed` |
| An account deletion cascaded videos away without queuing files | only 0006's `tg_video_sources_owner_gone` queues, and only for converter-made videos |

## What it does
1. **Queue rows get a worker life:** `not_before`, a 10-minute lease, attempts (max 10), last error, outcome (`deleted` / `kept_referenced` / `bad_prefix`), object count.
2. **One rule for "may these files go?"** (`video_purge_referenced`): a whole-video folder only when no `videos` row has that id; a version folder `v<n>/` only when the video is gone, `taken_down`, `deleted`, `failed`, or `ready` on a later version.
3. **Worker:** `POST /api/video/purge` (admin or converter JWT) → `video_purge_claim` → list + delete through the lane's `MEDIA` binding (+ `upload/video/<o>/<v>/` leftovers for a whole video) → `video_purge_done`. The route re-checks the prefix shape and that it names the row's own owner/video. `tools/video-purge/run.mjs --loop` runs it hourly.
4. **Every way a video stops being used now ends in the queue:** AFTER DELETE trigger on `videos` (account deletion), and the hourly `video_orphan_sweep` (cron `video-orphan-sweep`, :53): a `ready` / `taken_down` / `music_blocked` video on no post and no ad, not converter-made, unchanged 30 days → `deleted` → the existing 30-day purge.

## Decisions (conservative, Instagram-like)
- **D-S7a-1** Deleted post → its video is kept 30 days (sweep) then 30 days as `deleted` before the files go — never sooner than the R-100 30 days. Instagram keeps deleted posts 30 days ("Recently deleted").
- **D-S7a-2** `checking` is never swept: that wait is on our side (music checker), never the member's.
- **D-S7a-3** A referenced version folder is re-checked daily instead of closed, so a later remedy that makes it unreferenced still frees it.
- **D-S7a-4** The worker is a tool, not a GitHub schedule: a schedule would need an admin token as a repo secret (forbidden to this session). The supervisor runs `tools/video-purge/run.mjs --loop` (or a converter-VM timer) with an admin/converter JWT.

## Tests
- `src/lib/video/__tests__/videoPurge.test.ts` (vitest, fake R2 + fake Supabase): queued → deleted with count; idempotent re-run; a foreign prefix is never touched; storage errors recorded; DB refusal passes through; 401 / 405.
- PROBE (supervisor applies): FAIL before 0700 (G1); after: grants, member A refused 3/3 own + cross-member, anon refused, queued → deleted, referenced → kept, version row waits then goes, foreign folder → `bad_prefix`, not-due held, error releases lease, deleted video queued once, sweep 30-day rule.

## Review #539 — findings checked against the schema (2026-10-30, video + a11y runner)
- **#1 (blocking) fixed** in 0947754: the shape CHECK holds for OPEN rows only, so closing an old malformed row as `bad_prefix` is never refused; PROBE inserts such a row under a NOT VALID constraint and sees it close.
- **#2 fixed** (rows closed by hand get `outcome = 'deleted'` before the closed-CHECK). **#3 fixed** (an error waits 15 min × attempts).
- **#4 checked, no change:** the only FKs to `public.videos` in applied migrations are `video_versions`, `post_videos`, `ad_videos` (0005) and `video_sources` (20261012_0002); `videos.purpose` is only `post` / `ad`. A move to `deleted` stamps `deleted_at` in `tg_videos_state_guard` (0005:265), which `video_housekeeping` ages (0005:664) — the "30 more days" holds.
- **#5 checked:** `video_r2_purge_queue` has no FK on `owner_id` or `video_id` (0005 table definition), so the AFTER DELETE trigger can queue during an `auth.users` cascade.
- **#7 invariant:** `taken_down → uploading` must bump `current_version` (`VID-STATE-002`, 0005), so a re-upload never writes into a version folder the worker is emptying.
- **#8 open (Owner/VM step):** a Supabase access token lives about an hour. The hourly `--loop` must run with a token that is refreshed before each run (the converter VM's own sign-in, 20261013_0007), not a pasted token. Listed for the Owner with the converter setup.
- **#10 fixed:** PROBE compares `ur.role = 'admin'::public.app_role`.
