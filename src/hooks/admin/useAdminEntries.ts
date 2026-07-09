import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { fetchCompetitionsByIds } from "@/hooks/competition/useCompetitions";
import { resolvePhase } from "@/lib/competitionPhase";

export interface AdminEntryRow {
  id: string;
  title: string;
  status: string;
  photos: string[];
  /** Lightweight WebP variants (~150-250KB) parallel to `photos`; null = no thumb generated. */
  photo_thumbnails: string[] | null;
  /** Per-photo metadata; `photo_meta[i].rejected` flags individually rejected photos. */
  photo_meta: any[] | null;
  created_at: string;
  user_id: string;
  competition_id: string;
  profiles: { full_name: string | null } | null;
  competition_title?: string;
  /** Step 20: canonical phase for the parent competition (resolvePhase). */
  competition_phase: string;
  /** Step 20: active judging round ("1"|"2"|"3"|"4"|null) when phase==="judging". */
  competition_current_round: string | null;
}

const fetchAdminEntries = async (): Promise<AdminEntryRow[]> => {
  const { data } = await supabase
    .from("competition_entries")
    .select("id, title, status, photos, photo_thumbnails, photo_meta, created_at, user_id, competition_id")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!data || data.length === 0) return [];

  const userIds = [...new Set(data.map((e) => e.user_id))];
  const compIds = [...new Set(data.map((e) => e.competition_id))];

  // Step 20: also fetch competition rows (with current_round) so we can attach
  // canonical phase to each admin entry — no local derivation.
  const [profileMap, compMap, compRoundsRes] = await Promise.all([
    cachedFetchProfilesByIds(userIds),
    fetchCompetitionsByIds(compIds),
    supabase.from("competitions").select("id, current_round").in("id", compIds),
  ]);

  const compTitleMap = new Map(
    Array.from(compMap.entries()).map(([id, c]) => [id, c.title])
  );
  // compMap entries already carry the resolved phase (via resolvePhase) from
  // fetchCompetitionsByIds — reuse it here so phase is consistent everywhere.
  const compPhaseMap = new Map(
    Array.from(compMap.entries()).map(([id, c]) => [id, c.phase])
  );
  const compRoundMap = new Map<string, string | null>(
    ((compRoundsRes.data as any[]) || []).map((c) => [c.id, c.current_round ?? null])
  );

  return data.map((e) => ({
    ...e,
    photo_thumbnails: Array.isArray((e as any).photo_thumbnails) ? ((e as any).photo_thumbnails as string[]) : null,
    photo_meta: Array.isArray((e as any).photo_meta) ? ((e as any).photo_meta as any[]) : null,
    profiles: profileMap.get(e.user_id)
      ? { id: e.user_id, full_name: profileMap.get(e.user_id)! }
      : null,
    competition_title: compTitleMap.get(e.competition_id) || "Unknown",
    competition_phase: compPhaseMap.get(e.competition_id) || "submission_open",
    competition_current_round: compRoundMap.get(e.competition_id) ?? null,
  }));
};

export const useAdminEntries = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.adminEntries(),
    queryFn: fetchAdminEntries,
  });

  return {
    entries: data ?? [],
    isLoading,
    error,
  };
};
