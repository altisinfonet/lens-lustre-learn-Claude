/**
 * The comment thread under a post — the DATA half of it.
 *
 * The drawing half is src/components/comments/CommentThread.tsx, which this
 * shares with the sponsored story card. It used to be written out here, and a
 * hand-copy of it lived in src/components/ads/AdComments.tsx; the copy drifted
 * and eventually printed the literal string `renderRow(comment, false)` in
 * place of every ad comment. There is one thread now. What stays here is what
 * is genuinely about a POST: post_comments, post_comment_reactions, pinning,
 * the report queue, and useAddComment's optimistic insert with the AI
 * moderation call behind it.
 */
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { toast } from "@/hooks/core/use-toast";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { useAddComment } from "@/hooks/feed/useAddComment";
import CommentThread, { type ThreadComment } from "@/components/comments/CommentThread";

interface Props {
  postId: string;
  postOwnerId: string;
  expanded: boolean;
  onCommentCountChange?: (delta: number) => void;
}

const PostCommentsSection = ({ postId, postOwnerId, expanded, onCommentCountChange }: Props) => {
  const { user } = useAuth();
  const { data: currentProfile } = useProfileCore(user?.id);
  const { isAdmin } = useIsAdmin();
  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [rawComments, setRawComments] = useState<any[]>([]);
  const [rawReactions, setRawReactions] = useState<{ likeCountMap: Map<string, number>; userLikedSet: Set<string> }>({ likeCountMap: new Map(), userLikedSet: new Set() });
  const [commentUserIds, setCommentUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const { profileMap } = useProfileMap(commentUserIds);

  const loadComments = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("post_comments")
      .select("id, user_id, content, created_at, updated_at, parent_id, is_pinned")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (!data) { setLoading(false); setLoaded(true); return; }

    const authorIds = [...new Set(data.map((c: any) => c.user_id))];
    const commentIds = data.map((c: any) => c.id);

    const [, reactionsRes, userReactionsRes] = await Promise.all([
      getAdminIds(),
      commentIds.length ? supabase.from("post_comment_reactions" as any).select("comment_id").in("comment_id", commentIds) : { data: [] },
      commentIds.length && user ? supabase.from("post_comment_reactions" as any).select("comment_id").eq("user_id", user.id).in("comment_id", commentIds) : { data: [] },
    ]);

    const likeCountMap = new Map<string, number>();
    (reactionsRes.data as any[] || []).forEach((r: any) => {
      likeCountMap.set(r.comment_id, (likeCountMap.get(r.comment_id) || 0) + 1);
    });
    const userLikedSet = new Set((userReactionsRes.data as any[] || []).map((r: any) => r.comment_id));

    setRawComments(data);
    setRawReactions({ likeCountMap, userLikedSet });
    setCommentUserIds(authorIds);
    setLoading(false);
    setLoaded(true);
  }, [postId, user]);

  // Build comment tree reactively when rawComments or profileMap changes
  useEffect(() => {
    if (rawComments.length === 0) return;

    const buildTree = async () => {
      const adminIds = await getAdminIds();

      // Badges/roles now come from unified profileMap cache — no manual seeding needed

      const allComments: ThreadComment[] = rawComments.map((c: any) => ({
        ...c,
        is_pinned: c.is_pinned || false,
        author_name: resolveName(c.user_id, profileMap[c.user_id]?.full_name ?? null, adminIds),
        author_avatar: profileMap[c.user_id]?.avatar_url ?? null,
        author_badges: resolveBadges(c.user_id, profileMap[c.user_id]?.badges || [], adminIds),
        author_last_active: profileMap[c.user_id]?.last_active_at ?? null,
        like_count: rawReactions.likeCountMap.get(c.id) || 0,
        is_liked: rawReactions.userLikedSet.has(c.id),
        replies: [],
      }));

      // Build tree
      const map = new Map<string, ThreadComment>();
      allComments.forEach((c) => map.set(c.id, c));
      const roots: ThreadComment[] = [];
      allComments.forEach((c) => {
        if (c.parent_id && map.has(c.parent_id)) {
          map.get(c.parent_id)!.replies.push(c);
        } else {
          roots.push(c);
        }
      });

      setComments(roots);
    };

    buildTree();
  }, [rawComments, profileMap, rawReactions, commentUserIds]);

  useEffect(() => {
    if (expanded && !loaded) loadComments();
  }, [expanded, loaded, loadComments]);

  const addCommentMutation = useAddComment(
    setComments as any,
    onCommentCountChange,
    loadComments,
  );

  const findComment = (list: ThreadComment[], id: string): ThreadComment | undefined => {
    for (const c of list) {
      if (c.id === id) return c;
      const found = findComment(c.replies, id);
      if (found) return found;
    }
    return undefined;
  };

  const deleteComment = async (commentId: string, parentId: string | null) => {
    // Count replies being deleted
    const countReplies = (id: string): number => {
      const c = comments.find((x) => x.id === id);
      return c ? c.replies.length : 0;
    };
    const delta = parentId ? 1 : 1 + countReplies(commentId);

    if (parentId) {
      setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== commentId) } : c));
    } else {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
    onCommentCountChange?.(-delta);

    const { error } = await supabase.from("post_comments").delete().eq("id", commentId);
    if (error) {
      toast({ title: "Failed to delete", variant: "destructive" });
      loadComments();
    }
  };

  const editComment = async (commentId: string, content: string): Promise<boolean> => {
    setEditSubmitting(true);
    const { error } = await supabase
      .from("post_comments")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", commentId);
    setEditSubmitting(false);
    if (error) {
      toast({ title: "Failed to edit", variant: "destructive" });
      return false;
    }
    // Update locally
    const updateInTree = (list: ThreadComment[]): ThreadComment[] =>
      list.map((c) => c.id === commentId
        ? { ...c, content, updated_at: new Date().toISOString() }
        : { ...c, replies: updateInTree(c.replies) }
      );
    setComments(updateInTree);
    return true;
  };

  const toggleLike = async (commentId: string) => {
    if (!user) return;
    const updateLike = (list: ThreadComment[]): ThreadComment[] =>
      list.map((c) => c.id === commentId
        ? { ...c, is_liked: !c.is_liked, like_count: c.is_liked ? c.like_count - 1 : c.like_count + 1 }
        : { ...c, replies: updateLike(c.replies) }
      );
    setComments(updateLike);

    const isCurrentlyLiked = findComment(comments, commentId)?.is_liked;
    if (isCurrentlyLiked) {
      await supabase.from("post_comment_reactions" as any).delete().eq("comment_id", commentId).eq("user_id", user.id);
    } else {
      await supabase.from("post_comment_reactions" as any).insert({ comment_id: commentId, user_id: user.id, reaction_type: "like" } as any);
    }
  };

  const togglePin = async (commentId: string) => {
    const comment = findComment(comments, commentId);
    if (!comment) return;
    const newPinned = !comment.is_pinned;
    const updatePin = (list: ThreadComment[]): ThreadComment[] =>
      list.map((c) => c.id === commentId ? { ...c, is_pinned: newPinned } : c);
    setComments(updatePin);
    await supabase.from("post_comments").update({ is_pinned: newPinned }).eq("id", commentId);
  };

  const reportComment = async (commentId: string, reason: string) => {
    if (!user || !reason) return;
    const { error } = await supabase.from("comment_reports").insert({
      post_comment_id: commentId,
      reporter_id: user.id,
      reason: reason.toLowerCase().replace(/\s/g, "_"),
    } as any);
    if (error?.code === "23505") {
      toast({ title: "You already reported this comment" });
    } else if (error) {
      toast({ title: "Failed to report", variant: "destructive" });
    } else {
      toast({ title: "Comment reported" });
    }
  };

  if (!expanded) return null;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden border-t border-border"
    >
      <CommentThread
        comments={comments}
        loading={loading && !loaded}
        currentUserId={user?.id ?? null}
        viewer={currentProfile}
        isAdmin={isAdmin}
        canPin={isAdmin || user?.id === postOwnerId}
        submitting={addCommentMutation.isPending}
        editSubmitting={editSubmitting}
        maxLength={2200}
        composerPlaceholder="Write a comment..."
        onAdd={(content, parentId) => {
          addCommentMutation.mutate({ postId, content, parentId });
        }}
        onEdit={editComment}
        onDelete={deleteComment}
        onToggleLike={toggleLike}
        onTogglePin={togglePin}
        onReport={reportComment}
      />
    </motion.div>
  );
};

export default PostCommentsSection;
