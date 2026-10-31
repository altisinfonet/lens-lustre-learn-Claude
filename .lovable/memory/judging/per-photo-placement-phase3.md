---
name: Per-Photo Placement Phase 3
description: get_per_photo_placement sibling RPC + usePhotoPlacements hook + mergeConsensusAndPlacement utility for R4 awards
type: feature
---
# Phase 3 — R4 Per-Photo Placement (2026-05-02)

## DB
- `public.get_per_photo_placement(p_entry_ids uuid[])` SECURITY DEFINER, STABLE.
- Source: `judge_tag_assignments` (round_number=4) JOIN `judging_tags` on `tag_id`. **There is NO `entry_placements` table** — the SOW assumption was wrong; this is the verified live source.
- Returns 8 Frozen Contract v3 R4 canonical keys: `r4_winner, r4_runner_up_1, r4_runner_up_2, r4_top_50, r4_top_100, r4_finalist, r4_honorary_mention, r4_special_jury`.
- Label→key map (immutable in fn):
  - Winner → r4_winner
  - 1st Runner-Up → r4_runner_up_1
  - 2nd Runner-Up → r4_runner_up_2
  - Top 50 → r4_top_50
  - Top 100 → r4_top_100
  - Qualified for Final Round → r4_finalist
  - Honorary Mention → r4_honorary_mention
  - Special Jury Award → r4_special_jury
- Tie-break (multiple labels per photo): priority winner > runner_up_1 > runner_up_2 > top_50 > top_100 > finalist > honorary_mention > special_jury.
- Privacy gate: row only visible if (a) competition_round_publish.published_at IS NOT NULL for round 4, OR (b) viewer is admin, OR (c) viewer is competition judge, OR (d) viewer is entry owner. `declared` boolean exposed for UI.
- Live proof 2026-05-02: returned 14/14 R4-tagged photos across all 8 canonical keys.

## Frontend
- Hook: `src/hooks/judging/usePhotoPlacements.ts` mirrors `usePhotoDecisions` API (`{rows, placementMaps, isLoading, error, refetch}`).
- Merge utility: `src/lib/judging/mergeConsensusAndPlacement.ts` — placement ALWAYS wins over consensus on overlap (R4 award supersedes per-round progression).
- Type union: `R4CanonicalStatus` in `src/lib/judging/perPhotoStatusTypes.ts` carries the 8 r4_* keys; legacy `winner` and `finalist` retained in `LegacyPerPhotoStatus` for dual-emit window (dropped Phase 5).
- Participant labels (`participantStageLabels.ts`): all 8 r4_* keys mapped to existing PARTICIPANT_LABELS.r4_* strings.

## Tests (regression locks)
- `src/test/per-photo-status-canonical-parity.spec.ts` — 23 cases; pins 7/8 R4 canonical↔legacy parity. `r4_finalist` deliberately NOT paired with legacy `finalist` because they are different stages (R4 award vs R3→R4 advancement).
- `src/test/merge-consensus-and-placement.spec.ts` — 5 cases covering placement-wins, no-mutate, multi-entry merge.

## Known mismatches with SOW
- SOW called for `entry_placements` table — does not exist. Used `judge_tag_assignments` instead.
- SOW said "competition_round_publish.declared_at" — column is named `published_at`. Per memory `Round Declaration is Admin-Gated`, declare = published_at.
- SOW counted "11 R4 rows today"; live count is 14 distinct (entry, photo) pairs across 1 declared competition.
