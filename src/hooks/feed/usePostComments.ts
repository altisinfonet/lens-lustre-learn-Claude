/**
 * The comment thread's DATA half, as a hook — extracted from
 * src/components/PostCommentsSection.tsx so it can be driven from more than
 * one place (today: the inline thread that component still renders for any
 * caller that has not moved to the Comments overlay, and the new
 * CommentsOverlay/CommentsBottomSheet). Nothing about the data path changed
 * in the extraction: same tables, same useAddComment mutation (optimistic
 * insert, AI moderation call, error rollback), same tree-building.
 *
 * Lazy by design: pass `enabled: false` (or omit `enabled`, default true)
 * until the caller actually needs comments loaded — the overlay passes
 * `enabled: commentsOpen` so nothing is fetched before the panel opens, per
 * the product requirement that Comments-as-a-modal must not load every
 * comment just because the container changed shape.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { toast } from "@/hooks/core/use-toast";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { useAddComment } from "@/hooks/feed/useAddComment";
import type { ThreadComment } from "@/components/comments/CommentThread";

export interface UsePostCommentsResult {
  comments: ThreadComment[];
  loading: boolean;
  loaded: boolean;
  currentUserId: string | null;
  viewer: { full_name?: string | null; avatar_url?: string | null } | null | undefined;
  isAdmin: boolean;
  canPin: boolean;
  submitting: boolean;
  editSubmitting: boolean;
  addComment: (content: string, parentId: string | null) => void;
  editComment: (commentId: string, content: string) => Promise<boolean>;
  deleteComment: (commentId: string, parentId: string | null) => Promise<void>;
  toggleLike: (commentId: string) => Promise<void>;
  togglePin: (commentId: string) => Promise<void>;
  reportComment: (commentId: string, reason: string) => Promise<void>;
  reload: () => void;
}

export function usePostComments(
  postId: string | null | undefined,
  postOwnerId: string | null | undefined,
  onCommentCountChange?: (delta: number) => void,
  enabled = true,
): UsePostCommentsResult {
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

  // A post switch (opening Post B while Post A's fetch is still settling)
  // must never let Post A's rows land under Post B. Reset on every id change,
  // and every async step below checks it is still the current id before it
  // writes state.
  useEffect(() => {
    setComments([]);
    setRawComments([]);
    setRawReactions({ likeCountMap: new Map(), userLikedSet: new Set() });
    setCommentUserIds([]);
    setLoaded(false);
    setLoading(false);
  }, [postId]);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const requestedFor = postId;
    setLoading(true);
    const { data } = await supabase
      .from("post_comments")
      .select("id, user_id, content, created_at, updated_at, parent_id, is_pinned")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(200);

    // The selected post moved on while this was in flight — the response is
    // for a post nobody is looking at anymore. Discard it.
    if (requestedFor !== postId) return;

    if (!data) { setLoading(false); setLoaded(true); return; }

    const authorIds = [...new Set(data.map((c: any) => c.user_id))];
    const commentIds = data.map((c: any) => c.id);

    const [, reactionsRes, userReactionsRes] = await Promise.all([
      getAdminIds(),
      commentIds.length ? supabase.from("post_comment_reactions" as any).select("comment_id").in("comment_id", commentIds) : { data: [] },
      commentIds.length && user ? supabase.from("post_comment_reactions" as any).select("comment_id").eq("user_id", user.id).in("comment_id", commentIds) : { data: [] },
    ]);

    if (requestedFor !== postId) return;

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

    let cancelled = false;
    const buildTree = async () => {
      const adminIds = await getAdminIds();
      if (cancelled) return;

      const allComments: ThreadComment[] = rawComments.map((c: any) => ({
        ...c,
        is_pinned: c.is_pinned || false,
        author_name: resolveName(c.user_id, profileMap[c.user_id]?.full_name ?? null, adminIds),
        author_avatar: profileMap[c.user_id]?.avatar_url ?? null,
        author_handle: profileMap[c.user_id]?.custom_url ?? null,
        author_badges: resolveBadges(c.user_id, profileMap[c.user_id]?.badges || [], adminIds),
        author_last_active: profileMap[c.user_id]?.last_active_at ?? null,
        like_count: rawReactions.likeCountMap.get(c.id) || 0,
        is_liked: rawReactions.userLikedSet.has(c.id),
        replies: [],
      }));

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

      if (!cancelled) setComments(roots);
    };

    buildTree();
    return () => { cancelled = true; };
  }, [rawComments, profileMap, rawReactions, commentUserIds]);

  useEffect(() => {
    if (enabled && postId && !loaded && !loading) loadComments();
  }, [enabled, postId, loaded, loading, loadComments]);

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

  return {
    comments,
    loading: loading && !loaded,
    loaded,
    currentUserId: user?.id ?? null,
    viewer: currentProfile,
    isAdmin,
    canPin: isAdmin || (!!user?.id && user.id === postOwnerId),
    submitting: addCommentMutation.isPending,
    editSubmitting,
    addComment: (content, parentId) => {
      if (!postId) return;
      addCommentMutation.mutate({ postId, content, parentId });
    },
    editComment,
    deleteComment,
    toggleLike,
    togglePin,
    reportComment,
    reload: loadComments,
  };
}
