/**
 * STORIES v2 — the viewer half of the one story data layer (storyData.ts).
 * Only StoryViewer / StoryHighlightPicker use these, so they load with the
 * viewer, not on the first page (P13 entry-bundle ceiling).
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchPostVideoMap } from "@/lib/video/postVideoRead";
import { submit } from "@/lib/offline/outbox";
import { safeRandomUUID } from "@/lib/safeUuid";
import { STORY_RULES, rpc, type StoryComment, type StoryRow, type StorySlide } from "./storyData";

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
 * Owner 7 Nov ("if it got 700 comments how to see?"): one page of comments
 * OLDER than `before` (the oldest one already on screen), oldest → newest.
 * Fewer than a full page back = there is nothing older.
 */
export async function fetchOlderStoryComments(storyId: string, before: string): Promise<StoryComment[]> {
  const { data, error } = await rpc("story_comments_page", { _story_id: storyId, _limit: STORY_RULES.commentsShown, _before: before });
  if (error) throw new Error(error.message);
  return (data as StoryComment[] | null) ?? [];
}

/** One person who saw the owner's story. */
export interface StoryViewerRow {
  viewer_id: string;
  full_name: string | null;
  avatar_url: string | null;
  custom_url: string | null;
  viewed_at: string;
  liked: boolean;
}

/** Owner 7 Nov: who saw my story — the owner only (the database refuses anyone else). Newest first. */
export async function fetchStoryViewers(storyId: string, before?: string): Promise<StoryViewerRow[]> {
  const { data, error } = await rpc("story_viewers", { _story_id: storyId, _limit: STORY_RULES.viewersPage, _before: before ?? null });
  if (error) throw new Error(error.message);
  return (data as StoryViewerRow[] | null) ?? [];
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
    .insert({ story_id: story.id, user_id: userId, content, idempotency_key: safeRandomUUID() } as never);
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
