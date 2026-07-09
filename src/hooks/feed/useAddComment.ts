import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { useIsBanned } from "@/hooks/core/useIsBanned";
import { queryKeys } from "@/lib/queryKeys";

/* ── Minimal comment shape expected by PostCommentsSection ── */

export interface OptimisticComment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
  is_pinned: boolean;
  author_name: string | null;
  author_avatar: string | null;
  author_badges: string[];
  like_count: number;
  is_liked: boolean;
  replies: OptimisticComment[];
}

interface AddCommentInput {
  postId: string;
  content: string;
  parentId: string | null;
}

/**
 * Optimistic add-comment mutation.
 *
 * @param setComments – local state setter for the comment list
 * @param onCommentCountChange – callback to bump parent post's comment_count
 * @param reloadComments – fetches real data after success to replace temp ID
 */
export function useAddComment(
  setComments: React.Dispatch<React.SetStateAction<OptimisticComment[]>>,
  onCommentCountChange: ((delta: number) => void) | undefined,
  reloadComments: () => void,
) {
  const { user } = useAuth();
  const { isBanned } = useIsBanned();
  const qc = useQueryClient();

  // Read cached profile — never falls back to user_metadata
  const cached = user
    ? qc.getQueryData<{ full_name: string | null; avatar_url: string | null } | null>(queryKeys.profileCore(user.id))
    : null;

  return useMutation({
    mutationFn: async ({ postId, content, parentId }: AddCommentInput) => {
      if (!user) throw new Error("Not authenticated");
      if (isBanned) throw new Error("Your account is restricted from this action");
      const { data, error } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: user.id,
          content,
          parent_id: parentId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },

    onMutate: async ({ content, parentId }) => {
      if (!user) return;

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimistic: OptimisticComment = {
        id: tempId,
        user_id: user.id,
        content,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        parent_id: parentId,
        is_pinned: false,
        author_name: cached?.full_name || "You",
        author_avatar: cached?.avatar_url || null,
        author_badges: [],
        like_count: 0,
        is_liked: false,
        replies: [],
      };

      // Snapshot for rollback
      let snapshot: OptimisticComment[] = [];
      setComments((prev) => {
        snapshot = prev;
        if (parentId) {
          return prev.map((c) =>
            c.id === parentId ? { ...c, replies: [...c.replies, optimistic] } : c,
          );
        }
        return [...prev, optimistic];
      });

      onCommentCountChange?.(1);

      return { tempId, parentId, snapshot };
    },

    onError: (_err, _vars, context) => {
      // Rollback to snapshot
      if (context?.snapshot) {
        setComments(context.snapshot);
        onCommentCountChange?.(-1);
      }
      toast({ title: "Failed to comment", variant: "destructive" });
    },

    onSuccess: (data, variables) => {
      // Replace temp comment with real data
      reloadComments();

      // Trigger AI moderation in background (non-blocking)
      if (data?.id) {
        supabase.functions.invoke("moderate-comment", {
          body: { comment_id: data.id, type: "post_comment" },
        }).then((res) => {
          console.log("AI MODERATION RESPONSE:", res);
        }).catch((err) => {
          console.error("AI MODERATION ERROR:", err);
        });
      }
    },
  });
}
