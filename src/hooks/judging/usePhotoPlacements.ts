/**
 * usePhotoPlacements — Phase 3 (Per-Photo R4 Placement Aggregation)
 *
 * Sibling to `usePhotoDecisions`. Wraps the `get_per_photo_placement` DB RPC
 * (introduced 2026-05-02) so the UI never reimplements R4 award resolution
 * locally. Algorithm in DB:
 *
 *   1. Read every (entry_id, photo_index) with `judge_tag_assignments`
 *      where round_number = 4.
 *   2. Map the catalog `judging_tags.label` to one of the 8 Frozen Contract v3
 *      R4 keys: r4_winner, r4_runner_up_1, r4_runner_up_2, r4_top_50,
 *      r4_top_100, r4_finalist, r4_honorary_mention, r4_special_jury.
 *   3. Tie-break (multiple labels for one photo): winner > runner_up_1 >
 *      runner_up_2 > top_50 > top_100 > finalist > honorary_mention >
 *      special_jury.
 *   4. Privacy gate: declared (`competition_round_publish.published_at IS NOT
 *      NULL` for round 4) — non-admin / non-judge / non-owner viewers only see
 *      rows for declared competitions.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  PerPhotoStatus,
  PhotoStatusMap,
} from "@/lib/judging/perPhotoStatusTypes";

export interface PhotoPlacementRow {
  entry_id: string;
  photo_index: number;
  /** Always 4. */
  round_number: number;
  /** Frozen Contract v3 canonical key (r4_*). */
  status: PerPhotoStatus;
  /** Original `judging_tags.label` string for debugging / admin views. */
  award_label: string;
  /** True when `competition_round_publish.published_at` is set for round 4. */
  declared: boolean;
}

/**
 * Direct RPC call (no React Query). Mirror of `fetchPhotoConsensus`.
 */
export async function fetchPhotoPlacements(
  entryIds: string[],
): Promise<PhotoPlacementRow[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await (supabase.rpc as any)("get_per_photo_placement", {
    p_entry_ids: entryIds,
  });
  if (error) {
    console.error("[usePhotoPlacements] RPC failed:", error);
    return [];
  }
  return (data as PhotoPlacementRow[]) || [];
}

/**
 * Group placement rows into per-entry photo→status maps.
 * Mirror of `buildPhotoStatusMaps` in usePhotoDecisions but always R4.
 */
export function buildPhotoPlacementMaps(
  rows: PhotoPlacementRow[],
): Map<string, PhotoStatusMap> {
  const result = new Map<string, PhotoStatusMap>();
  for (const r of rows) {
    if (!result.has(r.entry_id)) result.set(r.entry_id, {});
    result.get(r.entry_id)![r.photo_index] = r.status;
  }
  return result;
}

/**
 * React Query hook — fetches per-photo R4 placements for a batch of entries.
 *
 * @returns rows + a precomputed Map<entryId, PhotoStatusMap> for the most
 *          common UI shape. API mirrors `usePhotoDecisions`.
 */
export function usePhotoPlacements(entryIds: string[]) {
  const sortedIds = [...entryIds].sort();
  const queryKey = ["per-photo-placement", sortedIds];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPhotoPlacements(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 30_000,
  });

  const placementMaps = query.data
    ? buildPhotoPlacementMaps(query.data)
    : new Map<string, PhotoStatusMap>();

  return {
    rows: query.data ?? [],
    placementMaps,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
