---
name: realtime-per-judge-filter-r5
description: useJudgePhotoData realtime channel filters server-side by judge_id; cross-judge live updates intentionally OFF; toggled by site_settings.judging_realtime_distributed_mode (default ON).
type: feature
---

# R5 — Realtime Per-Judge Filter

`src/hooks/judging/useJudgePhotoData.ts` subscribes to `judge_scores`,
`judge_decisions`, `judge_tag_assignments`, `judge_comments` with a
server-side filter `judge_id=eq.{userId}` whenever the site setting
`judging_realtime_distributed_mode.enabled !== false` (default = ON).

**Why:** privacy (judge A must not see judge B's live events) +
bandwidth (Realtime WS only carries the current judge's writes).

**Channel topic:** `judge-live-{competitionId}-{userId}` (per-judge so
broadcasts never collide).

**Trade-off accepted:** ConflictBadge / cross-judge consensus widgets
update live ONLY for the current judge. Other judges' contributions show
up on next mount / `invalidateQueries`. This is the user's explicit
choice (option A in R5 clarification).

**Do NOT** revert to an unfiltered channel without explicitly flipping
the site setting OFF — privacy is the contract.
