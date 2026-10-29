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
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { toast } from "@/hooks/core/use-toast";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { useAddComment } from "@/hooks/feed/useAddComment";
import type { ThreadComment } from "@/components/comments/CommentThread";
import { createThreadCache, threadCacheKey } from "@/lib/comments/threadCache";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { rememberThread, savedThread, seenContentEpoch, type SavedAuthor } from "@/lib/offline/seenContent";
import type { ProfileMapEntry } from "@/lib/profileMapCache";

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
async function fetchThreadRows(postId: string, focusCommentId?: string | null): Promise<CommentRow[] | null> {
  const rows = await fetchFirstPage(postId);
  if (!rows || !focusCommentId || rows.some((r) => r.id === focusCommentId)) return rows;
  return [...rows, ...(await fetchFocus(postId, focusCommentId, rows))];
}

/**
 * S4-b · THE COMMENT A NOTIFICATION POINTS AT, WHEREVER IT IS IN THE THREAD.
 *
 * The thread reads its first 200 comments. A notification about comment 340
 * must still land on comment 340, so when the focus is not among them it is
 * read by id (and, for a reply, its parent too, so it draws in place under
 * it). The same table and the same RLS as the thread — scoped to this post,
 * so an id from elsewhere reads nothing.
 */
async function fetchFocus(postId: string, focusId: string, have: CommentRow[]): Promise<CommentRow[]> {
  const read = async (id: string) => {
    const { data } = await supabase
      .from("post_comments")
      .select(`${COMMENT_COLUMNS}, post_comment_reactions(user_id, reaction_type)`)
      .eq("post_id", postId)
      .eq("id", id)
      .limit(1);
    return ((data as unknown as CommentRow[] | null) ?? [])[0] ?? null;
  };
  const focus = await read(focusId);
  if (!focus) return [];
  const parent = focus.parent_id && !have.some((r) => r.id === focus.parent_id) ? await read(focus.parent_id) : null;
  return parent ? [parent, focus] : [focus];
}

