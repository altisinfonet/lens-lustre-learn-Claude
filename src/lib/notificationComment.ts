/**
 * S4-b · WHICH COMMENT A COMMENT NOTIFICATION IS ABOUT.
 *
 * A comment notification's `reference_id` is the POST (notificationLinks.ts),
 * so the link opens the post. The comment itself is named in the row's
 * `dedup_key`, which the database writes for every comment notification
 * (notify_post_comment, the tagged fan-out):
 *
 *   post_comment:<comment id>:owner
 *   post_comment:<comment id>:reply          (type comment_reply)
 *   tagged_post_comment:<comment id>:<member id>
 *
 * The member reads their OWN notification rows already (RLS "Users can view
 * own notifications"), so the post page can ask "my latest notification of
 * this type about this post — which comment?" with no new read path, no SQL
 * and no change to what a push carries. One rule for the bell, the
 * Notifications page and a push tap.
 */
import { supabase } from "@/integrations/supabase/client";

export const COMMENT_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "post_comment",
  "comment_reply",
  "tagged_post_comment",
]);

export const isCommentNotificationType = (type: string | null | undefined): boolean =>
  !!type && COMMENT_NOTIFICATION_TYPES.has(type);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCommentId = (v: string | null | undefined): v is string => !!v && UUID.test(v);

/** The comment id inside a comment notification's dedup_key, or null. */
export function commentIdFromDedupKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const [kind, id] = key.split(":");
  if (kind !== "post_comment" && kind !== "tagged_post_comment") return null;
  return isCommentId(id) ? id : null;
}

/**
 * The comment the member's latest notification of `type` about `postId`
 * points at. null when there is none (deleted, read on another device and
 * cleared, a row from before dedup keys) — the post still opens, with its
 * comments, just without a highlighted row.
 */
export async function resolveNotifiedCommentId(postId: string, type: string): Promise<string | null> {
  if (!isCommentNotificationType(type)) return null;
  const { data: auth } = await supabase.auth.getSession();
  const me = auth.session?.user?.id;
  if (!me) return null;
  const { data } = await supabase
    .from("user_notifications")
    .select("dedup_key")
    .eq("user_id", me)
    .eq("reference_id", postId)
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(1);
  return commentIdFromDedupKey((data as { dedup_key: string | null }[] | null)?.[0]?.dedup_key);
}
