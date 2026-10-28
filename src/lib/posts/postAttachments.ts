/**
 * A post's ATTACHMENTS — its photographs and its video — read ONCE, in one
 * place, for every surface that shows posts.
 *
 * Why this exists (Owner, staging 2026-10-11): a video post appeared on the
 * wall as an EMPTY post. The feed, the wall, the single-post page and the
 * hashtag page each read attachments with their own copy of the code, and only
 * the feed had been taught about video. Fixing the other three by hand (#402)
 * was a patch; this is the structure: every surface asks this module, so a new
 * kind of attachment is added here once and reaches every surface together.
 * videoOnEverySurface.test.ts fails if a surface reads media or video any
 * other way.
 *
 * Both reads are the existing sanctioned, batched ones — fetchPostMediaMap
 * (post_media_for, ITEM E) and fetchPostVideoMap (post_videos through RLS,
 * VID-1) — run side by side: one round trip per page, never one per post.
 */
import { fetchPostMediaMap, resolvePostImageUrls, type PostMediaMap } from "@/lib/media/postMediaRead";
import { fetchPostVideoMap, type FeedVideo, type PostVideoMap } from "@/lib/video/postVideoRead";
import { fetchResolvedMediaMap, ladderSwitchOn, resolvedImageUrls, type ResolvedMap } from "@/lib/media/resolvedMedia";

export interface PostAttachments {
  media: PostMediaMap;
  video: PostVideoMap;
  /** S3-c: present only while `media_ladder_feed` is on for this member. */
  resolved?: ResolvedMap;
}

export interface AttachedMedia {
  image_urls: string[];
  video: FeedVideo | null;
}

/** Photographs and videos for a whole page of posts: two batched reads, in parallel. */
export async function fetchPostAttachments(postIds: readonly string[]): Promise<PostAttachments> {
  // S3-c: started first, runs alongside today's two reads; any failure → undefined (today's path).
  const resolvedP = ladderSwitchOn()
    .then((on) => (on ? fetchResolvedMediaMap(postIds) : undefined))
    .catch(() => undefined);
  const [media, video] = await Promise.all([fetchPostMediaMap(postIds), fetchPostVideoMap(postIds)]);
  const resolved = await resolvedP;
  return resolved ? { media, video, resolved } : { media, video };
}

/**
 * One post's attachments, or `null` when THIS viewer must not see the post at
 * all: it is a video post whose video is not playable for them (not ready, or
 * not visible) — shown as an empty post, it would be the bug this file exists
 * to prevent.
 *
 * `legacyImageUrls` are the URLs stored on the post row itself, which
 * resolvePostImageUrls falls back to when the post has no post_media rows.
 */
export function attachmentsFor(a: PostAttachments, postId: string, legacyImageUrls: string[]): AttachedMedia | null {
  const v = a.video.get(postId);
  if (v === "hidden") return null;
  const today = resolvePostImageUrls(a.media, postId, legacyImageUrls);
  // S3-c: the ladder replaces the URLs only for a post the server resolved whole.
  const ladder = a.resolved ? resolvedImageUrls(a.resolved, postId, today) : null;
  return { image_urls: ladder ?? today, video: v ?? null };
}
