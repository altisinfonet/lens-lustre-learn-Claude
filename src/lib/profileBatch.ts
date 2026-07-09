/**
 * Shared utility for batch-fetching profile data by IDs.
 *
 * RAW FETCHERS (used as queryFn inside React Query):
 *   fetchProfilesByIds       → Map<id, full_name>
 *   fetchProfilesDetailByIds → Map<id, { full_name, avatar_url }>
 *
 * CACHED WRAPPERS (for imperative / non-hook code):
 *   cachedFetchProfilesByIds       — deduplicates, sorts, caches via QueryClient
 *   cachedFetchProfilesDetailByIds — same, with avatar
 *
 * Prefer the useProfileMap / useProfileDetailMap hooks when inside components.
 */
import { supabase } from "@/integrations/supabase/client";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/* ── Raw fetchers (always deduplicate + sort before calling) ── */

export async function fetchProfilesByIds(
  ids: string[]
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  // Use public view — base `profiles` table is RLS-locked to self/admins.
  const { data } = await (supabase.from("profiles_public_data" as any) as any)
    .select("id, full_name")
    .in("id", ids);
  return new Map((data as any[])?.map((p: any) => [p.id, p.full_name]) || []);
}

export async function fetchProfilesDetailByIds(
  ids: string[]
): Promise<Map<string, { full_name: string | null; avatar_url: string | null }>> {
  if (ids.length === 0) return new Map();
  const { data } = await (supabase.from("profiles_public_data" as any) as any)
    .select("id, full_name, avatar_url")
    .in("id", ids);
  return new Map(
    (data as any[])?.map((p: any) => [p.id, { full_name: p.full_name, avatar_url: p.avatar_url }]) || []
  );
}

/* ── Cached wrappers for imperative code ── */

let _qc: QueryClient | null = null;

/** Call once from App.tsx to wire up the shared QueryClient */
export function setProfileBatchQueryClient(qc: QueryClient) {
  _qc = qc;
}

function dedupeAndSort(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Cached fetch: deduplicates IDs, sorts for stable key, and goes through
 * React Query so the same ID set is never refetched within staleTime.
 */
export async function cachedFetchProfilesByIds(
  ids: string[]
): Promise<Map<string, string | null>> {
  const sorted = dedupeAndSort(ids);
  if (sorted.length === 0) return new Map();
  if (!_qc) return fetchProfilesByIds(sorted);
  return _qc.fetchQuery({
    queryKey: queryKeys.profileNameMap(sorted),
    queryFn: () => fetchProfilesByIds(sorted),
  });
}

export async function cachedFetchProfilesDetailByIds(
  ids: string[]
): Promise<Map<string, { full_name: string | null; avatar_url: string | null }>> {
  const sorted = dedupeAndSort(ids);
  if (sorted.length === 0) return new Map();
  if (!_qc) return fetchProfilesDetailByIds(sorted);
  return _qc.fetchQuery({
    queryKey: queryKeys.profileDetailMap(sorted),
    queryFn: () => fetchProfilesDetailByIds(sorted),
  });
}
