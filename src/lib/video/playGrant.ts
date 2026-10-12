/**
 * VID-1 · a play grant: the signed master playlist and poster for one video,
 * from /api/video/play-token, asked AS THE VIEWER (their JWT, or none when
 * signed out — the Function then reads with the lane's anon key, through the
 * same RLS). One request shape for every screen that shows a video: the feed
 * card (src/components/video/FeedVideoCard.tsx) and the poster-only tile
 * (src/components/video/VideoPoster.tsx).
 */
import { supabase } from "@/integrations/supabase/client";

/** receivedAt: performance.now() when it arrived — the device's own clock, never Date.now() (review #411 C6). */
export interface PlayGrant { master_url: string; poster_url: string; expires_at: number; receivedAt: number }

/** null when the viewer may not play it (yet), or the network failed — the caller shows a calm fallback. */
export async function requestGrant(videoId: string): Promise<PlayGrant | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch("/api/video/play-token", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ video_id: videoId }),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<PlayGrant>;
    return typeof b.master_url === "string" && typeof b.poster_url === "string" && typeof b.expires_at === "number"
      ? { master_url: b.master_url, poster_url: b.poster_url, expires_at: b.expires_at, receivedAt: performance.now() }
      : null;
  } catch {
    return null;
  }
}
