/**
 * Is `photo_set_v2` on for ME? — photo plan U2's display switch.
 *
 * The same question, cache entry and refresh rules as useFeatureAllowed
 * (featureAllowedKey, 60 s, unknown/error/signed-out = OFF), with one
 * difference: it is SAFE OUTSIDE a QueryClientProvider. U2 asks from leaf
 * components (the feed photo, a notification thumbnail) that many existing
 * tests and harness scenes render bare; there the answer is simply OFF and
 * nothing is asked — so the switch-off render stays today's render.
 */
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { FEATURE_REFRESH_MS, featureAllowedKey, fetchFeatureAllowed } from "@/hooks/core/useFeatureAllowed";

/** Never fetches: every query on it is disabled. Only stands in when no provider exists. */
const INERT = new QueryClient({ defaultOptions: { queries: { enabled: false } } });

export function usePhotoSetV2(): boolean {
  const client = useContext(QueryClientContext);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const live = !!client && !!userId;
  const q = useQuery(
    {
      queryKey: featureAllowedKey("photo_set_v2", userId),
      enabled: live,
      staleTime: FEATURE_REFRESH_MS,
      // P10: the SAME poll as useFeatureAllowed (same query key, so react-query
      // runs one of them, not two): R-103 "switch changes apply within 60 s, no
      // app release"; paused in the background.
      refetchInterval: live ? FEATURE_REFRESH_MS : false,
      refetchOnWindowFocus: true,
      retry: false,
      queryFn: () => fetchFeatureAllowed("photo_set_v2"),
    },
    client ?? INERT,
  );
  return live && q.data === true;
}