async function fetchFirstPage(postId: string): Promise<CommentRow[] | null> {
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
 * once and refreshes behind the list. In memory only, keyed by VIEWER and post,
 * bounded, and emptied on every sign-out (src/lib/comments/threadCache.ts).
 * Every open still re-reads, and that read always replaces the screen.
 */
const THREAD_CACHE = createThreadCache<CommentRow[]>();
/** A write on the thread makes the remembered copy wrong; the next open re-reads it fresh. */
const forgetThread = (postId: string | null | undefined) => THREAD_CACHE.forget(postId);
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
  /** S4-b: a comment that must be in the thread even beyond its first page (a notification's). */
  focusCommentId?: string | null,
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
  const qc = useQueryClient();
  /** S7b-4: rows this screen just read ONLINE, waiting for their authors' names to be saved. */
  const onlineRowsRef = useRef<{ key: string; rows: CommentRow[]; epoch: number } | null>(null);

  // WHOSE thread the state on screen is: this viewer's copy of this post.
  // A member change (A signs out, B signs in, the component never unmounted)
  // makes the key differ, and until the reset below has run the hook hands out
  // NOTHING rather than A's rows, not even for one frame. The ref lets an
  // in-flight read check, after its await, that it is still for this key.
  const viewerId = user?.id ?? null;
  const threadKey = postId ? threadCacheKey(viewerId, postId) : "";
  const threadKeyRef = useRef(threadKey);
  threadKeyRef.current = threadKey;
  const [shownKey, setShownKey] = useState(threadKey);

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
  const applyRows = useCallback((rows: CommentRow[], forViewer: string | null) => {
    const split = splitThreadRows(rows, forViewer ?? undefined);
    // The server always wins, an EMPTY answer included. The tree effect below
    // does nothing for zero rows, so the list is emptied here; otherwise a
    // thread whose comments were deleted or moderated elsewhere would keep
    // showing the cached copy for the rest of the session.
    if (split.comments.length === 0) setComments([]);
    setRawComments(split.comments);
    setRawReactions(split.reactions);
    setCommentUserIds(split.authorIds);
  }, []);

  useEffect(() => {
    setComments([]);
    setShownKey(threadKey);
    const cached = postId ? THREAD_CACHE.get(viewerId, postId) : undefined;
    if (cached) {
      applyRows(cached, viewerId);
    } else {
      setRawComments([]);
      setRawReactions({ likeCountMap: new Map(), userLikedSet: new Set(), reactionCountsMap: new Map(), userReactionMap: new Map() });
      setCommentUserIds([]);
    }
    setLoaded(false);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per post and per VIEWER id; a new `user` object for the same member (token refresh) must not wipe the thread
  }, [postId, viewerId]);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const requestedFor = threadCacheKey(viewerId, postId);
    // Only a thread with nothing to show says "Loading comments…". A cached
    // one stays on screen while it refreshes.
    if (!THREAD_CACHE.has(viewerId, postId)) setLoading(true);
    const epochAtStart = seenContentEpoch();
    const [rows] = await Promise.all([fetchThreadRows(postId, focusCommentId), getAdminIds()]);

    // The selected post, or the member, moved on while this was in flight:
    // the response is for a screen nobody is looking at anymore. Discard it.
    if (requestedFor !== threadKeyRef.current) return;

    if (rows) {
      THREAD_CACHE.set(viewerId, postId, rows);
      onlineRowsRef.current = { key: requestedFor, rows, epoch: epochAtStart };
      applyRows(rows, viewerId);
    } else if (viewerId && !THREAD_CACHE.has(viewerId, postId)) {
      // S7b-4: the read failed (no network) and nothing is in memory: the
      // thread as this member last read it online, with its authors' names.
      const saved = await savedThread<CommentRow>(viewerId, postId);
      if (requestedFor !== threadKeyRef.current) return;
      if (saved && saved.rows.length > 0) {
        const ids = [...new Set(saved.rows.map((r) => r.user_id))].sort();
        if (!qc.getQueryData(queryKeys.profileMap(ids))) {
          const entries = ids.map((id): [string, ProfileMapEntry] => {
            const a: SavedAuthor | undefined = saved.authors[id];
            return [id, {
              id, full_name: a?.full_name ?? null, avatar_url: a?.avatar_url ?? null, badges: a?.badges ?? [], roles: [],
              last_active_at: null, custom_url: a?.custom_url ?? null,
            } as ProfileMapEntry];
          });
          // Old data (updatedAt 0): the live names replace it once online.
          qc.setQueryData(queryKeys.profileMap(ids), new Map(entries), { updatedAt: 0 });
        }
        applyRows(saved.rows, viewerId);
      }
    }
    setLoading(false);
    setLoaded(true);
  }, [postId, viewerId, applyRows, focusCommentId, qc]);

  // S7b-4: a thread read online is kept on the phone with its authors' names
  // (once they have arrived), so it opens with no network next time.
  useEffect(() => {
    const o = onlineRowsRef.current;
    if (!o || o.key !== threadKey || !viewerId || !postId) return;
    const ids = [...new Set(o.rows.map((r) => r.user_id))];
    if (!ids.every((id) => profileMap[id])) return; // names not here yet
    const authors: Record<string, SavedAuthor> = {};
    for (const id of ids) {
      const p = profileMap[id];
      authors[id] = { full_name: p.full_name ?? null, avatar_url: p.avatar_url ?? null, custom_url: p.custom_url ?? null, badges: p.badges ?? [] };
    }
    onlineRowsRef.current = null;
    void rememberThread(viewerId, postId, o.rows, authors, { epoch: o.epoch });
  }, [profileMap, threadKey, viewerId, postId, rawComments]);

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
    comments: shownKey === threadKey ? comments : [],
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
