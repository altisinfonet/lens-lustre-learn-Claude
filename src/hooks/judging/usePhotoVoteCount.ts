import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-photo FINAL vote count for the judging Cinema view.
 *
 * Mirrors the `entry_final_votes` view formula at the photo level:
 *   final = real_votes (COUNT competition_votes)
 *         + adjustment_total (SUM admin_vote_adjustments.adjustment_value)
 *
 * Visibility: judges/admins ONLY (gated by the consumer).
 * Per-photo policy ('One Image, One Vote') — scoped to (entry_id, photo_index).
 *
 * Realtime: subscribes to BOTH competition_votes and admin_vote_adjustments
 * for this entry so the badge reflects the latest final count instantly.
 */
export function usePhotoVoteCount(entryId: string | null | undefined, photoIndex: number | null | undefined) {
  const qc = useQueryClient();
  const enabled = !!entryId && photoIndex != null;

  useEffect(() => {
    if (!enabled) return;
    const invalidate = (payload: any) => {
      const row = (payload?.new ?? payload?.old) as { photo_index?: number } | null;
      if (!row || row.photo_index === photoIndex) {
        void qc.invalidateQueries({ queryKey: ["photo-vote-count", entryId, photoIndex] });
      }
    };
    const channel = supabase
      .channel(`photo-vote-count:${entryId}:${photoIndex}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_votes", filter: `entry_id=eq.${entryId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_vote_adjustments", filter: `entry_id=eq.${entryId}` },
        invalidate,
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, entryId, photoIndex, qc]);

  return useQuery({
    queryKey: ["photo-vote-count", entryId, photoIndex],
    enabled,
    staleTime: 0,
    queryFn: async () => {
      // Single source of truth: photo-grain entry_final_votes view (Phase 1).
      // Eliminates client-side formula divergence with the server.
      const { data, error } = await supabase
        .from("entry_final_votes" as any)
        .select("final_votes")
        .eq("entry_id", entryId!)
        .eq("photo_index", photoIndex!)
        .maybeSingle();
      if (error) throw error;
      return Math.max(0, Number((data as any)?.final_votes ?? 0));
    },
  });
}
