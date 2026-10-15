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

/** One post_comments row as the thread reads it, its reactions embedded. */
interface CommentRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string | null;
  parent_id: string | null;
  is_pinned: boolean | null;
  post_comment_reactions?: { user_id: string; reaction_type: string }[] | null;
}

const COMMENT_COLUMNS = "id, user_id, content, created_at, updated_at, parent_id, is_pinned";

/**
 * The thread in ONE request: the comments with their reactions embedded
 * (post_comment_reactions_comment_id_fkey). null = the comments themselves
 * could not be read. If only the EMBED is refused, the previous two-step read
 * runs instead, so a schema without the FK costs a round trip, never the thread.
 */
async function fetchThreadRows(postId: string): Promise<CommentRow[] | null> {
  const one = await supabase
    .from("post_comments")
    .select(`${COMMENT_COLUMNS}, post_comment_reactions(user_id, reaction_type)`)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (!one.error) return (one.data as unknown as CommentRow[] | null) ?? null;

  const { data } = await supabase
    .from("post_comments")
    .select(COMMENT_COLUMNS)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (!data) return null;
  const ids = data.map((c: any) => c.id);
  const reactions = ids.length
    ? ((await supabase.from("post_comment_reactions" as any).select("comment_id, user_id, reaction_type").in("comment_id", ids)).data as any[] | null) ?? []
    : [];
  const byComment = new Map<string, { user_id: string; reaction_type: string }[]>();
  reactions.forEach((r: any) => {
    const list = byComment.get(r.comment_id) || [];
    list.push({ user_id: r.user_id, reaction_type: r.reaction_type });
    byComment.set(r.comment_id, list);
  });
  return (data as any[]).map((c) => ({ ...c, post_comment_reactions: byComment.get(c.id) || [] }));
}

/** The per-type totals (for the badge) and "which reaction did I pick", from the embedded rows. */
function splitThreadRows(rows: CommentRow[], viewerId: string | undefined) {
  const likeCountMap = new Map<string, number>();
  const userLikedSet = new Set<string>();
  const reactionCountsMap = new Map<string, Record<string, number>>();
  const userReactionMap = new Map<string, string>();
  const comments = rows.map(({ post_comment_reactions, ...c }) => {
    (post_comment_reactions || []).forEach((r) => {
      likeCountMap.set(c.id, (likeCountMap.get(c.id) || 0) + 1);
      const counts = reactionCountsMap.get(c.id) || {};
      counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1;
      reactionCountsMap.set(c.id, counts);
      if (viewerId && r.user_id === viewerId) {
        userLikedSet.add(c.id);
        userReactionMap.set(c.id, r.reaction_type);
      }
    });
    return c;
  });
  return {
    comments,
    reactions: { likeCountMap, userLikedSet, reactionCountsMap, userReactionMap },
    authorIds: [...new Set(rows.map((c) => c.user_id))],
  };
}

/**
 * The last read of each thread opened this session, so a second open draws at
 * once and refreshes behind the list. Small and in memory only: it holds what
 * this member has already been shown, and every open still re-reads.
 */
