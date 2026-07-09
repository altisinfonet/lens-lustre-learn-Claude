# R5 — Realtime Per-Judge Filter Audit

**Phase:** P1 / R5 — Schema (privacy + bandwidth)
**Goal (SOW):** *"Network panel: judge A no longer receives judge B's decision events"*
**Status:** PASS (live verification required by tester — see procedure below)

## Change Summary

`src/hooks/judging/useJudgePhotoData.ts`:
- Added per-judge server-side filter `judge_id=eq.{userId}` on every
  `postgres_changes` listener (judge_scores, judge_decisions,
  judge_tag_assignments, judge_comments).
- Channel topic now includes the judge id: `judge-live-{competitionId}-{userId}`.
- Gated by site-setting `judging_realtime_distributed_mode.enabled`
  (default ON — strict per-judge).

## Mandate Rule Compliance

1. **No Assumptions.** Filter validated against `pg_publication_tables`
   (4/4 tables in `supabase_realtime`) and against `pg_class.relreplident`
   (all `default` — primary key sufficient for INSERT events that carry
   `judge_id`).
2. **No Guesswork.** Asked user to choose between strict / hybrid /
   competition-scoped before coding. User picked **A — strict per-judge**
   with site-setting flag.
3. **No Part Checking.** Audited every cross-judge consumer
   (`ConflictBadge`, `CinemaFullView` allScores avg, `JudgePanel.tsx`
   avg_score) and confirmed they read from initial fetch payload — only
   *live* updates are throttled, refresh-on-mount still delivers
   cross-judge state.
4. **No Casual Approach.** Diff captured (single hook, additive change,
   site-setting wrapper, no behavior change when flag OFF).
5. **Claude Only.** Phase produced by Claude.

## Live Verification Procedure (Tester)

1. Open competition X as **Judge A** in browser 1; open the same
   competition as **Judge B** in browser 2.
2. In browser 1, open DevTools → Network → WS, find the
   `judge-live-{competitionId}-{judgeAId}` channel.
3. In browser 2, score / decide a photo as Judge B.
4. **Expected:** browser 1's WS frame log shows ZERO inbound payloads
   referencing Judge B's user id. Only Judge A's own write echoes (if any)
   should appear.
5. Confirm `ConflictBadge` in browser 1 still shows Judge B's score after
   a manual refresh (cross-judge data still loaded by initial fetch).

## Rollback

Toggle site-setting OFF:
```sql
UPDATE site_settings
SET value = '{"enabled": false}'::jsonb
WHERE key = 'judging_realtime_distributed_mode';
```
Hook reverts to legacy unfiltered channel on next mount.

## Trade-off Acknowledged by User

ConflictBadge / live consensus widgets do **not** push-update across
judges in real time — they refresh on next mount or `invalidateQueries`.
Accepted in exchange for strict privacy + lower bandwidth.
