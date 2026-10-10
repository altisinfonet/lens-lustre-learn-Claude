/**
 * VID-1 §4.4 · WHICH FEED POSTS ARE VIDEO POSTS, AND MAY THEY SHOW.
 *
 * ONE PostgREST read per feed page, riding the feed's existing Promise.all
 * (same rule as `fetchPostMediaMap`: no N+1, no extra round trip). It reads
 * `post_videos` with the linked video and its versions embedded, all through
 * RLS: `videos_read` returns a row only when the viewer may see it, and only
 * granted columns (never the manifest hash, the idempotency key or
 * `audio_sha256` — VID-1 §4 "what the client may read").
 *
 * The rule (VID-1 §4.4): "Feed, profile and ad reads show a video post only
 * while its video is `ready`. `taken_down` hides it at once." So a post that
 * HAS a `post_videos` link but whose video is not visible-and-ready is marked
 * `hidden` and the feed drops it — it must never fall through as a text post.
 *
 * Failure path: if the read errors, the map is empty and every post renders as
 * it did before video existed. That can show a video post's caption without
 * its video; it cannot show a video. Logged, so it is not a silent state.
 */
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

const FILE = "src/lib/video/postVideoRead.ts";

/** What a feed card needs to draw and start a video. Nothing else. */
export interface FeedVideo {
  id: string;
  width: number | null;
  height: number | null;
  durationS: number;
  hasAudio: boolean;
}

export type PostVideoEntry = FeedVideo | "hidden";
export type PostVideoMap = Map<string, PostVideoEntry>;

/** Same ceiling as the media read path, for the same reason. */
export const POST_VIDEO_ID_BATCH = 50;

interface VersionRow { version_no: number; width: number | null; height: number | null; declared_duration_s: number | string; has_audio: boolean }
interface VideoRow { id: string; state: string; current_version: number; video_versions: VersionRow[] | null }
export interface PostVideoRow { post_id: string; video_id: string; videos: VideoRow | null }

export const POST_VIDEO_SELECT =
  "post_id, video_id, videos(id, state, current_version, video_versions(version_no, width, height, declared_duration_s, has_audio))";

/** Pure: rows → map. Exported for tests. */
export function toPostVideoMap(rows: readonly PostVideoRow[]): PostVideoMap {
  const map: PostVideoMap = new Map();
  for (const r of rows) {
    if (!r?.post_id) continue;
    const v = r.videos;
    if (!v || v.state !== "ready") { map.set(r.post_id, "hidden"); continue; }
    const ver = (v.video_versions ?? []).find((x) => x.version_no === v.current_version);
    const duration = ver ? Number(ver.declared_duration_s) : NaN;
    if (!ver || !Number.isFinite(duration) || duration <= 0) { map.set(r.post_id, "hidden"); continue; }
    map.set(r.post_id, { id: v.id, width: ver.width ?? null, height: ver.height ?? null, durationS: duration, hasAudio: ver.has_audio === true });
  }
  return map;
}

type LooseFrom = (t: string) => {
  select(s: string): { in(c: string, v: readonly string[]): PromiseLike<{ data: PostVideoRow[] | null; error: { message: string } | null }> };
};

export async function fetchPostVideoMap(postIds: readonly string[]): Promise<PostVideoMap> {
  const ids = [...new Set(postIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += POST_VIDEO_ID_BATCH) batches.push(ids.slice(i, i + POST_VIDEO_ID_BATCH));
  const from = (supabase.from as unknown as LooseFrom).bind(supabase);
  const rows = await Promise.all(batches.map(async (b) => {
    const { data, error } = await from("post_videos").select(POST_VIDEO_SELECT).in("post_id", b);
    if (error) {
      logger.warn({
        code: "VID-3001", event: "POST_VIDEO_READ_FAILED", fn: "fetchPostVideoMap", file: FILE,
        message: "The video read for this feed page failed.", reason: error.message,
        expected: "post_videos with the embedded ready video", actual: "PostgREST errored",
        nextStep: "Video posts on this page render without their video until the next fetch. Check post_videos/videos grants.",
        detail: { batchSize: b.length },
      });
      return [] as PostVideoRow[];
    }
    return data ?? [];
  }));
  return toPostVideoMap(rows.flat());
}
