/**
 * Per-Photo Status Derivation — Phase 4 SHIM
 *
 * As of Phase 4 (Per-Photo Decision Aggregation), the authoritative
 * implementation lives in the DB function `get_per_photo_consensus`,
 * exposed via `src/hooks/judging/usePhotoDecisions.ts`.
 *
 * This file is now a thin compatibility shim that delegates to the RPC.
 * It exists only to preserve the public API used by older callers
 * (useCompetitionDetail, EntryCard, SubmissionDetail).
 *
 * NEW CODE SHOULD IMPORT FROM `@/hooks/judging/usePhotoDecisions` DIRECTLY.
 *
 * SOW priority tie-break (applied server-side, NOT here):
 *   shortlist > winner > qualified > finalist > accept > needs_review > skip > reject
 *
 * No-consensus signal: 'pending_consensus' (never the silent 'submitted'
 * fallback that was used pre-Phase-4).
 */

import {
  fetchPhotoConsensus,
  buildPhotoStatusMaps,
  type PerPhotoStatus,
  type PhotoStatusMap,
} from "@/hooks/judging/usePhotoDecisions";
import {
  fetchPhotoPlacements,
  buildPhotoPlacementMaps,
} from "@/hooks/judging/usePhotoPlacements";
import { mergeConsensusAndPlacement } from "@/lib/judging/mergeConsensusAndPlacement";

export type { PerPhotoStatus, PhotoStatusMap };

/** @deprecated Internal type kept for API compatibility. */
export interface JudgeDecisionRow {
  entry_id: string;
  judge_id: string;
  decision: string;
  round_number: number;
  photo_index: number;
}

/**
 * @deprecated Phase 4 — use the DB function `get_per_photo_consensus` via
 * `usePhotoDecisions` hook. This local derivation no longer matches server
 * truth (no SOW tie-break, returned silent 'submitted' on no-consensus).
 *
 * Kept as a no-op stub returning 'pending_consensus' so any straggler
 * callers fail loudly rather than silently disagree with the server.
 */
export interface PerPhotoStatusInputs {
  decisions: { decision: string; round_number: number }[];
  totalJudges: number;
  threshold?: number;
  minJudges?: number;
}
export function derivePhotoStatus(_inputs: PerPhotoStatusInputs): PerPhotoStatus {
  // Intentionally returns the "no decision" sentinel. The previous local
  // algorithm diverged from the server (silent 'submitted' default + no
  // SOW tie-break). Callers should migrate to fetchPhotoStatusMaps below.
  return "pending_consensus";
}

/**
 * Fetch per-photo status maps for a batch of entries.
 *
 * Phase 4: now a thin wrapper around the `get_per_photo_consensus` RPC.
 * The `competitionIds` and `options.viewerRole` parameters are kept for
 * API compatibility but are no longer required — the RPC enforces
 * privacy (admin / owner / assigned-judge) server-side via SECURITY DEFINER.
 */
export async function fetchPhotoStatusMaps(
  entryIds: string[],
  _competitionIds?: string[],
  options?: { viewerRole?: "owner" | "judge" | "admin"; publishedRounds?: ReadonlySet<number> },
): Promise<Map<string, PhotoStatusMap>> {
  if (entryIds.length === 0) return new Map();
  // Phase 3 wiring: fetch consensus + R4 placement in parallel, then merge.
  // Placement always wins on overlap (R4 award supersedes per-round consensus).
  // Both RPCs are SECURITY DEFINER and privacy-gated server-side.
  const [consensusRows, placementRows] = await Promise.all([
    fetchPhotoConsensus(entryIds),
    fetchPhotoPlacements(entryIds),
  ]);
  // Privacy gate: drop consensus rows for rounds that have NOT been
  // declared by the admin (publish-round). Prevents in-progress later
  // round decisions from leaking onto the participant view.
  const consensusMap = buildPhotoStatusMaps(consensusRows, options?.publishedRounds);
  const placementRowsForViewer = options?.viewerRole === "admin" || options?.viewerRole === "judge"
    ? placementRows
    : placementRows.filter((row) => row.declared && (!options?.publishedRounds || options.publishedRounds.has(4)));
  const placementMap = buildPhotoPlacementMaps(placementRowsForViewer);
  return mergeConsensusAndPlacement(consensusMap, placementMap);
}
