/**
 * THE ONE CLIENT READ PATH TO POST MEDIA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *     client → post_media_for(uuid[]) → post_media → media_objects → object path
 *
 * Nothing else in this application may read `post_media` or `media_objects`.
 * It could not anyway: `anon` and `authenticated` hold ZERO privilege on both
 * tables (20260814084711), and the Item C decision was that they never will —
 * `post_media_for` is SECURITY DEFINER and its `can_view_post` predicate is
 * the entire access control. A table grant added to make some component
 * "easier" would delete that control, not extend it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS IS A RESOLUTION STEP AND NOT A NEW MEDIA API ──────────────────
 *
 * Every media surface in this app — the feed card, the wall, the profile grid,
 * the photo detail page, the hashtag feed — already consumes ONE shape: an
 * array of image URLs, ordered, aligned with `thumbnail_urls` by index. Twelve
 * components read it.
 *
 * So the switch does not rewrite twelve components. It changes where that
 * array COMES FROM, in the four places that build it. The renderer never learns
 * that the media engine exists, which is the point: there is one media contract
 * in this codebase and it did not change.
 *
 * ── THE FALLBACK IS NOT OPTIONAL, AND HERE IS THE MEASUREMENT ──────────────
 *
 * Production, 2026-08-20:
 *
 *     posts                                        254
 *     posts with post_media rows                   197
 *     posts with NO post_media rows                 57   ← 84 photographs
 *
 * The Phase 2 migration population was deliberately narrow — only
 * `cdn.50mmretina.com/post-images/<owner>/posts/<file>`. The other 83 slides
 * live in six older path shapes (`post-images/<uuid>/<file>`, `avatars/…`,
 * Supabase-storage URLs) and are outside the fenced set entirely. A hard switch
 * would blank 84 photographs across 57 posts.
 *
 * So: media graph WHEN PRESENT, `posts.image_urls` otherwise. Per post, never
 * per slide — a post is migrated whole or not at all (MIG-2004), verified in
 * production: 0 posts where `count(post_media) <> cardinality(image_urls)`.
 *
 * ── WHY THIS IS SAFE TO SWITCH AT ALL ──────────────────────────────────────
 *
 * Measured on production before writing a line of this file: for all 228
 * `post_media` rows,
 *
 *     'https://cdn.50mmretina.com/' || derivatives->>'original'   ==   the
 *     `image_urls` entry at the same index
 *
 *     matches 228 · mismatches 0 · ord gaps 0 · missing legacy slide 0
 *
 * The read switch is therefore pixel-identical today. It is not a visual
 * change; it is a change of AUTHORITY, so that the day `image_urls` stops being
 * written the pictures keep arriving.
 *
 * ⚠ WHAT THIS DOES NOT FIX. `post_media_for` controls which ADDRESSES a viewer
 * learns. It does not control who may fetch the bytes: `post-images` is a
 * public bucket, its storage policy is `(bucket_id = 'post-images')` with no
 * privacy condition, and the CDN never consults the database at all. That is
 * D-002, it is unchanged by this file, and `PrivacyGapNotice` must stay until
 * it is closed.
 */
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
/** The CDN host for this lane. Re-exported here because callers have always
 *  imported it from this module; the value itself is lane-derived since
 *  2026-08-22 and no longer a literal. */
import { CDN_HOST as MEDIA_CDN_HOST } from "@/lib/env";
export { MEDIA_CDN_HOST };

const FILE = "src/lib/media/postMediaRead.ts";

/**
 * The RPC refuses more than 50 ids with MEDIA-1001, and that refusal is a
 * control (it stops the read path becoming a bulk exporter), not a limit to
 * route around. Batches are built to fit it. Locked to the migration by test.
 */
export const POST_MEDIA_ID_BATCH = 50;

/**
 * The host post media is served from. Same constant, same reasoning as
 * `src/lib/cdnImage.ts`: ask the image's own host, never the apex and never
 * `location.origin` — the apex is the one origin that does NOT work, and that
 * cost four days of missing photographs in August.
 */


/** One row of `post_media_for`. Deliberately NOT the whole table. */
interface PostMediaForRow {
  post_id: string;
  ord: number;
  object_path: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  bytes: number | null;
}

