import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchInBatches } from "./types";
import { fetchCompetitionsByIds } from "@/hooks/competition/useCompetitions";
import type { Competition } from "./types";
import { resolvePhase } from "@/lib/competitionPhase";

interface CompetitionWithCover extends Competition { cover_image_url?: string; }

const JUDGE_VISIBLE_PHASES = new Set(["submission_open", "voting", "judging", "result"]);

async function fetchJudgeCompetitions(userId: string, isAdmin: boolean): Promise<CompetitionWithCover[]> {
  let compIds: string[] = [];

  if (isAdmin) {
    const { data } = await supabase
      .from("competitions")
      .select("id, title, category, status, phase, starts_at, ends_at, voting_ends_at, judging_completed, cover_image_url")
      .order("ends_at", { ascending: true });
    if (!data || data.length === 0) return [];

    const visibleCompetitions = data
      .map((competition) => ({
        ...competition,
        phase: resolvePhase(competition),
      }))
      .filter((competition) => JUDGE_VISIBLE_PHASES.has(competition.phase));

    if (visibleCompetitions.length === 0) return [];

    compIds = visibleCompetitions.map((competition) => competition.id);

    const entryRows = await fetchInBatches(
      (ids) => supabase.from("competition_entries").select("competition_id").in("competition_id", ids),
      compIds,
    );
    const countMap: Record<string, number> = {};
    entryRows.forEach((e: any) => {
      countMap[e.competition_id] = (countMap[e.competition_id] || 0) + 1;
    });
    return visibleCompetitions.map(c => ({
      ...c,
      entry_count: countMap[c.id] || 0,
    }));
  }

  // Judge: only assigned competitions
  const { data: assignments } = await supabase
    .from("competition_judges")
    .select("competition_id")
    .eq("judge_id", userId);
  if (!assignments || assignments.length === 0) return [];

  compIds = assignments.map((a: any) => a.competition_id);
  const compMap = await fetchCompetitionsByIds(compIds);
  const filteredComps = Array.from(compMap.entries())
    .filter(([, c]) => JUDGE_VISIBLE_PHASES.has(c.phase))
    .map(([id, c]) => ({
      id,
      title: c.title,
      category: c.category,
      status: c.status,
      phase: c.phase,
      ends_at: c.ends_at,
      voting_ends_at: c.voting_ends_at,
      cover_image_url: c.cover_image_url,
    }))
    .sort((a, b) => new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime());

  if (filteredComps.length === 0) return [];

  const judgeEntryRows = await fetchInBatches(
    (ids) => supabase.from("competition_entries").select("competition_id").in("competition_id", ids),
    filteredComps.map(c => c.id),
  );
  const countMap2: Record<string, number> = {};
  judgeEntryRows.forEach((e: any) => {
    countMap2[e.competition_id] = (countMap2[e.competition_id] || 0) + 1;
  });

  return filteredComps.map(c => ({ ...c, entry_count: countMap2[c.id] || 0 }));
}

export function useJudgeCompetitions(userId: string | undefined, isAdmin: boolean, isJudge: boolean) {
  const query = useQuery({
    queryKey: ["judge-competitions", userId, isAdmin],
    queryFn: () => fetchJudgeCompetitions(userId!, isAdmin),
    enabled: !!userId && isJudge,
    staleTime: 5 * 60 * 1000,
  });

  return {
    competitions: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
