import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface CompetitionVoteRealtimeOptions {
  competitionId?: string | null;
  includeDashboard?: boolean;
}

export function useCompetitionVoteRealtime({
  competitionId,
  includeDashboard = false,
}: CompetitionVoteRealtimeOptions) {
  const qc = useQueryClient();

  useEffect(() => {
    let timeoutId: number | undefined;

    const scheduleInvalidate = () => {
      if (timeoutId) window.clearTimeout(timeoutId);

      timeoutId = window.setTimeout(() => {
        if (competitionId) {
          void qc.invalidateQueries({ queryKey: ["competition-entries", competitionId] });
        }

        if (includeDashboard) {
          void qc.invalidateQueries({ queryKey: ["dashboard-init"] });
        }
      }, 120);
    };

    const channel = supabase
      .channel(`competition-vote-sync:${competitionId ?? "global"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "competition_votes" }, scheduleInvalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_vote_adjustments" }, scheduleInvalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "competition_entries" }, scheduleInvalidate)
      .subscribe();

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      void supabase.removeChannel(channel);
    };
  }, [competitionId, includeDashboard, qc]);
}