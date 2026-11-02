/**
 * PHOTO PLAN U3 · the one download policy every photo surface asks
 * (switch `photo_set_v2`; rules in src/lib/photoProtection.ts).
 *
 * Switch OFF (unknown / error / signed out) → `canDownload` is true and every
 * surface keeps today's download button and today's handler, unchanged.
 *
 * Admin / judge comes from the SAME source and rule as useCanBypassWatermark
 * (user_roles via useUserRoles' cache entry: `admin` or `judge`). Roles are
 * only asked when they can matter — switch on AND a competition entry — and
 * while they load the answer is "no download" (the safe default).
 *
 * Safe outside a QueryClientProvider (like usePhotoSetV2): leaf components
 * that many tests render bare then simply see the switch OFF.
 */
import { useCallback, useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
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
  const v2 = usePhotoSetV2();
  const adminOrJudge = useAdminOrJudge(v2 && competitionEntry);
  return photoDownloadAllowed({ v2, inApp: isNativeApp(), competitionEntry, adminOrJudge });
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
