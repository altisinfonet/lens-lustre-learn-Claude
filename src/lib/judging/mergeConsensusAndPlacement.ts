/**
 * mergeConsensusAndPlacement — Phase 3 merge utility.
 *
 * R4 placement (from `get_per_photo_placement`) ALWAYS wins over consensus
 * (from `get_per_photo_consensus`) because:
 *   - Placement is the final, declared award (winner / runner-up / top-N / etc.)
 *   - Consensus is the per-round progression decision used during judging.
 *   - When both exist for the same (entry, photo), placement supersedes.
 *
 * Per memory `Per-Photo Consensus Canonical v3`, this is the canonical merge
 * order. UI consumers that need the "single truth status" for a photo should
 * call this exactly once, downstream of both hooks.
 */
import type { PhotoStatusMap } from "./perPhotoStatusTypes";

/**
 * Merge two per-entry photo→status maps. Placement entries win on overlap.
 *
 * @param consensusMap  output of `buildPhotoStatusMaps` (per-round consensus)
 * @param placementMap  output of `buildPhotoPlacementMaps` (R4 awards)
 * @returns new Map; inputs are not mutated.
 */
export function mergeConsensusAndPlacement(
  consensusMap: Map<string, PhotoStatusMap>,
  placementMap: Map<string, PhotoStatusMap>,
): Map<string, PhotoStatusMap> {
  const merged = new Map<string, PhotoStatusMap>();

  // 1. Seed with a deep-copied consensus map.
  for (const [entryId, photoMap] of consensusMap.entries()) {
    merged.set(entryId, { ...photoMap });
  }

  // 2. Overlay placements. Placement always wins.
  for (const [entryId, placementPhotoMap] of placementMap.entries()) {
    const existing = merged.get(entryId) ?? {};
    for (const [piStr, status] of Object.entries(placementPhotoMap)) {
      existing[Number(piStr)] = status;
    }
    merged.set(entryId, existing);
  }

  return merged;
}
