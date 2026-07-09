/**
 * Shared dashboard bootstrap query.
 * Uses a single React Query request so Layout + sidebars share one in-flight call.
 *
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH for sidebar data.
 * Sidebars MUST consume data from this hook — never fetch independently.
 *
 * Cache pre-seeding happens INSIDE queryFn (not useEffect) so caches
 * are populated BEFORE individual hooks re-render — preventing duplicate fetches.
 *
 * HARD LOCK: This hook is called ONLY inside DashboardProvider.
 * The stable queryKey uses "dashboard-init" + userId, and refetchOnMount is false
 * so token refreshes (which re-render the provider) do NOT re-trigger the fetch.
 */
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDashboardInit, preSeedCaches } from "@/lib/dashboardInit";
import { beginDashboardBootstrap, resetDashboardBootstrapGate } from "@/lib/dashboardInitGate";

const DASHBOARD_INIT_KEY_PREFIX = "dashboard-init" as const;

export interface SidebarData {
  sections: Record<string, boolean> | null;
  competitions: any[];
  courses: any[];
  journal: any[];
  winners: any[];
  trending: any[];
  voting_entries: any[];
  voting_thumbnails: any[];
  milestones: any[];
  birthdays: any[];
  suggestions: any[];
}

export function useDashboardInit(userId: string | undefined, enabled = true) {
  const qc = useQueryClient();
  const safeId = userId ?? "no-user";

  const query = useQuery({
    queryKey: [DASHBOARD_INIT_KEY_PREFIX, safeId] as const,
    queryFn: async () => {
      // U-04: open the bootstrap gate so leaf hooks (useSiteSetting,
      // useIsAdmin, useUserRoles, useSiteLogo, useNavigationMenu) suspend
      // their independent fetches until preSeedCaches runs. Resolved in
      // `finally` so failures still unblock leaves (graceful degradation).
      const gate = beginDashboardBootstrap();
      try {
        const data = await fetchDashboardInit(userId);
        preSeedCaches(data, qc, userId);
        return data;
      } finally {
        gate.resolve();
      }
    },
    // Public pages also need dashboard-init so pre-seeded site settings + schemas exist
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Expose sidebar data directly so components can consume without cache lookups
  const sidebarData = useMemo<SidebarData | null>(() => {
    const d = query.data;
    if (!d) return null;

    const settings = d.settings as Record<string, unknown> | undefined;
    const sidebar = d.sidebar as Record<string, unknown> | undefined;

    return {
      sections: (settings?.sidebar_sections ?? null) as Record<string, boolean> | null,
      competitions: (sidebar?.competitions ?? []) as any[],
      courses: (sidebar?.courses ?? []) as any[],
      journal: (sidebar?.journal ?? []) as any[],
      winners: (sidebar?.winners ?? []) as any[],
      trending: (sidebar?.trending ?? []) as any[],
      voting_entries: (sidebar?.voting_entries ?? []) as any[],
      voting_thumbnails: (sidebar?.voting_thumbnails ?? []) as any[],
      milestones: (sidebar?.milestones ?? []) as any[],
      birthdays: (sidebar?.birthdays ?? []) as any[],
      suggestions: (sidebar?.suggestions ?? []) as any[],
    };
  }, [query.data]);

  return { ...query, sidebarData, isReady: query.isSuccess };
}

export function resetDashboardBootstrap() {
  // U-04: clear the bootstrap gate so the next session re-opens it cleanly.
  resetDashboardBootstrapGate();
}
