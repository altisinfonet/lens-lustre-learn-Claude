/**
 * Global profile + badge + role batch fetcher with QueryClient caching.
 *
 * One call replaces separate profilesPublic(), user_badges, user_roles queries.
 * Results are cached via React Query so the same ID set is never refetched within staleTime.
 */
import { supabase } from "@/integrations/supabase/client";
import { QueryClient } from "@tanstack/react-query";
import { profilesPublic } from "@/lib/profilesPublic";
import { queryKeys } from "@/lib/queryKeys";

export interface ProfileMapEntry {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  badges: string[];
  roles: string[];
}

export type ProfileMap = Map<string, ProfileMapEntry>;

let _qc: QueryClient | null = null;
let _realtimeSubscribed = false;

export function setProfileMapQueryClient(qc: QueryClient) {
  _qc = qc;

  // Subscribe to realtime changes on user_badges to auto-invalidate cache
  if (!_realtimeSubscribed) {
    _realtimeSubscribed = true;
    supabase
      .channel("profile-map-badges")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_badges" },
        (payload: any) => {
          const changedUserId = payload?.new?.user_id ?? payload?.old?.user_id;
          if (_qc && changedUserId) {
            void _qc.invalidateQueries({ queryKey: queryKeys.profileMap([changedUserId]) });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles" },
        (payload: any) => {
          const changedUserId = payload?.new?.user_id ?? payload?.old?.user_id;
          if (_qc && changedUserId) {
            void _qc.invalidateQueries({ queryKey: queryKeys.profileMap([changedUserId]) });
          }
        },
      )
      .subscribe();
  }
}

/**
 * Invalidate profile-map cache entries. Pass a userId to invalidate all
 * profile-map queries (any key starting with ["profile-map"] — single-user
 * keyed entries cannot be cherry-picked because most queries are keyed by
 * sorted multi-ID arrays). Pass nothing for a full bust.
 */
export function invalidateProfileMap(_userId?: string) {
  if (!_qc) return;
  void _qc.invalidateQueries({ queryKey: ["profile-map"] });
}

function dedupeAndSort(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

async function rawFetchProfileMap(sortedIds: string[]): Promise<ProfileMap> {
  if (sortedIds.length === 0) return new Map();

  const [profilesRes, badgesRes, rolesRes] = await Promise.all([
    profilesPublic().select("id, full_name, avatar_url").in("id", sortedIds),
    supabase.from("user_badges").select("user_id, badge_type").in("user_id", sortedIds),
    // F2: anon-safe RPC; returns only registered_photographer/student/content_editor
    supabase.rpc("get_public_roles_for_users", { _user_ids: sortedIds } as any),
  ]);

  const badgeMap = new Map<string, string[]>();
  ((badgesRes.data as any[]) || []).forEach((b: any) => {
    const arr = badgeMap.get(b.user_id) || [];
    arr.push(b.badge_type);
    badgeMap.set(b.user_id, arr);
  });

  const roleMap = new Map<string, string[]>();
  ((rolesRes.data as any[]) || []).forEach((r: any) => {
    const arr = roleMap.get(r.user_id) || [];
    arr.push(r.role);
    roleMap.set(r.user_id, arr);
  });

  const result: ProfileMap = new Map();
  ((profilesRes.data as any[]) || []).forEach((p: any) => {
    result.set(p.id, {
      id: p.id,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      badges: badgeMap.get(p.id) || [],
      roles: roleMap.get(p.id) || [],
    });
  });

  // Ensure every requested ID exists in the map (even if not found in DB)
  for (const id of sortedIds) {
    if (!result.has(id)) {
      result.set(id, {
        id,
        full_name: null,
        avatar_url: null,
        badges: [],
        roles: [],
      });
    }
  }

  return result;
}

/**
 * Direct fetch (no QueryClient indirection). Safe to use inside useQuery queryFn.
 */
export async function fetchProfileMapDirect(ids: string[]): Promise<ProfileMap> {
  const sorted = dedupeAndSort(ids);
  if (sorted.length === 0) return new Map();
  return rawFetchProfileMap(sorted);
}

/**
 * Fetch profiles + badges + roles for a set of user IDs.
 * Uses QueryClient cache when available for imperative callers.
 */
export async function fetchProfileMap(ids: string[]): Promise<ProfileMap> {
  const sorted = dedupeAndSort(ids);
  if (sorted.length === 0) return new Map();
  if (!_qc) return rawFetchProfileMap(sorted);
  return _qc.fetchQuery({
    queryKey: queryKeys.profileMap(sorted),
    queryFn: () => rawFetchProfileMap(sorted),
  });
}
