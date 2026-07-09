/**
 * Phase 5 Step 5.1 — Multi-Judge Progress Hook
 * Fetches other judges' session progress + score counts for a competition.
 * Subscribes to realtime updates on judge_sessions and judge_scores.
 */
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface JudgeProgress {
  judgeId: string;
  judgeName: string;
  judgeAvatar: string | null;
  status: "active" | "paused" | "completed" | string;
  elapsedSeconds: number;
  scoredCount: number;
  totalEntries: number;
}

export function useMultiJudgeProgress(
  competitionId: string | null,
  currentUserId: string | undefined,
) {
  const qc = useQueryClient();
  const queryKey = ["multi-judge-progress", competitionId];

  const { data: judges = [], isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<JudgeProgress[]> => {
      if (!competitionId) return [];

      // 1. Get all judges assigned to this competition
      const { data: assignments } = await supabase
        .from("competition_judges")
        .select("judge_id")
        .eq("competition_id", competitionId);

      if (!assignments || assignments.length === 0) return [];

      const judgeIds = assignments.map((a) => a.judge_id);

      // 2. Get profiles for names/avatars
      const { data: profiles } = await supabase
        .from("profiles_public_data")
        .select("id, full_name, avatar_url")
        .in("id", judgeIds);

      const profileMap = new Map<string, { name: string; avatar: string | null }>();
      profiles?.forEach((p, idx) => {
        profileMap.set(p.id, { name: p.full_name || `Judge #${idx + 1}`, avatar: p.avatar_url });
      });

      // 3. Get sessions for status/elapsed
      const { data: sessions } = await supabase
        .from("judge_sessions" as any)
        .select("judge_id, status, elapsed_seconds")
        .eq("competition_id", competitionId)
        .in("judge_id", judgeIds);

      const sessionMap = new Map<string, { status: string; elapsed: number }>();
      (sessions as any[])?.forEach((s) => {
        sessionMap.set(s.judge_id, { status: s.status, elapsed: s.elapsed_seconds || 0 });
      });

      // 4. Get score counts per judge
      // Get all entry IDs for this competition
      const { data: entries } = await supabase
        .from("competition_entries")
        .select("id")
        .eq("competition_id", competitionId);

      const entryIds = entries?.map((e) => e.id) || [];
      const totalEntries = entryIds.length;

      // Count scores per judge
      const scoreCounts = new Map<string, number>();
      if (entryIds.length > 0) {
        const { data: scores } = await supabase
          .from("judge_scores")
          .select("judge_id")
          .in("entry_id", entryIds.slice(0, 500)); // Limit query size

        (scores as any[])?.forEach((s) => {
          scoreCounts.set(s.judge_id, (scoreCounts.get(s.judge_id) || 0) + 1);
        });

        // Also count R1 decisions
        const { data: decisions } = await supabase
          .from("judge_decisions")
          .select("judge_id")
          .in("entry_id", entryIds.slice(0, 500));

        (decisions as any[])?.forEach((d) => {
          scoreCounts.set(d.judge_id, (scoreCounts.get(d.judge_id) || 0) + 1);
        });
      }

      return judgeIds.map((id, idx) => {
        const profile = profileMap.get(id);
        const session = sessionMap.get(id);
        return {
          judgeId: id,
          judgeName: profile?.name || `Judge #${idx + 1}`,
          judgeAvatar: profile?.avatar || null,
          status: session?.status || "inactive",
          elapsedSeconds: session?.elapsed || 0,
          scoredCount: scoreCounts.get(id) || 0,
          totalEntries,
        };
      });
    },
    enabled: !!competitionId,
    staleTime: 30_000,
    refetchInterval: 30_000, // Poll every 30s as backup
  });

  // Realtime subscription on judge_sessions for this competition
  useEffect(() => {
    if (!competitionId) return;

    const channel = supabase
      .channel(`judge-progress-${competitionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "judge_sessions", filter: `competition_id=eq.${competitionId}` },
        () => { qc.invalidateQueries({ queryKey }); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "judge_scores" },
        () => { qc.invalidateQueries({ queryKey }); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "judge_decisions" },
        () => { qc.invalidateQueries({ queryKey }); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [competitionId, qc, queryKey]);

  // Separate current user from others
  const otherJudges = useMemo(
    () => judges.filter((j) => j.judgeId !== currentUserId),
    [judges, currentUserId]
  );

  const myProgress = useMemo(
    () => judges.find((j) => j.judgeId === currentUserId) || null,
    [judges, currentUserId]
  );

  return { judges, otherJudges, myProgress, isLoading };
}
