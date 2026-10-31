---
name: Per-Photo Placement UI Wiring (Phase 4)
description: fetchPhotoStatusMaps now merges consensus + R4 placement so every consumer (SubmissionDetail etc.) auto-renders R4 award labels per photo
type: feature
---

# Phase 4 — UI Wiring of usePhotoPlacements

## Chokepoint
`src/lib/perPhotoStatus.ts :: fetchPhotoStatusMaps()` is the single function every per-photo consumer calls. As of 2026-05-02 it now:

1. Calls `fetchPhotoConsensus` + `fetchPhotoPlacements` in parallel.
2. Builds two per-entry `Map<entryId, PhotoStatusMap>`.
3. Returns `mergeConsensusAndPlacement(consensus, placement)` — placement wins on overlap.

## Why the chokepoint, not per-component
- `SubmissionDetail.tsx` is the only file using `fetchPhotoStatusMaps` for per-photo grids.
- `EntryCard` and the public competition page use **entry-level** R4 tags via `useGatedEntryStatus.public_r4_tags` — already wired pre-Phase-3.
- One edit covers every present and future per-photo consumer.

## Live proof (2026-05-02 declared comp `c301e534-…-edbeb9`, entry `31dc23d4-…-23cc5`)
14 photo_index rows have BOTH a `pending_consensus`/`r3_*` consensus row AND an `r4_*` placement row. Post-merge the UI receives only the `r4_*` value:

| photo_index | consensus | placement (wins) |
|---|---|---|
| 3, 11, 15 | r3_qualified_final | r4_finalist |
| 5, 17 | r3_qualified_final | r4_top_50 |
| 7 | r3_qualified_final | r4_top_100 |
| 8, 13 | r3_qualified_final | r4_honorary_mention |
| 9, 12 | r3_qualified_final | r4_runner_up_2 |
| 10, 14 | r3_qualified_final | r4_special_jury |
| 16 | r3_qualified_final | r4_winner |
| 18 | r3_qualified_final | r4_runner_up_1 |

## Honest gap
- Browser QA was performed on the PUBLIC competition page only (auth-gated SubmissionDetail not opened — no test-participant session in headless browser). Public page already renders R4 entry-level tags from a different code path; the per-photo wiring proof is via DB merge logic + 28/28 vitest.
- No screenshot of `/dashboard/submission/c301e534-…` taken (would require authenticated participant `cc691988-…` session).
