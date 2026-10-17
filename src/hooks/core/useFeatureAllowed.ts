/**
 * VID-7 · is a feature switched on for ME? (`feature_allowed_me`, D1 #378)
 *
 * The answer only decides whether a button is SHOWN. The server decides whether
 * the action is ALLOWED (video_begin_upload checks the same switch), so a
 * crafted request changes nothing (VID-7).
 *
 * "Changes apply within 60 s with no app release" (R-103): re-asked every 60 s
 * while the app is open, and whenever the app comes back to the foreground.
 * Signed out, offline or on any error: false — the button stays hidden.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

export type FeatureName = "video_posts" | "video_ads" | "copyright_music_check";

export const FEATURE_REFRESH_MS = 60_000;

export function featureAllowedKey(feature: FeatureName, userId: string | null) {
  return ["feature_allowed_me", feature, userId] as const;
}

export function useFeatureAllowed(feature: FeatureName): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const q = useQuery({
    queryKey: featureAllowedKey(feature, userId),
    enabled: !!userId,
    staleTime: FEATURE_REFRESH_MS,
    // P10: R-103 "changes apply within 60 s, no app release" — one tiny RPC a
    // minute per signed-in member while the app is open; react-query pauses it
    // in the background.
    refetchInterval: FEATURE_REFRESH_MS,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      // Call position (supabase-js keeps `rpc` on its prototype).
      const { data, error } = await (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
        "feature_allowed_me", { _feature: feature },
      );
      if (error) return false;
      return data === true;
    },
  });
  return q.data === true;
}
