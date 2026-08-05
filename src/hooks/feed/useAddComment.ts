import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { reportClientError, describeThrown, memberFacingMessage } from "@/lib/reportClientError";
import { useIsBanned } from "@/hooks/core/useIsBanned";
import { queryKeys } from "@/lib/queryKeys";
import { convertEmojiShortcuts } from "@/lib/emoji";

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
      /**
       * The trailing emoji shortcut, converted at submit.
       *
       * Owner, 2026-08-05: emoji must work *"including after the comment
       * text"* — `I love this <3` with nothing typed after it. The
       * typing-time conversion in MentionInput fires when a space is typed,
       * and there is no space in that case, so this is the half that catches
       * it. Running it again on already-converted text is a no-op — an emoji
       * is not a shortcut. See src/lib/emoji.ts.
       */
      const finalContent = convertEmojiShortcuts(content);
      const { data, error } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: user.id,
          content: finalContent,
          parent_id: parentId,
        })
        .select("id")
        .single();
      if (error) {
        // NOTHING HERE MAY MENTION A PROFILE PHOTO — see the same note in
        // src/components/WallPosts.tsx. The photo policies were dropped on
        // 2026-08-05 and a member with only a system cartoon was rehearsed
        // commenting successfully on production. Guessing "no photo" from a
        // bare 42501 would now mislabel a ban, or a comment on a post the
        // member cannot see, as the wall the owner has removed.
        throw error;
      }
      return data;
    },

    onMutate: async ({ content, parentId }) => {
      if (!user) return;

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimistic: OptimisticComment = {
        id: tempId,
        user_id: user.id,
        // The SAME conversion the insert does. Without this the member sees
        // their comment appear as `<3`, then silently flip to a heart when the
        // real row loads — the app correcting them a second after the fact.
        content: convertEmojiShortcuts(content),
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

    onError: (err, vars, context) => {
      // Rollback to snapshot
      if (context?.snapshot) {
        setComments(context.snapshot);
        onCommentCountChange?.(-1);
      }
      /**
       * Owner report, 2026-08-05: "people not able to reply freely."
       *
       * This handler used to name its error `_err` and never look at it, then
       * raise a toast with a TITLE AND NOTHING ELSE. So a member whose reply
       * failed was told "Failed to comment" and given no reason, no next step,
       * and no way to tell a restriction apart from a dropped connection — and
       * nothing was recorded anywhere, which is why there was no evidence to
       * investigate with.
       *
       * Both halves are fixed here: say what happened, and count it.
       */
      // What the MEMBER reads — the plain reason, with no "Error ·" prefix.
      // The LOG still gets the full diagnostic form.
      //
      // This used to say the mutation throws a special sentence for the
      // missing-profile-photo case. It no longer does, and must not again:
      // the photo policies were dropped on 2026-08-05 and nothing blocks a
      // member without a DP.
      const msg = memberFacingMessage(err);
      reportClientError("reply", err, {
        isReply: !!(vars as any)?.parentId,
      });
      const isNetwork = /failed to fetch|network|cors|load failed|functionsfetcherror/i.test(msg);
      toast({
        title: isNetwork ? "Couldn't send — check your connection" : "Failed to comment",
        description: msg,
        variant: "destructive",
      });
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
