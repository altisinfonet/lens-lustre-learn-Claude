/**
 * N7 · comment preview + Reply on comment rows (centre rows only).
 *
 * Which comment a row is about is already written in each notification's
 * dedup_key (src/lib/notificationComment.ts: post_comment:<comment id>:…), and
 * members read their own notification rows and the comments of posts they can
 * see — so two batched reads, no SQL change: the rows' dedup keys, then those
 * comments. The newest notification in a group decides which comment shows.
 * Any error → no previews (the row just has no quote and no Reply).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { commentIdFromDedupKey, isCommentNotificationType } from "@/lib/notificationComment";
import type { NotificationGroup } from "@/lib/notificationText";

export type CommentPreview = { commentId: string; content: string };
const EMPTY = new Map<string, CommentPreview>();

export function useCommentPreviews(groups: NotificationGroup[], enabled: boolean): Map<string, CommentPreview> {
  const { user } = useAuth();
  const wanted = groups
    .filter((g) => isCommentNotificationType(g.type) && !!g.reference_id && (g.notification_ids?.length ?? 0) > 0)
    .slice(0, 50);
  const ids = Array.from(new Set(wanted.flatMap((g) => g.notification_ids ?? []))).sort().slice(0, 200);

  const query = useQuery({
    queryKey: ["notif-comment-previews", user?.id ?? "", ids.join(",")],
    enabled: enabled && !!user?.id && ids.length > 0,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("user_notifications")
        .select("id, dedup_key, created_at")
        .in("id", ids);
      if (error) throw error;
      const byId = new Map(
        ((rows ?? []) as Array<{ id: string; dedup_key: string | null; created_at: string }>).map((r) => [r.id, r]),
      );
      // newest notification of each group that names a comment
      const pick = new Map<string, string>();
      for (const g of wanted) {
        const newest = (g.notification_ids ?? [])
          .map((id) => byId.get(id))
          .filter((r): r is { id: string; dedup_key: string | null; created_at: string } => !!r && !!commentIdFromDedupKey(r.dedup_key))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (newest) pick.set(g.group_key, commentIdFromDedupKey(newest.dedup_key)!);
      }
      const commentIds = Array.from(new Set(pick.values()));
      if (commentIds.length === 0) return EMPTY;
      const { data: comments, error: e2 } = await supabase
        .from("post_comments")
        .select("id, content, post_id")
        .in("id", commentIds);
      if (e2) throw e2;
      const byComment = new Map(
        ((comments ?? []) as Array<{ id: string; content: string; post_id: string }>).map((c) => [c.id, c]),
      );
      const postOf = new Map(wanted.map((g) => [g.group_key, g.reference_id]));
      const out = new Map<string, CommentPreview>();
      for (const [key, cid] of pick) {
        const c = byComment.get(cid);
        // the quote must be from the post Reply opens
        if (c && c.post_id === postOf.get(key) && c.content?.trim()) out.set(key, { commentId: cid, content: c.content.trim() });
      }
      return out;
    },
  });
  return query.data ?? EMPTY;
}