const THREAD_CACHE = new Map<string, CommentRow[]>();
const THREAD_CACHE_MAX = 30;
function rememberThread(postId: string, rows: CommentRow[]) {
  THREAD_CACHE.delete(postId);
  THREAD_CACHE.set(postId, rows);
  if (THREAD_CACHE.size > THREAD_CACHE_MAX) THREAD_CACHE.delete(THREAD_CACHE.keys().next().value as string);
}
/** A write on the thread makes the remembered copy wrong; the next open re-reads it fresh. */
const forgetThread = (postId: string | null | undefined) => { if (postId) THREAD_CACHE.delete(postId); };
/** Test seam: each test starts with no thread remembered. */
export const __clearThreadCacheForTests = () => THREAD_CACHE.clear();

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
  /** Set (or clear, by re-passing the same type) the viewer's reaction on a comment. */
  setReaction: (commentId: string, reactionType: string) => Promise<void>;
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
  const [rawReactions, setRawReactions] = useState<{
    likeCountMap: Map<string, number>;
    userLikedSet: Set<string>;
    /** comment_id -> { reaction_type: count }, e.g. { like: 3, love: 1 }. */
    reactionCountsMap: Map<string, Record<string, number>>;
    /** comment_id -> the reaction_type the current viewer picked. */
    userReactionMap: Map<string, string>;
  }>({ likeCountMap: new Map(), userLikedSet: new Set(), reactionCountsMap: new Map(), userReactionMap: new Map() });
  const [commentUserIds, setCommentUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const { profileMap } = useProfileMap(commentUserIds);

  /**
   * BUG 5 (Owner, 15 Oct 2026: "comments take very long to load").
   *
   * MEASURED, not guessed — tools/uishot/comments-load-timing.mjs, a real
   * browser on staging, click → first comment visible: median 582 ms, and the
   * whole of it was TWO round trips IN SERIES. post_comments went out, came
   * back, and only then did post_comment_reactions go out (`.in()` on the ids
   * the first one returned). Each one is ~230 ms of pure network on its own
   * (a trivial site_settings read costs the same), so the queries were never
   * slow — the staircase was. On a phone's network every step of it is longer.
   *
   * The reactions now ride INSIDE the comments request — PostgREST embeds them
   * through post_comment_reactions_comment_id_fkey, with the same RLS as the
   * separate read had — so the thread is ONE round trip, with getAdminIds()
   * beside it instead of behind it. If the embed is ever refused (a schema
   * that lost the FK), the old two-step read runs instead: slower, never empty.
   *
   * And a thread that has been opened once is kept (THREAD_CACHE, below): the
   * second open of the same post draws the list at once and refreshes behind
   * it, and the reload after posting a comment no longer swaps the whole list
   * for "Loading comments…" while it re-reads.
   */
  // A post switch (opening Post B while Post A's fetch is still settling)
  // must never let Post A's rows land under Post B. Reset on every id change,
  // and every async step below checks it is still the current id before it
  // writes state.
  const applyRows = useCallback((rows: CommentRow[], viewerId: string | undefined) => {
    const split = splitThreadRows(rows, viewerId);
    setRawComments(split.comments);
    setRawReactions(split.reactions);
    setCommentUserIds(split.authorIds);
  }, []);

  useEffect(() => {
    setComments([]);
    const cached = postId ? THREAD_CACHE.get(postId) : undefined;
    if (cached) {
      applyRows(cached, user?.id);
    } else {
      setRawComments([]);
      setRawReactions({ likeCountMap: new Map(), userLikedSet: new Set(), reactionCountsMap: new Map(), userReactionMap: new Map() });
      setCommentUserIds([]);
    }
    setLoaded(false);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per post only; `user` changing must not wipe the thread
  }, [postId]);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const requestedFor = postId;
    // Only a thread with nothing to show says "Loading comments…". A cached
    // one stays on screen while it refreshes.
    if (!THREAD_CACHE.has(postId)) setLoading(true);
    const [rows] = await Promise.all([fetchThreadRows(postId), getAdminIds()]);

    // The selected post moved on while this was in flight — the response is
    // for a post nobody is looking at anymore. Discard it.
    if (requestedFor !== postId) return;

    if (rows) {
      rememberThread(postId, rows);
      applyRows(rows, user?.id);
    }
    setLoading(false);
    setLoaded(true);
  }, [postId, user, applyRows]);

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
        reaction_counts: rawReactions.reactionCountsMap.get(c.id) || {},
        user_reaction: rawReactions.userReactionMap.get(c.id) ?? null,
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
    forgetThread(postId);
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
    forgetThread(postId);
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

  /**
   * Set the viewer's reaction on a comment to `reactionType` (any of
   * REACTIONS in CommentThread.tsx) — or clear it, by passing the type
   * that's already active (the emoji picker's own toggle-off).
   *
   * The table has no UPDATE policy (see the 20260323 migration — only
   * SELECT/INSERT own/DELETE own), so switching from one reaction to
   * another is a delete-then-insert, not an upsert; both steps are already
   * covered by the existing RLS, so this needed no schema change.
   */
  const setReaction = async (commentId: string, reactionType: string) => {
    forgetThread(postId);
    if (!user) return;
    const current = findComment(comments, commentId)?.user_reaction ?? null;
    const turningOff = current === reactionType;

    const applyReaction = (list: ThreadComment[]): ThreadComment[] =>
      list.map((c) => {
        if (c.id !== commentId) return { ...c, replies: applyReaction(c.replies) };
        const counts = { ...(c.reaction_counts || {}) };
        if (current) counts[current] = Math.max(0, (counts[current] || 0) - 1);
        if (!turningOff) counts[reactionType] = (counts[reactionType] || 0) + 1;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        return {
          ...c,
          reaction_counts: counts,
          user_reaction: turningOff ? null : reactionType,
          is_liked: !turningOff,
          like_count: total,
        };
      });
    setComments(applyReaction);

    if (current) {
      await supabase.from("post_comment_reactions" as any).delete().eq("comment_id", commentId).eq("user_id", user.id);
    }
    if (!turningOff) {
      await supabase.from("post_comment_reactions" as any).insert({ comment_id: commentId, user_id: user.id, reaction_type: reactionType } as any);
    }
  };

  /** Back-compat: a plain tap on "Like" is just the default reaction. */
  const toggleLike = (commentId: string) => setReaction(commentId, "like");

  const togglePin = async (commentId: string) => {
    forgetThread(postId);
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
    setReaction,
    togglePin,
    reportComment,
    reload: loadComments,
  };
}
