/**
 * STORIES v2 — the ONE data layer for stories (Owner, 6 Nov 2026: "go stories").
 *
 * Every surface (feed row, profile, highlights, notifications, the post
 * screens' "Also add to my story" box) reads and writes stories through this
 * file, and every story is shown by the one viewer (StoryViewer.tsx). A new
 * story feature plugs in here and there — never in a page.
 *
 * Database: supabase/migrations/20261111_0100_stories_v2.sql
 *   get_feed_stories_bar · get_user_stories · story_add_post ·
 *   story_comments_list · story_likes / story_comments (insert-only RLS).
 *
 * A story made from a POST shows the post's photos (one slide each, max 10)
 * or its video; its comments ARE the post's comments (they stay with the
 * post). A plain story (photo added from the row) has its own comments, gone
 * with the story unless it is in a highlight.
 */
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompression";
import { uploadImage } from "@/lib/imageUpload";
import { storageSafeFileName } from "@/lib/storageSafeName";
import { fetchPostVideoMap, type FeedVideo } from "@/lib/video/postVideoRead";
import { STORY_DISPLAY_MS } from "@/lib/storyTiming";
import { submit } from "@/lib/offline/outbox";

/** All story numbers in one place. */
export const STORY_RULES = {
  /** a story lives this long (the database sets expires_at) */
  hours: 24,
  /** a photo slide stays this long (Owner 2026-08-05: 10 s) */
  photoMs: STORY_DISPLAY_MS,
  /** a video slide plays at most this long, then "Watch full video" */
  videoMaxMs: 60_000,
  /** a post with more photos shows only the first ten */
  maxSlides: 10,
  /** the post screens' box starts ticked (Owner 6 Nov: untick = no story) */
  addToStoryByDefault: true,
  /** newest comments shown on a story */
  commentsShown: 50,
  /** longest comment */
  commentMax: 1000,
} as const;

/** One person's tile in the feed row. */
export interface StoryBarUser {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_official: boolean;
  latest_story_at: string;
  story_count: number;
  has_unseen: boolean;
  cover_url: string | null;
}

/** One story as get_user_stories returns it. */
export interface StoryRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  post_id: string | null;
  caption: string | null;
  media: string[];
  thumbs: string[];
  is_video: boolean;
  like_count: number;
  comment_count: number;
  i_liked: boolean;
  /** only for the owner's own stories */
  view_count: number | null;
}

/** What the viewer plays: one photo or one video. */
export interface StorySlide {
  key: string;
  story: StoryRow;
  kind: "photo" | "video";
  src: string | null;
  video: FeedVideo | null;
  durationMs: number;
}

/** A person in the viewer's queue. */
export interface StoryPerson {
  userId: string;
  name: string;
  avatar: string | null;
  cover: string | null;
  isOwn: boolean;
}

