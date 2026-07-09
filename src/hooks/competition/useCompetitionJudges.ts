import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { fetchProfilesByIds, fetchProfilesDetailByIds } from "@/lib/profileBatch";

export interface JudgeAssignment {
  id: string;
  competition_id: string;
  judge_id: string;
  assigned_at: string;
  assigned_by: string;
}

export interface JudgeProfile {
  id: string;
  full_name: string | null;
}

/** Fetch all competition_judges rows (optionally filtered by competition) */
async function fetchJudgeAssignments(competitionId?: string): Promise<JudgeAssignment[]> {
  let q = supabase.from("competition_judges").select("id, competition_id, judge_id, assigned_at, assigned_by");
  if (competitionId) q = q.eq("competition_id", competitionId);
  const { data } = await q;
  return (data as JudgeAssignment[]) || [];
}

/** Hook: all judge assignments for a specific competition (shared cache) */
export function useCompetitionJudgeAssignments(competitionId: string) {
  return useQuery({
    queryKey: queryKeys.competitionJudges(competitionId),
    queryFn: () => fetchJudgeAssignments(competitionId),
  });
}

/** Hook: name-only profile map for a set of user IDs (lightweight, shared cache) */
export function useProfileNameMap(userIds: string[]) {
  const sorted = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: queryKeys.profileNameMap(sorted),
    queryFn: () => fetchProfilesByIds(sorted),
    enabled: sorted.length > 0,
  });
}

/** Hook: profile detail map (name + avatar) for a set of user IDs (shared cache) */
export function useProfileDetailMap(userIds: string[]) {
  const sorted = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: queryKeys.profileDetailMap(sorted),
    queryFn: () => fetchProfilesDetailByIds(sorted),
    enabled: sorted.length > 0,
  });
}

/** Hook: candidates eligible to be assigned as a judge for a competition.
 *  Per stakeholder policy 2026-04-19: both `judge` role and `admin` role users
 *  appear in the picker (deduplicated). The admin who creates a competition
 *  must explicitly choose which judges/admins evaluate it — no auto-enrolment.
 *  This makes admin decisions count as legitimate judge decisions and removes
 *  the need for any coverage-gate bypass. */
export function useJuryUsers() {
  return useQuery({
    queryKey: queryKeys.juryUsers(),
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["judge", "admin"]);
      if (!data || data.length === 0) return [];
      const userIds = [...new Set(data.map((r) => r.user_id))];
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      return userIds.map((uid) => ({
        user_id: uid,
        full_name: profiles?.find((p) => p.id === uid)?.full_name || null,
      }));
    },
  });
}

/** Hook: all judge assignments across all competitions with resolved names */
export function useAllCompetitionJudgeNames(competitionIds: string[]) {
  const sorted = [...new Set(competitionIds)].sort();
  return useQuery({
    queryKey: queryKeys.allCompetitionJudges(sorted),
    queryFn: async () => {
      if (sorted.length === 0) return new Map<string, string[]>();
      const { data: judges } = await supabase
        .from("competition_judges")
        .select("competition_id, judge_id")
        .in("competition_id", sorted);
      if (!judges || judges.length === 0) return new Map<string, string[]>();

      const judgeIds = [...new Set(judges.map((j) => j.judge_id))];
      const profileMap = await fetchProfilesByIds(judgeIds);

      const result = new Map<string, string[]>();
      for (const j of judges) {
        const names = result.get(j.competition_id) || [];
        names.push(profileMap.get(j.judge_id) || "Unknown");
        result.set(j.competition_id, names);
      }
      return result;
    },
    enabled: sorted.length > 0,
  });
}

/** Invalidate judge assignments for a competition */
export function useInvalidateJudges() {
  const qc = useQueryClient();
  return (competitionId: string) => {
    qc.invalidateQueries({ queryKey: queryKeys.competitionJudges(competitionId) });
    qc.invalidateQueries({ queryKey: queryKeys.allCompetitionJudgesPrefix() });
  };
}
