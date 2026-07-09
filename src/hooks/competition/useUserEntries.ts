import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { resolvePhase } from "@/lib/competitionPhase";

export interface BaseEntry {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  status: string;
  created_at: string;
  placement: string | null;
  competition_id: string;
  exif_data: any;
  /** SOW EXIF v2: per-photo metadata array (mirrors photos[] index). */
  photo_meta: any[] | null;
  competition: {
    title: string;
    /** Resolved competition phase. Step 20: required for `<PhaseWatermark/>`. */
    phase: string;
    /** Active judging round string ("1"|"2"|"3"|"4"|null) when phase === "judging". */
    current_round: string | null;
  } | null;
}

/**
 * Default page size for participant entry listings.
 *
 * Audit v6 / P-05 — the previous hard-coded `.limit(50)` silently truncated
 * heavy participants. The fetch is now paginated; callers that don't care
 * about pagination get the first `DEFAULT_PAGE_SIZE` rows, while pages that
 * render the full list use `useUserEntriesInfinite` to scroll through all of
 * them without losing visibility of older submissions.
 */
export const USER_ENTRIES_PAGE_SIZE = 24;

interface FetchUserEntriesOptions {
  /** Zero-indexed page number. Defaults to `0` (first page). */
  page?: number;
  /** Page size. Defaults to {@link USER_ENTRIES_PAGE_SIZE}. */
  pageSize?: number;
}

async function fetchUserEntries(
  userId: string,
  options: FetchUserEntriesOptions = {},
): Promise<BaseEntry[]> {
  const pageSize = options.pageSize ?? USER_ENTRIES_PAGE_SIZE;
  const page = options.page ?? 0;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error } = await supabase
    .from("competition_entries")
    .select(
      // Step 20: include phase, current_round, and date fields so resolvePhase()
      // can derive the canonical phase. Never derive locally — single source of truth.
      // F-04: exif_data is fetched separately via get_entries_private_meta RPC
      // (column-revoked from `authenticated` to prevent cross-user EXIF leak).
      "id, title, description, photos, status, created_at, placement, competition_id, photo_meta, competition:competitions(title, phase, current_round, status, starts_at, ends_at, voting_ends_at, judging_completed)"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const rows = (data as any[]) || [];

  // F-04: fetch EXIF via SECURITY DEFINER RPC. Only returns rows the caller
  // is authorized to see (owner / admin / assigned judge); others get null.
  let exifMap = new Map<string, any>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: metaRows } = await (supabase.rpc as any)(
      "get_entries_private_meta",
      { _entry_ids: ids },
    );
    exifMap = new Map(
      ((metaRows as any[]) || []).map((m) => [m.entry_id, m.exif_data]),
    );
  }

  // Resolve phase per row using the canonical resolver — keeps a single source
  // of truth (mirrors useCompetitionDetail / useCompetitions behaviour).
  return rows.map((row) => {
    const comp = row.competition;
    const withExif = { ...row, exif_data: exifMap.get(row.id) ?? null };
    if (!comp) return { ...withExif, competition: null } as BaseEntry;
    return {
      ...withExif,
      competition: {
        title: comp.title,
        phase: resolvePhase(comp),
        current_round: comp.current_round ?? null,
      },
    } as BaseEntry;
  });

}

/**
 * Single-page fetch — returns the first {@link USER_ENTRIES_PAGE_SIZE} entries.
 * Used by the dashboard summary card and other surfaces that only need a
 * preview slice. For the full participant entry list use
 * {@link useUserEntriesInfinite}.
 */
export function useUserEntries(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.userEntries(userId ?? ""),
    queryFn: () => fetchUserEntries(userId!),
    enabled: !!userId,
  });
}

/**
 * Paginated participant entry list. Audit v6 / P-05 — replaces the previous
 * hard-coded `.limit(50)` so heavy participants never silently lose older
 * entries. Pair with `<InfiniteScrollSentinel />` for the standard UX.
 */
export function useUserEntriesInfinite(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.userEntries(userId ?? ""), "infinite"] as const,
    queryFn: ({ pageParam = 0 }) =>
      fetchUserEntries(userId!, { page: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < USER_ENTRIES_PAGE_SIZE ? undefined : allPages.length,
    enabled: !!userId,
  });
}

export { fetchUserEntries };
