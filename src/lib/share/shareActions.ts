/**
 * THE ONE SHARE LOGIC for posts and stories (Owner 13 Nov 2026: the story's
 * paper plane "will like Share function"). The post card's paper-plane menu and
 * the story viewer's paper plane both call these, so "Share to your wall" and
 * "Copy link" cannot work one way on a post and another way on a story.
 *
 *   sharePostToWall  — records the share (post_shares), never copies the post
 *   shareAddress     — the address to send: a post story sends its POST (it
 *                      outlives the 24 h story); a plain story its own address
 *   copyAddress      — clipboard; shareAddress → shareLink for the phone's sheet
 */
import { supabase } from "@/integrations/supabase/client";
import { postPath } from "@/lib/posts/postPath";
import { publicUrl } from "@/lib/publicUrl";

/** Share a post to the member's wall. true = recorded (a repeat share is a no-op, also true). */
export async function sharePostToWall(postId: string, userId: string): Promise<boolean> {
  // Only record the share reference — do NOT duplicate the post.
  // BUG-062: no UPDATE policy on post_shares, so a repeat share must be a no-op.
  const { error } = await supabase.from("post_shares" as never).upsert(
    { post_id: postId, user_id: userId } as never,
    { onConflict: "post_id,user_id", ignoreDuplicates: true },
  );
  return !error;
}

/** The full public address of what is being shared. */
export function shareAddress(t: { postId?: string | null; handle?: string | null; storyId?: string | null }): string {
  if (t.postId) return publicUrl(postPath(t.postId, t.handle ?? null));
  if (t.storyId) return publicUrl(`/stories/${encodeURIComponent(t.storyId)}`);
  return publicUrl("/feed");
}

export async function copyAddress(url: string): Promise<void> {
  await navigator.clipboard.writeText(url);
}
