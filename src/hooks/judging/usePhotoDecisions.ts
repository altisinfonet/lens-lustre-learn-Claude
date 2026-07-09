/**
 * usePhotoDecisions — Phase 4 (Per-Photo Decision Aggregation)
 *
 * Single source of truth for per-photo consensus on the client. Wraps the
 * `get_per_photo_consensus` DB RPC so the UI never reimplements aggregation
 * locally — every layer (DB / edge / UI) reduces to the same algorithm:
 *
 *   1. Group judge_decisions by (entry_id, photo_index, round_number)
 *   2. Pick the winning decision by (count DESC, SOW priority DESC)
 *      SOW priority: shortlist > winner > qualified > finalist > accept >
 *                    needs_review > skip > reject
 *   3. Consensus reached iff (winner_count / total_judges) > threshold
 *      AND judges_decided >= min_judges  (both from judging_config)
 *   4. If no consensus → status = 'pending_consensus' (NEVER silent default)
 *
 * Privacy: RPC is SECURITY DEFINER and only returns rows where the caller is
 * admin / entry-owner / judge assigned to the competition. Judge identities
 * are never exposed — only aggregate counts.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import type {
  PerPhotoStatus,
  PhotoStatusMap,
} from "@/lib/judging/perPhotoStatusTypes";

// Re-export the union from its single source of truth (Phase 2 / D2).
// New consumers should import from `@/lib/judging/perPhotoStatusTypes`
// directly; this re-export preserves the historical import path.
export type { PerPhotoStatus, PhotoStatusMap } from "@/lib/judging/perPhotoStatusTypes";

export interface PhotoConsensusRow {
  entry_id: string;
  photo_index: number;
  round_number: number;
  decision: string;
  judges_decided: number;
  total_judges: number;
  ratio: number;
  threshold: number;
  has_consensus: boolean;
  /** Phase 1 canonical key (Frozen Contract v3). Always present post-Phase-1. */
  status: PerPhotoStatus;
}

/**
 * Direct RPC call (no React Query). Useful for non-component callers
 * (e.g. perPhotoStatus.ts shim, edge function consumers).
 */
export async function fetchPhotoConsensus(
  entryIds: string[],
): Promise<PhotoConsensusRow[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await (supabase.rpc as any)("get_per_photo_consensus", {
    p_entry_ids: entryIds,
  });
  if (error) {
    console.error("[usePhotoDecisions] RPC failed:", error);
    return [];
  }
  return (data as PhotoConsensusRow[]) || [];
}

/**
 * Group consensus rows into per-entry photo→status maps.
 * When multiple rounds exist for the same photo, the HIGHEST round wins
 * (R4 winner > R3 finalist > R2 promotion > R1 outcome).
 *
 * Privacy gate: if `publishedRounds` is provided, rows for rounds not in
 * that set are DROPPED before the highest-round merge. This prevents an
 * unpublished round (R3 closed but not declared) from leaking promotion
 * labels to participants. Without this gate, a single in-progress R3
 * decision would silently override the published R2 outcome on screen
 * — exactly the "one image showing Shortlisted for Final Round while the
 * rest still say Qualified for Round 2" bug observed 2026-05-02.
 */
export function buildPhotoStatusMaps(
  rows: PhotoConsensusRow[],
  publishedRounds?: ReadonlySet<number>,
): Map<string, PhotoStatusMap> {
  // Track highest published round per (entry, photo) so a later published
  // round overrides an earlier one — but unpublished rounds never show.
  const winners = new Map<string, PhotoConsensusRow>();
  for (const r of rows) {
    if (publishedRounds && !publishedRounds.has(r.round_number)) continue;
    const k = `${r.entry_id}::${r.photo_index}`;
    const cur = winners.get(k);
    if (!cur || r.round_number > cur.round_number) winners.set(k, r);
  }

  const result = new Map<string, PhotoStatusMap>();
  for (const [k, r] of winners.entries()) {
    const [entryId, piStr] = k.split("::");
    const pi = Number(piStr);
    if (!result.has(entryId)) result.set(entryId, {});
    // Map server canonical status keys to the keys the existing UI consumes.
    //
    // Phase 5 (2026-05-02) — `status_legacy` column DROPPED server-side. We
    // consume the canonical `status` column directly with no fallback.
    const status = (r.status as PerPhotoStatus) ?? "pending_consensus";
    const mapped: PerPhotoStatus =
      status === "r2_qualified_r3"   ? "round2_qualified"
        : status === "r3_qualified_final" ? "finalist"
        : status;
    result.get(entryId)![pi] = mapped;
  }
  return result;
}

/**
 * React Query hook — fetches per-photo consensus for a batch of entries.
 *
 * @returns rows + a precomputed Map<entryId, PhotoStatusMap> for the most
 *          common UI shape.
 */
export function usePhotoDecisions(entryIds: string[]) {
  const sortedIds = [...entryIds].sort();
  const queryKey = queryKeys.perPhotoConsensus(sortedIds);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPhotoConsensus(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 30_000,
  });

  const statusMaps = query.data ? buildPhotoStatusMaps(query.data) : new Map();

  return {
    rows: query.data ?? [],
    statusMaps,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
