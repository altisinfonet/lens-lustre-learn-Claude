/**
 * STORIES v2 — the story numbers and the post screens' "Also add to my story"
 * share. Part of the one story data layer (storyData.ts re-exports both); kept
 * in its own small file because the post screens are in the first download
 * (P13 entry-bundle ceiling) — the rest of storyData loads only when needed.
 */
import { STORY_DISPLAY_MS } from "@/lib/storyTiming";

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
  /** people per page in the owner's "Seen by" list */
  viewersPage: 200,
  /** longest comment */
  commentMax: 1000,
} as const;

/**
 * Called by every publish path once the post exists (photo job, direct photo
 * post, draft, video). Never throws and never holds the post. The work (and
 * the STORY-6005 log if it fails) lives in storyData.ts, loaded only now.
 */
export function shareNewPostToStory(postId: string | null | undefined, wanted: boolean | undefined): void {
  if (!postId || !wanted) return;
  void import("./storyData").then(({ addPostToStoryOrLog }) => addPostToStoryOrLog(postId)).catch(() => {});
}
