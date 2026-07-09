# Deferred Work — Architectural Debt Log

Tasks intentionally **NOT** executed in the current rollout, kept here so the next session has full context.

---

## D-10 — Judge View: True Server Pagination

**Status:** DEFERRED (Risk: HIGH)
**Logged:** Step 10 of the auto-scroll / lazy-load rollout (post Step 9).
**Owner:** Next architecture session.

### Goal
Convert the judge view from a single-fetch model (loads ALL competition entries in one request) to true server-side pagination of 10 entries per page, mirroring the Feed / Discover sentinel pattern.

### Why it was deferred
Judging UI depends on **aggregate stats over the full dataset**:
- Progress percentage (decisions made / total photos)
- Score totals & averages per round
- Bulk-action targeting ("apply to all remaining")
- Round-completion gating (R1 → R2, etc.)

Naive pagination breaks every one of these. A correct solution requires **separating the data plane from the aggregate plane** — paged photo cards via cursor, plus an independent RPC that returns aggregates without shipping every row.

### Files in scope (do not modify until designed)
| File | Role |
|------|------|
| `src/hooks/judging/useJudgePhotoData.ts` | Core photo fetcher — would need cursor support |
| `src/hooks/judging/useJudgeClassicData.ts` | Orchestrates entries + photos for the panel |
| `src/hooks/judging/useJudgeAggregateStats.ts` | Already separated — good foundation, may need expansion |
| `src/components/judge/VirtualizedPhotoGrid.tsx` | Renderer — would consume `InfiniteScrollSentinel` |
| `src/components/judge/CinemaJudgeView.tsx` | Wraps `VirtualizedPhotoGrid` |
| `src/pages/JudgePanel.tsx` | Top-level wiring |

### Prerequisites for future implementation
1. **Design RPC:** `get_judge_entries_page(comp_id, round, cursor, limit)` returning paged entries + a stable cursor.
2. **Confirm aggregates:** `useJudgeAggregateStats` must cover EVERY metric the UI shows so the paged hook never needs the full set.
3. **Cache strategy:** decisions / scores written by the judge must invalidate both the page query and the aggregate query atomically.
4. **Bulk actions:** redesign "apply to all remaining" to target server-side (RPC) rather than client array.
5. **Round gating:** `complete-round` edge function already operates server-side — verify it does NOT depend on client having all rows.

### Sub-step roadmap (when unblocked)
- 10.2 Architecture design doc (RPC + cache plan)
- 10.3 Implement paged `useJudgePhotoData` with cursor
- 10.4 Wire `InfiniteScrollSentinel` into `VirtualizedPhotoGrid`
- 10.5 Regression-test all 4 rounds + bulk actions + round completion

### Risk
**HIGH.** Touches the most business-critical surface of the platform (judging). Must not be attempted as a one-shot edit.
