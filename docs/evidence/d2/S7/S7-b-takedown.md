# S7-b · VID-4 report / takedown + music-check hook

**Plan (S7):** "report/takedown + music check (VID-4)". **Spec:** VID-1 DECISION §6–§7, §10 (signed #376). **Builder:** S7 cloud session, 2026-10-30.
**SQL:** `supabase/migrations/20261030_0701_s7b_video_takedown.sql` (needs 0700) · rollback `supabase/rollback/20261030_0701_s7b_video_takedown_ROLLBACK.sql` · PROBE `supabase/migrations/PROBE_20261030_0701_s7b_video_takedown.sql`.

## What already existed (re-used, not copied)
- Hiding: feed / profile / post page / ad show a video only while `ready` (videos RLS, `postVideoRead.ts` marks the post hidden, `play-token` refuses). `taken_down` is a legal state since 0005. So "hidden everywhere at once" = the state change.
- Revoked list: the media-authz Worker already refuses any video in KV `VIDEO_REVOKED`; nothing wrote it.
- Music check: built complete in SQL (0006), switch `copyright_music_check` ships Off and cannot leave Off without the vault key.

## What this adds
| Piece | Where |
|---|---|
| `video_takedown(video, reason, report)` — admin only; ready → taken_down (idempotent); v<n> files queued with a 30-day hold; owner notice (`user_notifications` type `video_taken_down`, dedup per version); the post's pending reports close as `video_taken_down`; audit row | SQL 0701 |
| `video_report_dismiss(report, note)` — admin only, audited | SQL 0701 |
| `video_takedown_audit` — append-only, admins read, no client writes | SQL 0701 |
| `POST /api/video/takedown` — calls the RPC as the admin, then writes KV `VIDEO_REVOKED` (if bound to the Pages project) | `functions/api/video/takedown.ts` |
| Admin → Reports: "Take down video" on reports of video posts; copyright reports labelled | `AdminPostReports.tsx` |
| Member report reason "Copyright (music)" on video posts — **switch `site_settings.video_report_copyright` = "on", default OFF** | `PostCard.tsx`, `src/lib/video/takedown.ts` |
| `music-check` Edge Function — vendor STUB: service-role only; vendor `none` records nothing (on-checks keep waiting, never published unchecked); any other vendor → 501 | `supabase/functions/music-check/` |

## Decisions
- **D-S7b-1** Files of a taken-down version are kept 30 days (appeal / evidence), then deleted by the S7-a worker unless a fix still needs them. Instagram keeps removed content for appeal.
- **D-S7b-2** Takedown is final for that version (no taken_down → ready move exists); the owner fixes by uploading a new version (§10).
- **D-S7b-3** The optional fast lane (3 reports in 24 h → auto takedown) is NOT built: the Owner has not said yes (§10 "Owner yes/no").
- **D-S7b-4** Music vendor not chosen and paid → stub only, default OFF (`MUSIC_CHECK_VENDOR` unset). Not deployed by a merge.
- **D-S7b-5** Ads: an ad video is removed with the ad library's existing Remove; members do not report ads here (ads have no report menu today).

## Supervisor / Owner
- Apply 0701 after 0700 (staging, then production), then the PROBE.
- Bind the lane's existing `VIDEO_REVOKED` KV namespace to the Pages project (variable name `VIDEO_REVOKED`) — until then a takedown stops already-playing copies within 15 minutes (token expiry).
- To try: Admin → Features/site settings `video_report_copyright` = `on` on staging; report a video post as "Copyright (music)"; Admin → Reports → Take down video.
