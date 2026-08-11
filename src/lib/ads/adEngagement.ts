/**
 * adEngagement — like, comment and share on a sponsored ad.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Owner, 2026-08-11: "For All sponsored Ad, Like Comment share is required like
 * a normal post." Before this, an ad in the feed was a picture with a click-out
 * and nothing else — no way to react to it, no thread under it, no link to send
 * anyone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN AD IS KEYED BY
 *
 * Everything here hangs off `ad_creatives.id` — a row in the picture library
 * the admin fills in /admin/advertisements. The older single-image-per-zone
 * path has no id at all, so it carries no engagement; AdZone only renders the
 * action row when it picked a library creative. The reasoning is written out in
 * supabase/migrations/20260811120000_ad_creative_engagement.sql.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ROUND TRIP, NOT SIXTY-FOUR
 *
 * A single scroll of the feed can render 16 story-card ads. Fetching three
 * counts and the viewer's own state per ad would be 64 requests before anyone
 * has touched anything. `get_ad_engagement(uuid[])` returns all of it for every
 * id at once, and `fetchAdEngagement` batches whatever ids a screen asks for.
 */
import { supabase } from "@/integrations/supabase/client";

export interface AdEngagement {
  creativeId: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  /** The calling member's own reaction, or null. */
  myReaction: string | null;
  myShared: boolean;
  /** { like: 4, love: 2 } — drives the break-up panel, same shape posts use. */
  reactionCounts: Record<string, number>;
}

export const emptyEngagement = (creativeId: string): AdEngagement => ({
  creativeId,
  likeCount: 0,
  commentCount: 0,
  shareCount: 0,
  myReaction: null,
  myShared: false,
  reactionCounts: {},
});

/**
 * Counts and viewer state for a batch of creatives.
 *
 * Returns a Map so a caller can look an id up without scanning. Ids the RPC
 * does not know about are simply absent — the caller falls back to
 * emptyEngagement, which is also what an anonymous visitor gets.
 */
export const fetchAdEngagement = async (
  creativeIds: string[],
): Promise<Map<string, AdEngagement>> => {
  const ids = [...new Set(creativeIds.filter(Boolean))];
  const out = new Map<string, AdEngagement>();
  if (ids.length === 0) return out;

  const { data, error } = await supabase.rpc("get_ad_engagement" as any, {
    _creative_ids: ids,
  } as any);

  // A signed-out visitor cannot execute the RPC. That is not an error worth
  // shouting about — the ad still renders, with zeros and no viewer state.
  if (error || !Array.isArray(data)) return out;

  for (const row of data as any[]) {
    out.set(row.creative_id, {
      creativeId: row.creative_id,
      likeCount: Number(row.like_count) || 0,
      commentCount: Number(row.comment_count) || 0,
      shareCount: Number(row.share_count) || 0,
      myReaction: row.my_reaction ?? null,
      myShared: !!row.my_shared,
      reactionCounts: (row.reaction_counts as Record<string, number>) || {},
    });
  }
  return out;
};

/**
 * React, or change an existing reaction.
 *
 * The unique constraint (creative_id, user_id) is what makes one-per-member
 * true, so this upserts against it rather than reading first and racing.
 */
export const reactToAd = async (
  creativeId: string,
  userId: string,
  reactionType: string,
): Promise<{ error: string | null }> => {
  const { error } = await supabase
    .from("ad_creative_reactions" as any)
    .upsert(
      { creative_id: creativeId, user_id: userId, reaction_type: reactionType } as any,
      { onConflict: "creative_id,user_id" },
    );
  return { error: error ? error.message : null };
};

export const unreactToAd = async (
  creativeId: string,
  userId: string,
): Promise<{ error: string | null }> => {
  const { error } = await supabase
    .from("ad_creative_reactions" as any)
    .delete()
    .eq("creative_id", creativeId)
    .eq("user_id", userId);
  return { error: error ? error.message : null };
};

/**
 * Record a share.
 *
 * `ignoreDuplicates` rather than a plain upsert: post_shares has no UPDATE
 * policy and the same is true here, so a default upsert would attempt an UPDATE
 * on the second share and be refused by RLS (BUG-062, the identical bug on
 * posts — see src/pages/Feed.tsx). Sharing twice is a no-op, not an error.
 */
export const shareAd = async (
  creativeId: string,
  userId: string,
): Promise<{ error: string | null }> => {
  const { error } = await supabase
    .from("ad_creative_shares" as any)
    .upsert(
      { creative_id: creativeId, user_id: userId } as any,
      { onConflict: "creative_id,user_id", ignoreDuplicates: true },
    );
  return { error: error ? error.message : null };
};

export interface AdComment {
  id: string;
  creative_id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchAdComments = async (creativeId: string): Promise<AdComment[]> => {
  const { data } = await supabase
    .from("ad_creative_comments" as any)
    .select("id, creative_id, user_id, content, parent_id, created_at, updated_at")
    .eq("creative_id", creativeId)
    .order("created_at", { ascending: true })
    .limit(200);
  return (data as any[] as AdComment[]) || [];
};

/**
 * The message a member sees when the keyword blocklist refuses their comment.
 *
 * The database raises 'Comment blocked by content filter' with a check_violation
 * errcode, from the SAME enforce_comment_blocklist() trigger that guards post
 * comments. Translating it here keeps the wording identical on both surfaces.
 */
export const BLOCKED_COMMENT_MESSAGE =
  "That comment contains a word that is not allowed here.";

export const addAdComment = async (
  creativeId: string,
  userId: string,
  content: string,
  parentId: string | null,
): Promise<{ error: string | null }> => {
  const body = content.trim();
  if (!body) return { error: "Write something first." };

  const { error } = await supabase.from("ad_creative_comments" as any).insert({
    creative_id: creativeId,
    user_id: userId,
    content: body,
    parent_id: parentId,
  } as any);

  if (!error) return { error: null };
  if ((error.message || "").includes("content filter")) {
    return { error: BLOCKED_COMMENT_MESSAGE };
  }
  return { error: error.message };
};

export const editAdComment = async (
  commentId: string,
  content: string,
): Promise<{ error: string | null }> => {
  const body = content.trim();
  if (!body) return { error: "A comment cannot be empty." };
  const { error } = await supabase
    .from("ad_creative_comments" as any)
    .update({ content: body } as any)
    .eq("id", commentId);
  if (!error) return { error: null };
  if ((error.message || "").includes("content filter")) {
    return { error: BLOCKED_COMMENT_MESSAGE };
  }
  return { error: error.message };
};

export const deleteAdComment = async (commentId: string): Promise<{ error: string | null }> => {
  const { error } = await supabase
    .from("ad_creative_comments" as any)
    .delete()
    .eq("id", commentId);
  return { error: error ? error.message : null };
};

/** The permalink for an ad. One definition, used by the card, the page and share. */
export const adPath = (creativeId: string): string => `/ad/${creativeId}`;
