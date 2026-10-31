/**
 * useEntryPublicStatus — Judging v5 / Rule #5  (DELEGATES to useGatedEntryStatus)
 *
 * As of the unified publish-gate refactor, this hook is a thin compatibility
 * wrapper around `useGatedEntryStatus`, which is the single source of truth
 * combining: entry_public_status view + photo_verification_requests +
 * competition_round_publish.
 *
 * NEW CODE SHOULD IMPORT `useGatedEntryStatus` DIRECTLY for access to the
 * verification-override flag. This wrapper exists only to preserve the older
 * row shape consumed by PublicProfile, AdminRoundVisibilityAudit, etc.
 */
import { useMemo } from "react";
import { useGatedEntryStatus, resolveDisplayStatus } from "./useGatedEntryStatus";
import { participantStageLabel } from "@/lib/judging/participantStageLabels";

export interface EntryPublicStatusRow {
  entry_id: string;
  competition_id: string;
  public_status: string;
  public_round: string | null;
  public_placement: string | null;
  /** R4 visible tags (Top 50 / Top 100) — only after R4 declared. */
  public_r4_tags: string[] | null;
}

export function useEntryPublicStatus(entryIds: string[]) {
  const gated = useGatedEntryStatus(entryIds);
  const data = useMemo(() => {
    if (!gated.data) return undefined;
    const out: Record<string, EntryPublicStatusRow> = {};
    for (const [id, row] of Object.entries(gated.data)) {
      // Verification holds collapse status to needs_review for ALL legacy callers
      const display = resolveDisplayStatus(row);
      out[id] = {
        entry_id: row.entry_id,
        competition_id: row.competition_id,
        public_status: display,
        public_round: row.public_round,
        public_placement: row.public_placement,
        public_r4_tags: row.public_r4_tags,
      };
    }
    return out;
  }, [gated.data]);
  return { ...gated, data } as typeof gated;
}

/**
 * Convenience: human-readable label for the photographer's submission card.
 *
 * Plan Phase 5 / Task 5.4 — delegates to participantStageLabel(), which reads
 * PARTICIPANT_LABELS (byte-identical mirror of v3_stage_catalog.tag_label_canonical).
 * No label string is hardcoded here.
 */
export function publicStatusLabel(status: string | null | undefined): string {
  if (!status || status === "judging_in_progress") return "Judging in progress";
  return participantStageLabel(status);
}
