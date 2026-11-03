/**
 * PHOTO PLAN U3 + UNIT B · the one download policy every photo surface asks
 * (rules in src/lib/photoProtection.ts).
 *
 * POLICY, NOT A SWITCH (Owner-confirmed requirement 4, 3 Nov 2026; audit H2):
 * the download icon is hidden for everyone — members, signed-out visitors, and
 * while any answer is still loading — except admins and judges on competition
 * entries, on the web. U3 tied it to `photo_set_v2`, so "switch unknown /
 * signed out / off" still showed today's download.
 *
 * Admin / judge comes from the SAME source and rule as useCanBypassWatermark
 * (user_roles via useUserRoles' cache entry: `admin` or `judge`). Roles are
 * only asked for a competition entry, and while they load the answer is "no
 * download" (the safe default).
 *
 * Safe outside a QueryClientProvider: there roles are never asked, so no download.
 */
import { useCallback, useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import { fetchUserRoles, userRolesKey } from "@/hooks/profile/useUserRoles";
import { isNativeApp } from "@/lib/video/playback";
import { photoDownloadAllowed } from "@/lib/photoProtection";

/** Never fetches: every query on it is disabled. Only stands in when no provider exists. */
const INERT = new QueryClient({ defaultOptions: { queries: { enabled: false } } });

function useAdminOrJudge(needed: boolean): boolean {
  const client = useContext(QueryClientContext);
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const live = needed && !!client && !!userId && !loading;
  const q = useQuery(
    {
      queryKey: userRolesKey(userId),
      enabled: live,
      staleTime: 5 * 60_000,
      queryFn: () => fetchUserRoles(client as QueryClient, userId),
    },
    client ?? INERT,
  );
  const roles = live ? q.data ?? [] : [];
  return roles.includes("admin") || roles.includes("judge");
}

/** May this viewer download this photo? `competitionEntry` = the photo is a competition entry. */
export function useCanDownloadPhoto(competitionEntry = false): boolean {
  const inApp = isNativeApp();
  const adminOrJudge = useAdminOrJudge(competitionEntry && !inApp);
  return photoDownloadAllowed({ inApp, competitionEntry, adminOrJudge });
}

/**
 * useDownloadImage behind the policy: `canDownload` decides whether a surface
 * renders its button at all, and `download` refuses when it is false (a stale
 * click on a button that is about to disappear does nothing).
 */
export function usePhotoDownload(competitionEntry = false) {
  const canDownload = useCanDownloadPhoto(competitionEntry);
  const { downloading, download: raw } = useDownloadImage();
  const download = useCallback(
    async (shownUrl: string, fileName?: string) => {
      if (!canDownload) return;
      await raw(shownUrl, fileName);
    },
    [canDownload, raw],
  );
  return { canDownload, downloading, download };
}
