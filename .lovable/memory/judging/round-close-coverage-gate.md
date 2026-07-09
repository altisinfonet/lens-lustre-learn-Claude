---
name: Round Close Coverage Gate
description: complete-round edge function blocks closure until every assigned judge has decided every eligible photo; full missing set logged server-side
type: feature
---

`complete-round` enforces a hard 100% coverage gate (default-on, no admin bypass) before transitioning a round to `completed`.

**Rule:** every assigned judge must have a `judge_decisions` row for every eligible `(entry_id, photo_index)` pair in the round.
- Distributed mode: only judges in `judge_entry_assignments` for that entry count.
- Pooled mode: every judge in `competition_judges` counts.

**Failure response (409):**
```json
{
  "error": "Cannot complete round: N of M assigned judge(s)...",
  "missing_judges": N, "assigned_judges": M,
  "missing_decisions": K,
  "sample": [{judge_id, entry_id, photo_index}, ...]   // capped at 20
}
```

**Phase 3 (2026-04-20):** added structured archival log emitted before each 409 return.
- Tag: `round_close_coverage_gate_block`
- Payload: `competition_id, round_number, assigned_judges, missing_judges, missing_count, missing_full[]`
- `missing_full` contains EVERY missing `(judge_id, entry_id, photo_index)` triple — not capped.
- HTTP body still ships only the 20-row `sample` to keep response payload small.
- Retrievable via `supabase--edge_function_logs` for `complete-round`.

Eligibility for R2/R3/R4 = "any-judge-shortlisted in prior round" (not majority).
