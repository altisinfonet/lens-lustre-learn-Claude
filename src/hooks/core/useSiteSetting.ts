 /**
  * Reactive site-setting subscription.
  *
  * dashboard-init pre-seeds ["site-setting", <key>] caches.
  * This hook creates a useQuery subscription on that SAME key so the
  * component re-renders whenever the cache is updated — either by
  * dashboard-init resolving or by admin calling setQueryData.
  *
  * The queryFn is a fallback: it fires only when no cached data exists
  * (e.g. dashboard-init hasn't resolved yet or cache was GC'd).
  */
 import { useQuery, useQueryClient } from "@tanstack/react-query";
 import { getSiteSetting } from "@/lib/siteSettingsCache";
 import { awaitDashboardBootstrap } from "@/lib/dashboardInitGate";

 export function useSiteSetting<T = unknown>(key: string) {
   const qc = useQueryClient();
   return useQuery<T | null>({
     queryKey: ["site-setting", key],
     queryFn: async () => {
       // U-04: dashboard-init bundles most site_settings keys; wait for the
       // shared bootstrap to seed the cache before falling through to a
       // dedicated per-key DB request. Eliminates 7+ concurrent
       // `site_settings?key=...` round-trips per public page load.
       await awaitDashboardBootstrap();
       const seeded = qc.getQueryData<T | null>(["site-setting", key]);
       if (seeded !== undefined) return seeded;
       // Batched + shared: several components asking for different keys in the
       // same frame now cost ONE request, not one each.
       return await getSiteSetting<T>(key);
     },
     staleTime: 10 * 60_000,
     gcTime: 15 * 60_000,
   });
 }