/** post id → its photographs, in `ord` order. */
export type PostMediaMap = Map<string, string[]>;

/**
 * `post-images/<owner>/posts/<file>` → `https://cdn.50mmretina.com/…`.
 *
 * Returns null rather than a broken address for anything unusable. A media row
 * whose derivative is missing must not put an empty `src` on a card — the
 * caller drops it and the post falls back, which is a smaller failure than a
 * feed that throws.
 */
export function mediaUrlFor(objectPath: string | null | undefined): string | null {
  if (!objectPath) return null;
  const path = String(objectPath).trim();
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  // Already absolute (a future derivative could be written as a full URL).
  if (/^https?:\/\//i.test(path)) return path;
  return `https://${MEDIA_CDN_HOST}/${path}`;
}

/** Split into RPC-sized batches. Deduped first, so 60 ids of 3 posts is 1 call. */
export function batchPostIds(postIds: readonly string[]): string[][] {
  const unique = [...new Set(postIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += POST_MEDIA_ID_BATCH) {
    batches.push(unique.slice(i, i + POST_MEDIA_ID_BATCH));
  }
  return batches;
}

/**
 * Every photograph the viewer may see, for these posts, in one round trip per
 * 50 posts.
 *
 * ⚠ NEVER CALL THIS PER POST. That is the N+1 this batching exists to prevent,
 * and on a feed page it would be ten RPCs where one will do. Locked by test.
 *
 * A failure returns an EMPTY MAP rather than throwing: every caller falls back
 * to `posts.image_urls`, so the worst outcome of an RPC outage is that the app
 * renders exactly as it did before Item E. It is logged, so "quietly on the
 * legacy path forever" is not a silent state.
 */
export async function fetchPostMediaMap(postIds: readonly string[]): Promise<PostMediaMap> {
  const map: PostMediaMap = new Map();
  const batches = batchPostIds(postIds);
  if (batches.length === 0) return map;

  const rowsPerBatch = await Promise.all(
    batches.map(async (ids) => {
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: PostMediaForRow[] | null; error: { message: string } | null }>)(
        "post_media_for",
        { _post_ids: ids },
      );
      if (error) {
        logger.warn({
          code: "MEDIA-3001",
          event: "POST_MEDIA_READ_FAILED",
          fn: "fetchPostMediaMap",
          file: FILE,
          message: "The media read path could not be used for this batch.",
          reason: error.message,
          expected: "post_media_for returns the viewer's media for these posts",
          actual: "the RPC errored",
          nextStep:
            "NOT user-visible: every caller falls back to posts.image_urls, so the app renders as it did before the Item E switch. Check the RPC's grants and the 50-id cap.",
          detail: { batchSize: ids.length },
        });
        return [] as PostMediaForRow[];
      }
      return data ?? [];
    }),
  );

  const byPost = new Map<string, PostMediaForRow[]>();
  for (const row of rowsPerBatch.flat()) {
    if (!row?.post_id) continue;
    const list = byPost.get(row.post_id) ?? [];
    list.push(row);
    byPost.set(row.post_id, list);
  }

  for (const [postId, rows] of byPost) {
    // ORD IS THE ORDER OF THE CAROUSEL. The RPC already orders by (post_id,
    // ord); sorting again costs nothing and means a future change to the
    // RPC's ORDER BY cannot silently shuffle somebody's album.
    const urls = rows
      .slice()
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))
      .map((r) => mediaUrlFor(r.object_path))
      .filter((u): u is string => u !== null);
    if (urls.length > 0) map.set(postId, urls);
  }

  return map;
}

/**
 * The photographs to render for one post.
 *
 * The media graph wins WHEN IT HAS THIS POST. It is per post and never per
 * slide: a post is migrated whole or not at all, so mixing the two
 * representations inside one carousel is not a state that exists, and building
 * it here would invent one.
 */
export function resolvePostImageUrls(
  map: PostMediaMap | null | undefined,
  postId: string,
  legacyUrls: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  const fromMedia = map?.get(postId);
  if (fromMedia && fromMedia.length > 0) return [...fromMedia];
  return (legacyUrls ?? []).filter((u): u is string => typeof u === "string" && u.length > 0);
}
