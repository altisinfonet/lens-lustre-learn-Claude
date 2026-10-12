/**
 * WHAT A POST OR AN AD SHOWS — ONE ANSWER, FOR EVERY SCREEN.
 *
 * Owner, staging 2026-10-12, on a video ad: "Video running but comment box
 * still image … for every error did different different screen". The feed
 * card played the video while the comments box beside the same ad showed its
 * still picture, because each screen worked out for itself what to show.
 *
 * This module is the only place that decides it: a post or ad shows its VIDEO
 * when it has one, otherwise its photographs — never both (R-105: the 9:16
 * card replaces the photo frame). Every screen that draws a post's or an ad's
 * media takes it from here — the feed card, the wall, the post page, the
 * hashtag page, the ad card, the ad page, the comments box and the wall grid —
 * and src/lib/posts/__tests__/sameMediaEverywhere.test.ts fails when one does
 * not. The comments box gets the very value its card drew, never a second
 * lookup.
 */
import type { FeedVideo } from "@/lib/video/postVideoRead";

export interface SubjectMedia {
  /** Playable video (src/components/video/FeedVideoCard). When set, `imageUrls` is empty. */
  video: FeedVideo | null;
  /** Photographs in order; empty for a video or a text-only subject. */
  imageUrls: string[];
}

const urls = (list: ReadonlyArray<string | null | undefined>): string[] =>
  list.filter((u): u is string => typeof u === "string" && u.length > 0);

/** A post: its video, else its photographs (`image_urls`, or the single legacy `image_url`). */
export function postMedia(post: {
  video?: FeedVideo | null;
  image_urls?: ReadonlyArray<string> | null;
  image_url?: string | null;
}): SubjectMedia {
  if (post.video) return { video: post.video, imageUrls: [] };
  const list = post.image_urls?.length ? post.image_urls : [post.image_url];
  return { video: null, imageUrls: urls(list) };
}

/** An ad creative: its video, else its picture. */
export function adMedia(creative: { video?: FeedVideo | null; image_url?: string | null }): SubjectMedia {
  if (creative.video) return { video: creative.video, imageUrls: [] };
  return { video: null, imageUrls: urls([creative.image_url]) };
}

/** A subject with nothing to show (a text post; an ad bar given no media). */
export const NO_MEDIA: SubjectMedia = Object.freeze({ video: null, imageUrls: Object.freeze([]) as unknown as string[] }) as SubjectMedia;

export const hasMedia = (m: SubjectMedia): boolean => m.video !== null || m.imageUrls.length > 0;
