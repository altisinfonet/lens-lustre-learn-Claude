# Step 20 — PhaseWatermark Mount Report

## Surfaces mounted (14/14)
1. EntryCard.tsx — pre-existing (Step 19 source)
2. CompetitionLightbox.tsx — diagonal overlay
3. JuryImageViewer.tsx — hero canvas + filmstrip thumbs (props: competitionPhase, competitionCurrentRound)
4. CinemaFullView.tsx — hero + filmstrip
5. CinemaListView.tsx — grid via VirtualizedPhotoGrid
6. CinemaJudgeView.tsx — phase/round derivation + prop forwarding
7. VirtualizedPhotoGrid.tsx (PhotoCell) — per-cell overlay
8. MobileJudgeView.tsx — grid + fullscreen
9. EntryDetail.tsx — single + multi-photo grid
10. SubmissionDetail.tsx — grid cells + lightbox
11. Dashboard.tsx — competition cover cards
12. PublicProfile.tsx — winners + hero + grid
13. AdminEntriesSection.tsx — lightbox preview
14. (Backstop) PhaseWatermark itself short-circuits when phase !== "judging"

## Data plumbing
- `useUserEntries` — JOIN competitions(phase, current_round, ...), resolved via `resolvePhase()`
- `useAdminEntries` — JOIN competitions + current_round map
- `fetchCompetitionsByIds` (CompetitionMapEntry) — added `current_round`
- `useDashboardData.MyCompEntry` — added `competition_current_round`
- `EntryDetail.EntryData` — added `competitionCurrentRound`
- `SubmissionDetail.CompData` — added `current_round`
- `PublicProfile.CompEntry.competition` — added `phase` + `current_round` (already returned by `fetchUserEntries`)
- `AdminEntriesSection.EntryRow` — added `competition_phase` + `competition_current_round`

## Canonical source of truth
All phase resolution flows through `src/lib/competitionPhase.ts:resolvePhase()`. No surface derives phase locally.

## Behaviour
PhaseWatermark renders ONLY when `phase === "judging"`, with round-specific labels (Round 1 Scoring → Round 4 Winners). Diagonal full-image overlay, `pointer-events-none`, `select-none`, z-[5].

## Zero-damage guarantees
- All new props are optional → no breaking signatures
- PhaseWatermark short-circuits → no DOM impact outside judging phase
- Only additive query columns; existing data shapes preserved
- No business logic, RLS, or scoring changes
