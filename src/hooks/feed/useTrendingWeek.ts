/**
 * TRENDING THIS WEEK — the one reader and the admin's mark (Owner 13 Nov 2026:
 * "only one video … Mark As Trending this week … no video marked then at least
 * 4 images, no three or two"). The database decides everything
 * (20261113_0600 get_trending_week): the card shows ONE marked video, else
 * EXACTLY 4 photos, else nothing. The sidebar card and the post menu read the
 * same query, so a mark shows on the card at once.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";

export interface TrendingPhoto { id: string; image_url: string; thumb_url: string | null; title: string; reaction_count: number; source: "post" }
export interface TrendingWeek { video: { post_id: string; video_id: string; ends_at: string } | null; photos: TrendingPhoto[] }

export const TRENDING_KEY = ["trending-week"] as const;

/** Parsed defensively: anything but 4 photos is treated as none (never 2 or 3). */
export function parseTrendingWeek(raw: unknown): TrendingWeek {
  const r = (raw ?? {}) as { video?: unknown; photos?: unknown };
  const v = r.video as TrendingWeek["video"] | undefined;
  const photos = Array.isArray(r.photos) ? (r.photos as TrendingPhoto[]).filter((p) => p && typeof p.id === "string" && p.image_url) : [];
  return {
    video: v && typeof v.post_id === "string" && typeof v.video_id === "string" ? v : null,
    photos: photos.length >= 4 ? photos.slice(0, 4) : [],
  };
}

export function useTrendingWeek(enabled = true) {
  return useQuery({
    queryKey: TRENDING_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TrendingWeek> => {
      const { data, error } = await supabase.rpc("get_trending_week" as never);
      if (error) throw new Error(error.message);
      return parseTrendingWeek(data);
    },
  });
}

const REFUSED: Record<string, string> = {
  not_admin: "Only an admin can do this.",
  post_not_public: "Only a public post can be trending.",
  no_ready_video: "This post has no ready video.",
  bad_request: "That post could not be found.",
};

/** Admin: mark this post's video as Trending this week (replaces any other), or take the mark away. */
export function useTrendingMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { postId: string; on: boolean }) => {
      const { data, error } = a.on
        ? await supabase.rpc("trending_video_set" as never, { _post_id: a.postId } as never)
        : await supabase.rpc("trending_video_clear" as never);
      if (error) throw new Error(error.message);
      if (data !== "ok") throw new Error(REFUSED[String(data)] ?? "Could not change Trending.");
      return a.on;
    },
    onSuccess: (on) => {
      void qc.invalidateQueries({ queryKey: TRENDING_KEY });
      toast({ title: on ? "Marked as Trending this week" : "Removed from Trending" });
    },
    onError: (e) => toast({ title: "Not changed", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
  });
}
