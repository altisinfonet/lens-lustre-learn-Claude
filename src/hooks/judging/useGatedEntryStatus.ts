/**
 * useGatedEntryStatus — SINGLE SOURCE OF TRUTH for entry visibility
 *
 * Reads from the DB function `get_gated_entry_status`, which combines:
 *   - entry_public_status view (publish-gated status / round / placement)
 *   - competition_round_publish (any-round-published flag)
 *
 * SOW Rule #5 / Audit v6 P-01..P-06:
 *   - Judge, Admin, and User panels MUST consume entry status ONLY via this hook.
 *   - Reading competition_entries.status / placement / progression_decision
 *     directly in UI code is forbidden — it leaks unpublished rounds.
 *
 * NOTE (2026-04 cleanup): The previous "Verification Required" workflow has
 * been removed. The DB still returns `has_pending_verification` /
 * `verification_overrides_status` columns for backwards compatibility but
 * they are now constant FALSE.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { participantStageLabel, PARTICIPANT_R4_TAG_TO_KEY, normalizePlacementKey } from "@/lib/judging/participantStageLabels";
import { queryKeys } from "@/lib/queryKeys";

export interface GatedEntryStatusRow {
  entry_id: string;
  competition_id: string;
  /** Publish-gated status. `judging_in_progress` when the relevant round is not yet published. */
  public_status: string;
  public_round: string | null;
  public_placement: string | null;
  public_progression_note: string | null;
  /** R4 visible tags (Top 50 / Top 100), surfaced only after R4 admin-published. */
  public_r4_tags: string[] | null;
  /** @deprecated Kept for back-compat; always false since the verification workflow was removed. */
  has_pending_verification: boolean;
  /** @deprecated Kept for back-compat; always false since the verification workflow was removed. */
  verification_overrides_status: boolean;
  /** True when at least one round has been admin-published for this competition. */
  is_published_any_round: boolean;
}

export type GatedEntryStatusMap = Record<string, GatedEntryStatusRow>;

export function useGatedEntryStatus(entryIds: string[]) {
  const sortedIds = [...new Set(entryIds.filter(Boolean))].sort();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.gatedEntryStatus(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<GatedEntryStatusMap> => {
      const { data, error } = await supabase.rpc("get_gated_entry_status" as any, {
        p_entry_ids: sortedIds,
      });
      if (error) {
        console.error("[useGatedEntryStatus] RPC failed", error);
        return {};
      }
      const map: GatedEntryStatusMap = {};
      for (const row of (data as any as GatedEntryStatusRow[]) || []) {
        map[row.entry_id] = row;
      }
      return map;
    },
  });

  // Realtime: when an admin (un)publishes any round, instantly invalidate
  // every gated-status query so Judge / Admin / User panels flip within seconds.
  useEffect(() => {
    if (sortedIds.length === 0) return;
    const channel = supabase
      .channel(`gated-status-${sortedIds[0]}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_round_publish" },
        () => {
          qc.invalidateQueries({ queryKey: queryKeys.gatedEntryStatusAll() });
          qc.invalidateQueries({ queryKey: queryKeys.entryPublicStatusAll() });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedIds.join(","), qc]);

  return query;
}

/**
 * Resolves the FINAL status string a UI should render for an entry,
 * honoring the publish gate.
 *
 * Use this everywhere instead of `entry.status`.
 */
export function resolveDisplayStatus(row: GatedEntryStatusRow | undefined | null): string {
  if (!row) return "judging_in_progress";

  // BUG-033: an award placement overrides public_status for the winner case.
  // public_placement is only populated post-R4-publish (gated in the view),
  // so consulting it here leaks nothing. Without this, a winner whose
  // public_status isn't literally 'winner' never passes WINNER_PUBLIC_KEYS.
  if (row.public_placement && normalizePlacementKey(row.public_placement) === "winner") {
    return "winner";
  }

  const baseStatus = row.public_status || "judging_in_progress";
  // Plan Phase 5 / Task 5.4 — R4 visible-tag → internal key mapping is
  // catalog-driven via PARTICIPANT_R4_TAG_TO_KEY (which itself derives from
  // v3_stage_catalog). No raw "Top 50" / "Top 100" strings live here anymore.
  if (
    baseStatus === "judging_in_progress" &&
    !row.public_placement &&
    row.public_r4_tags &&
    row.public_r4_tags.length > 0
  ) {
    for (const t of row.public_r4_tags) {
      const mapped = PARTICIPANT_R4_TAG_TO_KEY[t];
      if (mapped) return mapped;
    }
  }
  return baseStatus;
}

/**
 * Human label for any gated status. Spec v3 §7 canonical vocabulary.
 */
export function gatedStatusLabel(row: GatedEntryStatusRow | undefined | null): string {
  return participantStageLabel(resolveDisplayStatus(row));
}