export interface StoryComment {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  content: string;
  created_at: string;
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(fn, args);

export async function fetchStoryBar(): Promise<StoryBarUser[]> {
  const { data, error } = await rpc("get_feed_stories_bar");
  if (error) throw new Error(error.message);
  return (data as StoryBarUser[] | null) ?? [];
}

export async function fetchUserStories(userId: string): Promise<StoryRow[]> {
  const { data, error } = await rpc("get_user_stories", { _user_id: userId });
  if (error) throw new Error(error.message);
  return ((data as StoryRow[] | null) ?? []).map((r) => ({
    ...r,
    media: (r.media ?? []).filter(Boolean),
    thumbs: r.thumbs ?? [],
  }));
}

/** Stories → slides: one per photo (max 10), one for a video. */
export async function slidesOf(stories: StoryRow[]): Promise<StorySlide[]> {
  const videoPosts = stories.filter((s) => s.is_video && s.post_id).map((s) => s.post_id as string);
  const videos = videoPosts.length ? await fetchPostVideoMap(videoPosts) : new Map();
  const out: StorySlide[] = [];
  for (const s of stories) {
    if (s.is_video && s.post_id) {
      const v = videos.get(s.post_id);
      if (!v || v === "hidden") continue;
      out.push({ key: `${s.id}:v`, story: s, kind: "video", src: null, video: v,
        durationMs: Math.min(Math.max(1, v.durationS) * 1000, STORY_RULES.videoMaxMs) });
      continue;
    }
    s.media.slice(0, STORY_RULES.maxSlides).forEach((src, i) =>
      out.push({ key: `${s.id}:${i}`, story: s, kind: "photo", src, video: null, durationMs: STORY_RULES.photoMs }));
  }
  return out;
}

/** The ticked box: put the caller's own new post on their story. Idempotent. */
export async function addPostToStory(postId: string): Promise<string | null> {
  const { data, error } = await rpc("story_add_post", { _post_id: postId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** A plain story from the row's "+" (photo only). */
export async function addPhotoStory(userId: string, file: File): Promise<void> {
  let upload = file;
  try {
    const r = await compressImage(file, { maxDimension: 1080, webpQuality: 0.85 });
    upload = new File([r.webp], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
  } catch {
    /* the original goes up instead */
  }
  const path = `${userId}/stories/${Date.now()}-${storageSafeFileName(upload.name, "story")}`;
  const result = await uploadImage({ bucket: "avatars", file: upload, path, type: "gallery" });
  const { error } = await supabase.from("stories" as never).insert({ user_id: userId, image_url: result.url } as never);
  if (error) throw new Error(error.message);
}

export async function markStorySeen(storyId: string, viewerId: string): Promise<void> {
  await supabase
    .from("story_views" as never)
    .upsert({ story_id: storyId, viewer_id: viewerId } as never, { onConflict: "story_id,viewer_id", ignoreDuplicates: true });
}

export async function setStoryLike(storyId: string, userId: string, on: boolean): Promise<void> {
  const q = on
    ? supabase.from("story_likes" as never).insert({ story_id: storyId, user_id: userId } as never)
    : supabase.from("story_likes" as never).delete().eq("story_id", storyId).eq("user_id", userId);
  const { error } = await q;
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
}

export async function fetchStoryComments(storyId: string): Promise<StoryComment[]> {
  const { data, error } = await rpc("story_comments_list", { _story_id: storyId, _limit: STORY_RULES.commentsShown });
  if (error) throw new Error(error.message);
  return (data as StoryComment[] | null) ?? [];
}

/**
 * A comment typed on a story. A post story's comment is a POST comment (the
 * post keeps it; the post owner gets the usual comment notification); a plain
 * story's goes to story_comments (the owner gets "commented on your story").
 */
export async function addStoryComment(story: Pick<StoryRow, "id" | "post_id">, userId: string, text: string): Promise<void> {
  const content = text.trim().slice(0, STORY_RULES.commentMax);
  if (!content) return;
  if (story.post_id) {
    // the same path every post comment takes (offline-safe, sent once)
    await submit(userId, { kind: "comment", postId: story.post_id, content, parentId: null });
    return;
  }
  const { error } = await supabase
    .from("story_comments" as never)
    .insert({ story_id: story.id, user_id: userId, content, idempotency_key: crypto.randomUUID() } as never);
  if (error) throw new Error(error.message);
}

/** Delete one's own story; resolves only when the database confirms a row went. */
export async function deleteOwnStory(storyId: string): Promise<void> {
  const { data, error } = await supabase.from("stories" as never).delete().eq("id", storyId).select("id");
  if (error) throw new Error(error.message);
  if (!data || (data as unknown[]).length === 0) throw new Error("Story could not be deleted.");
}

/** Keep a story in a highlight (its comments stay with it). */
export async function addStoryToHighlight(highlightId: string, slide: StorySlide): Promise<void> {
  const { error } = await supabase.from("highlight_items" as never).insert({
    highlight_id: highlightId, image_url: slide.src ?? slide.story.media[0], caption: slide.story.caption, story_id: slide.story.id,
  } as never);
  if (error) throw new Error(error.message);
}
