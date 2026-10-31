import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { resolveCompetitionPhase } from "@/lib/competitionPhase";

export interface AdminCompetition {
  id: string;
  title: string;
  category: string;
  status: string;
  phase: string;
  entry_fee: number | null;
  starts_at: string;
  ends_at: string;
  voting_ends_at: string | null;
  judging_completed: boolean;
  created_at: string;
}

const fetchAdminCompetitions = async (): Promise<AdminCompetition[]> => {
  const { data } = await supabase
    .from("competitions")
    .select("id, title, category, status, phase, entry_fee, starts_at, ends_at, voting_ends_at, judging_completed, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (data || []).map((c) => ({
    ...c,
    phase: resolveCompetitionPhase(c),
  }));
};

export const useAdminCompetitions = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.adminCompetitions(),
    queryFn: fetchAdminCompetitions,
  });

  return {
    competitions: data ?? [],
    isLoading,
    error,
  };
};
