import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchProfileMapDirect, ProfileMapEntry } from "@/lib/profileMapCache";
import { queryKeys } from "@/lib/queryKeys";

/**
 * React Query hook for batch-fetching profiles + badges + roles.
 * Dedupes and sorts IDs for a stable cache key.
 *
 * CRITICAL: The sorted array is memoised via ref comparison to prevent
 * infinite re-render loops (AutoBadge was hitting 4000+ renders/sec).
 */
export function useProfileMap(userIds: string[]) {
  // Stabilise the sorted ID list so the query key reference doesn't change
  // on every render when the *contents* haven't changed.
  const prevRef = useRef<string[]>([]);

  const sorted = useMemo(() => {
    const next = [...new Set(userIds)].sort();
    const prev = prevRef.current;
    if (
      next.length === prev.length &&
      next.every((id, i) => id === prev[i])
    ) {
      return prev; // same contents → same reference
    }
    prevRef.current = next;
    return next;
  }, [userIds]);

  const enabled = sorted.length > 0;

  const query = useQuery({
    queryKey: queryKeys.profileMap(sorted),
    queryFn: () => fetchProfileMapDirect(sorted),
    enabled,
    staleTime: 5 * 60_000,
  });

  const profileMap = useMemo(() => {
    const map: Record<string, ProfileMapEntry> = {};
    if (query.data) {
      query.data.forEach((entry, id) => {
        map[id] = entry;
      });
    }
    return map;
  }, [query.data]);

  return useMemo(
    () => ({ profileMap, isLoading: query.isLoading && enabled }),
    [profileMap, query.isLoading, enabled],
  );
}
