/**
 * useJudgeRounds — Phase 1, Step 1.2 (REBUILT)
 * Fetches rounds and tags for a competition.
 * 
 * KEY FIX: NO auto-activation. Active round = round with status "active" in DB.
 * If no round is active, activeRound is NULL (UI must show "Begin Judging" gate).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { JudgingTag, JudgingRound } from "./types";

interface MetaResult {
  tags: JudgingTag[];
  rounds: JudgingRound[];
}

async function fetchCompetitionMeta(compId: string): Promise<MetaResult> {
  // Tags
  const { data: compTags } = await supabase
    .from("competition_judging_tags" as any)
    .select("tag_id")
    .eq("competition_id", compId);

  let tags: JudgingTag[] = [];
  if (compTags && (compTags as any[]).length > 0) {
    const tagIds = (compTags as any[]).map((ct: any) => ct.tag_id);
    const { data } = await supabase
      .from("judging_tags" as any)
      .select("id, label, color, icon, image_url, visible_in_round")
      .in("id", tagIds)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    tags = (data as any as JudgingTag[]) || [];
  } else {
    const { data } = await supabase
      .from("judging_tags" as any)
      .select("id, label, color, icon, image_url, visible_in_round")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    tags = (data as any as JudgingTag[]) || [];
  }

  // Rounds
  const { data: roundsData } = await supabase
    .from("judging_rounds" as any)
    .select("id, round_number, name, status")
    .eq("competition_id", compId)
    .order("round_number", { ascending: true });

  const rounds = (roundsData as any as JudgingRound[]) || [];

  return { tags, rounds };
}

export function useJudgeRounds(competitionId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["judge-rounds", competitionId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchCompetitionMeta(competitionId!),
    enabled: !!competitionId,
    staleTime: 60_000,
  });

  const updateRound = useCallback(
    (roundId: string, patch: Partial<JudgingRound>) => {
      qc.setQueryData<MetaResult>(queryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          rounds: old.rounds.map((r) => (r.id === roundId ? { ...r, ...patch } : r)),
        };
      });
    },
    [qc, queryKey],
  );

  const addTag = useCallback(
    (tag: JudgingTag) => {
      qc.setQueryData<MetaResult>(queryKey, (old) => {
        if (!old) return old;
        return { ...old, tags: [...old.tags, tag] };
      });
    },
    [qc, queryKey],
  );

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey });
  }, [qc, queryKey]);

  // Realtime: auto-refetch when judging_rounds changes for this competition
  useEffect(() => {
    if (!competitionId) return;
    const channel = supabase
      .channel(`judge-rounds-rt-${competitionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "judging_rounds" }, (payload) => {
        const cid = (payload.new as any)?.competition_id || (payload.old as any)?.competition_id;
        if (cid === competitionId) qc.invalidateQueries({ queryKey });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [competitionId, qc, queryKey]);

  const tags = query.data?.tags ?? [];
  const rounds = query.data?.rounds ?? [];
  
  // KEY FIX: activeRound is ONLY the round with status "active" — NO fallback to first round
  const activeRound = rounds.find((r) => r.status === "active") || null;

  return {
    tags,
    rounds,
    activeRound,
    isLoading: query.isLoading,
    updateRound,
    addTag,
    invalidate,
  };
}
