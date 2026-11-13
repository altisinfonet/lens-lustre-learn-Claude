import { useEffect, useState } from "react";

/**
 * A video's still frame (poster) for a story tile (Owner 13 Nov 2026: a video
 * story's tile showed the profile picture, "like Meta does" = a frame of the
 * video). The poster is private: it comes with the same play pass the player
 * asks for (requestGrant, cached and shared with the player, so opening the
 * story asks for nothing twice). Give the video id, or a post id to look it up.
 * Loaded only when a tile has a video and no photo (P13 entry-bundle ceiling).
 * No poster (no pass, no network) = null, and the tile keeps its fallback.
 */
export function useVideoPoster(src: { videoId?: string | null; postId?: string | null } | null): string | null {
  const [poster, setPoster] = useState<string | null>(null);
  const videoId = src?.videoId ?? null;
  const postId = src?.postId ?? null;
  useEffect(() => {
    setPoster(null);
    if (!videoId && !postId) return;
    let live = true;
    void (async () => {
      try {
        let id = videoId;
        if (!id && postId) {
          const { fetchPostVideoMap } = await import("@/lib/video/postVideoRead");
          const v = (await fetchPostVideoMap([postId])).get(postId);
          id = v && v !== "hidden" ? v.id : null;
        }
        if (!id) return;
        const { requestGrant } = await import("@/lib/video/playGrant");
        const g = await requestGrant(id);
        if (live && g?.poster_url) setPoster(g.poster_url);
      } catch {
        /* the fallback stays: a missing poster is not an error */
      }
    })();
    return () => { live = false; };
  }, [videoId, postId]);
  return poster;
}
