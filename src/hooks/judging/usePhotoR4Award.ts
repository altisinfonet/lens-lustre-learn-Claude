/**
 * usePhotoR4Award — R4-only reader (Phase 4 / R4-only-table plan).
 *
 * Reads from `judge_award_tags` (R4-only table). For each (entry, photo)
 * across ALL judges, returns the SINGLE highest-priority award per the
 * SOW priority order:
 *
 *   r4_winner > r4_runner_up_1 > r4_runner_up_2 > r4_special_jury
 *   > r4_honorary_mention > r4_top_50 > r4_top_100 > r4_finalist
 *
 * LABEL SOURCE OF TRUTH: PARTICIPANT_LABELS (NOT v3_stage_catalog).
 * The RPC intentionally returns only stage_keys; the label is mapped
 * client-side to keep a single TS source for participant wording.
 *
 * UI MUST render only `participant_label`. `all_stage_keys` is debug-only
 * and must NEVER be rendered to participants.
 *
 * R1–R3 are unaffected — those flow through `get_per_photo_consensus`.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PARTICIPANT_LABELS } from "@/lib/judging/participantWording";

export interface PhotoR4AwardRow {
  entry_id: string;
  photo_index: number;
  stage_key: string;
  all_stage_keys: string[];
}

export interface PhotoR4Award extends PhotoR4AwardRow {
  /** Resolved client-side via PARTICIPANT_LABELS — never from v3_stage_catalog. */
  participant_label: string;
}

function resolveLabel(stage_key: string): string {
  return PARTICIPANT_LABELS[stage_key] ?? stage_key;
}

export async function fetchPhotoR4Awards(
  entryIds: string[],
): Promise<PhotoR4Award[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await (supabase.rpc as any)("get_photo_r4_awards", {
    p_entry_ids: entryIds,
  });
  if (error) {
    console.error("[usePhotoR4Award] RPC failed:", error);
    return [];
  }
  return ((data as PhotoR4AwardRow[]) || []).map((r) => ({
    ...r,
    participant_label: resolveLabel(r.stage_key),
  }));
}

export function usePhotoR4Awards(entryIds: string[]) {
  const sorted = [...entryIds].sort();
  const query = useQuery({
    queryKey: ["photo-r4-awards", sorted],
    queryFn: () => fetchPhotoR4Awards(sorted),
    enabled: sorted.length > 0,
    staleTime: 30_000,
  });
  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
