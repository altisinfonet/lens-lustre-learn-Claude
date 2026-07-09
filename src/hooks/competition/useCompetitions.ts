import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { resolvePhase } from "@/lib/competitionPhase";

export interface CompetitionListItem {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  category: string;
  entry_fee: number;
  prize_info: string | null;
  status: string;
  phase: string;
  starts_at: string;
  ends_at: string;
  voting_ends_at: string | null;
}

export interface CompetitionMapEntry {
  title: string;
  slug: string | null;
  status: string;
  phase: string;
  current_round: string | null;
  category: string;
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string;
  voting_ends_at: string | null;
}

export type CompetitionMap = Map<string, CompetitionMapEntry>;

/**
 * Fetch competitions by IDs — returns a Map for O(1) lookup.
 * Results are cached via the "all" competitions query to avoid duplicates.
 */
export async function fetchCompetitionsByIds(ids: string[]): Promise<CompetitionMap> {
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("competitions")
    .select("id, slug, title, status, phase, current_round, category, cover_image_url, starts_at, ends_at, voting_ends_at, judging_completed")
    .in("id", ids);

  if (error) throw error;

  const map: CompetitionMap = new Map();
  (data || []).forEach((c) => {
    map.set(c.id, {
      title: c.title,
      slug: (c as any).slug ?? null,
      status: c.status,
      phase: resolvePhase(c),
      current_round: (c as any).current_round ?? null,
      category: c.category,
      cover_image_url: c.cover_image_url,
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      voting_ends_at: c.voting_ends_at,
    });
  });
  return map;
}

/** Hook: fetch full competition list with optional phase filter */
export const useCompetitions = (phaseFilter?: string) => {
  return useQuery({
    queryKey: queryKeys.competitions(phaseFilter || "all"),
    queryFn: async (): Promise<CompetitionListItem[]> => {
      let query = supabase
        .from("competitions")
        .select("id, slug, title, description, cover_image_url, category, entry_fee, prize_info, status, phase, starts_at, ends_at, voting_ends_at, judging_completed")
        .order("updated_at", { ascending: false });

      // Phase is now auto-derived, filter client-side after fetch


      const { data, error } = await query;
      if (error) throw error;
      const all = (data || []).map((c) => ({
        ...c,
        phase: resolvePhase(c),
      })) as CompetitionListItem[];
      if (phaseFilter && phaseFilter !== "all") {
        return all.filter((c) => c.phase === phaseFilter);
      }
      return all;
    },
  });
};
