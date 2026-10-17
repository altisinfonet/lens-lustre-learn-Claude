/**
 * VID-1 · a play grant: the signed master playlist and poster for one video,
 * from /api/video/play-token, asked AS THE VIEWER (their JWT, or none when
 * signed out — the Function then reads with the lane's anon key, through the
 * same RLS). One request shape for every screen that shows a video: the feed
 * card (src/components/video/FeedVideoCard.tsx) and the poster-only tile
 * (src/components/video/VideoPoster.tsx).
 *
 * SHARED, NOT ASKED AGAIN (review #415). Every play-token call is a Pages
 * Function plus three Supabase calls, against the free plan's request budget.
 * A wall of video tiles, the feed card that then opens, the comments box over
 * it — each asked for its own grant, and a card asked twice on mount (poster
 * and start at once). Grants are now kept per (viewer, video): a request
 * already in flight is shared, and a grant is reused while it is still fresh
 * (`grantDue`, the same rule the card renews by). `fresh: true` skips the
 * cache — a segment refused with 403 means the grant we hold is no good.
 */
import { supabase } from "@/integrations/supabase/client";
import { PLAY_TOKEN_TTL_S } from "@/lib/video/shared/playToken";
import { SITE_API, siteFetch } from "@/lib/net/siteApi";

/** receivedAt: performance.now() when it arrived — the device's own clock, never Date.now() (review #411 C6). */
export interface PlayGrant { master_url: string; poster_url: string; expires_at: number; receivedAt: number }

/**
 * A grant is "due" 90 s before its 15 minutes run out, measured on the
 * MONOTONIC clock from when it arrived. Date.now() would follow the phone's
 * wall clock: one set 13½ minutes fast made every token look due, and the
 * card fetched tokens back to back (review #411 C6).
 */
const GRANT_FRESH_MS = (PLAY_TOKEN_TTL_S - 90) * 1000;
export const grantDue = (g: PlayGrant | null | undefined): boolean => !g || performance.now() - g.receivedAt > GRANT_FRESH_MS;

/**
 * Both URLs end up inside markup and a CSS `url("…")` (the blurred poster).
 * The server already builds them from a fixed host with an encoded token; this
 * refuses anything that is not a plain absolute http(s) URL anyway, now that
 * more than one screen uses the answer (review #415).
 */
const SAFE_URL = /^https?:\/\/[^\s"'\\()<>]+$/;

/** A long session sees many videos; keep the most recent ones only. */
const CACHE_MAX = 200;
const cache = new Map<string, { grant?: PlayGrant; pending?: Promise<PlayGrant | null> }>();

async function fetchGrant(videoId: string, token: string | undefined): Promise<PlayGrant | null> {
  try {
    const res = await siteFetch(SITE_API.videoPlayToken, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ video_id: videoId }),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Partial<PlayGrant>;
    return typeof b.master_url === "string" && SAFE_URL.test(b.master_url)
      && typeof b.poster_url === "string" && SAFE_URL.test(b.poster_url)
      && typeof b.expires_at === "number"
      ? { master_url: b.master_url, poster_url: b.poster_url, expires_at: b.expires_at, receivedAt: performance.now() }
      : null;
  } catch {
    return null;
  }
}

/** null when the viewer may not play it (yet), or the network failed — the caller shows a calm fallback. Never cached. */
export async function requestGrant(videoId: string, opts: { fresh?: boolean } = {}): Promise<PlayGrant | null> {
  let token: string | undefined;
  let viewer = "anon";
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
    viewer = data.session?.user?.id ?? "anon";
  } catch {
    // no session to read: ask as a signed-out viewer
  }
  const key = `${viewer}:${videoId}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit) {
    if (hit.grant && !grantDue(hit.grant)) return hit.grant;
    if (hit.pending) return hit.pending;
  }
  const pending = fetchGrant(videoId, token).then((g) => {
    if (cache.get(key)?.pending === pending) {
      if (g) cache.set(key, { grant: g }); else cache.delete(key);
    }
    return g;
  });
  cache.delete(key); // re-insert last: Map order is the eviction order
  cache.set(key, { grant: hit?.grant, pending });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return pending;
}

/** Tests only: forget every grant. */
export function resetGrantCache(): void {
  cache.clear();
}
