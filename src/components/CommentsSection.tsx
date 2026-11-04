/**
 * Comments under a JOURNAL ARTICLE (articleId) or a COMPETITION ENTRY (entryId).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DATA ADAPTER, NOT A SECOND COMMENT LIST. (4 Nov 2026.)
 *
 * This file used to draw its own comment row — a chat bubble with the like
 * count on its corner and a "time · Like · Reply" line under it — a hand-copy
 * of the thread that posts, the post page, the app's sheet and sponsored ads
 * all share (src/components/comments/CommentThread.tsx). When the Owner asked
 * for Instagram's compact spacing (4 Nov, "huge gap from each comment"), a
 * second renderer would have kept the old spacing on articles and entries and
 * drifted again at the next change. So the row is CommentThread's here too,
 * and this file keeps only what genuinely differs: the `comments` table,
 * `comment_reactions` ("like" only — no reaction picker, see onReact), and
 * `comment_reports`. Data, sorting and moderation are unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { toast } from "@/hooks/core/use-toast";
import CommentThread, { type ThreadComment } from "@/components/comments/CommentThread";
import CommentComposer from "@/components/comments/CommentComposer";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { useT } from "@/i18n/I18nContext";
import { convertEmojiShortcuts } from "@/lib/emoji";

interface Comment {
  id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  profile: { full_name: string | null; avatar_url: string | null; custom_url: string | null } | null;
  last_active: string | null;
  badges: string[];
  like_count: number;
  is_liked: boolean;
  replies: Comment[];
}

interface Props {
  articleId?: string;
  entryId?: string;
}

/** This table's row → the one shared thread's shape. */
const toThread = (c: Comment): ThreadComment => ({
  id: c.id,
  user_id: c.user_id,
  content: c.content,
  created_at: c.created_at,
  updated_at: c.updated_at,
  parent_id: c.parent_id,
  is_pinned: c.is_pinned,
  author_name: c.profile?.full_name ?? null,
  author_handle: c.profile?.custom_url ?? null,
  author_avatar: c.profile?.avatar_url ?? null,
  author_badges: c.badges,
  author_last_active: c.last_active,
  like_count: c.like_count,
  is_liked: c.is_liked,
  // comment_reactions stores "like" only, so the heart IS the reaction.
  user_reaction: c.is_liked ? "like" : null,
  reaction_counts: c.like_count > 0 ? { like: c.like_count } : {},
  replies: c.replies.map(toThread),
});

const CommentsSection = ({ articleId, entryId }: Props) => {
  const t = useT();
  const { user } = useAuth();
  const { data: currentProfile } = useProfileCore(user?.id);
  const { isAdmin } = useIsAdmin();
  const [comments, setComments] = useState<Comment[]>([]);
  const [rawComments, setRawComments] = useState<any[]>([]);
  const [rawReactions, setRawReactions] = useState<{ likeCountMap: Map<string, number>; userLikedSet: Set<string> }>({ likeCountMap: new Map(), userLikedSet: new Set() });
  const [commentUserIds, setCommentUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(!articleId); // collapsed by default on articles, open elsewhere

  const { profileMap } = useProfileMap(commentUserIds);

  const fetchComments = useCallback(async () => {
    const query = supabase
      .from("comments")
      .select("id, user_id, content, parent_id, created_at, updated_at, is_pinned")
      .order("created_at", { ascending: true });

    if (articleId) query.eq("article_id", articleId);
    if (entryId) query.eq("entry_id", entryId);

    const { data } = await query;
    if (!data) { setLoading(false); return; }

    const userIds = [...new Set(data.map((c: any) => c.user_id))];
    const commentIds = data.map((c: any) => c.id);

    const [, reactionsRes, userReactionsRes] = await Promise.all([
      getAdminIds(),
      commentIds.length ? supabase.from("comment_reactions" as any).select("comment_id").in("comment_id", commentIds) : { data: [] },
      commentIds.length && user ? supabase.from("comment_reactions" as any).select("comment_id").eq("user_id", user.id).in("comment_id", commentIds) : { data: [] },
    ]);

    const likeCountMap = new Map<string, number>();
    (reactionsRes.data as any[] || []).forEach((r: any) => {
      likeCountMap.set(r.comment_id, (likeCountMap.get(r.comment_id) || 0) + 1);
    });
    const userLikedSet = new Set((userReactionsRes.data as any[] || []).map((r: any) => r.comment_id));

    setRawComments(data);
    setRawReactions({ likeCountMap, userLikedSet });
    setCommentUserIds(userIds);
    setLoading(false);
  }, [articleId, entryId, user]);

  // Build comment tree reactively when rawComments or profileMap changes
  useEffect(() => {
    if (rawComments.length === 0) return;

    const buildTree = async () => {
      const adminIds = await getAdminIds();

      // Badges/roles now come from unified profileMap cache — no manual seeding needed

      const allComments: Comment[] = rawComments.map((c: any) => ({
        ...c,
        is_pinned: c.is_pinned || false,
        profile: {
          full_name: resolveName(c.user_id, profileMap[c.user_id]?.full_name ?? null, adminIds),
          avatar_url: profileMap[c.user_id]?.avatar_url ?? null,
          custom_url: profileMap[c.user_id]?.custom_url ?? null,
        },
        last_active: profileMap[c.user_id]?.last_active_at ?? null,
        badges: resolveBadges(c.user_id, profileMap[c.user_id]?.badges || [], adminIds),
        like_count: rawReactions.likeCountMap.get(c.id) || 0,
        is_liked: rawReactions.userLikedSet.has(c.id),
        replies: [] as Comment[],
      }));

      const rootComments: Comment[] = [];
      const commentMap = new Map<string, Comment>();
      allComments.forEach((c) => commentMap.set(c.id, c));
      allComments.forEach((c) => {
        if (c.parent_id && commentMap.has(c.parent_id)) {
          commentMap.get(c.parent_id)!.replies.push(c);
        } else {
          rootComments.push(c);
        }
      });

      setComments(rootComments);
    };

    buildTree();
  }, [rawComments, profileMap, rawReactions, commentUserIds]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  /** Resolves false when nothing was written, so the box gets the text back. */
  const handlePost = async (parentId: string | null, content: string): Promise<boolean> => {
    if (!user) return false;
    /**
     * The trailing shortcut, converted at submit.
     *
     * Owner, 2026-08-05: emoji must work *"including after the comment text"* —
     * `I love this <3` with nothing after it. Typing-time conversion in
     * MentionInput fires on a space, and there is no space here, so this is the
     * half that catches it. See src/lib/emoji.ts.
     */
    const text = convertEmojiShortcuts(content.trim());
    if (!text) return false;
    if (text.length > 2000) {
      toast({ title: t("cmt.tooLong"), variant: "destructive" });
      return false;
    }

    const optimistic: Comment = {
      id: `temp-${Date.now()}`,
      user_id: user.id,
      content: text,
      parent_id: parentId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_pinned: false,
      last_active: null,
      profile: {
        full_name: currentProfile?.full_name || "You",
        avatar_url: currentProfile?.avatar_url || null,
        custom_url: (currentProfile as { custom_url?: string | null } | null)?.custom_url ?? null,
      },
      badges: [],
      like_count: 0,
      is_liked: false,
      replies: [],
    };

    if (parentId) {
      setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: [...c.replies, optimistic] } : c));
    } else {
      setComments((prev) => [...prev, optimistic]);
    }

    setSubmitting(true);
    const { error } = await supabase.from("comments").insert({
      user_id: user.id,
      content: text,
      parent_id: parentId,
      article_id: articleId || null,
      entry_id: entryId || null,
    } as any);

    setSubmitting(false);
    if (error) {
      toast({ title: t("cmt.postFailed"), description: error.message, variant: "destructive" });
      if (parentId) {
        setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== optimistic.id) } : c));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      }
      return false;
    }
    fetchComments();
    return true;
  };

  const handleDelete = async (commentId: string, parentId: string | null) => {
    if (parentId) {
      setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== commentId) } : c));
    } else {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
    const { error } = await supabase.from("comments").delete().eq("id", commentId);
    if (error) {
      toast({ title: t("cmt.deleteFailed"), variant: "destructive" });
      fetchComments();
    }
  };

  /** Resolves true to close the editor; false leaves it open with the text in it. */
  const editComment = async (commentId: string, content: string): Promise<boolean> => {
    const text = content.trim();
    if (!text) return false;
    setSubmitting(true);
    const { error } = await supabase
      .from("comments")
      .update({ content: text, updated_at: new Date().toISOString() })
      .eq("id", commentId);
    setSubmitting(false);
    if (error) {
      toast({ title: t("cmt.editFailed"), variant: "destructive" });
      return false;
    }
    const updateInTree = (list: Comment[]): Comment[] =>
      list.map((c) => c.id === commentId
        ? { ...c, content: text, updated_at: new Date().toISOString() }
        : { ...c, replies: updateInTree(c.replies) }
      );
    setComments(updateInTree);
    return true;
  };

  const findComment = (list: Comment[], id: string): Comment | undefined => {
    for (const c of list) {
      if (c.id === id) return c;
      const found = findComment(c.replies, id);
      if (found) return found;
    }
    return undefined;
  };

  const toggleLike = async (commentId: string) => {
    if (!user) return;
    const updateLike = (list: Comment[]): Comment[] =>
      list.map((c) => c.id === commentId
        ? { ...c, is_liked: !c.is_liked, like_count: c.is_liked ? c.like_count - 1 : c.like_count + 1 }
        : { ...c, replies: updateLike(c.replies) }
      );
    setComments(updateLike);

    const isCurrentlyLiked = findComment(comments, commentId)?.is_liked;
    if (isCurrentlyLiked) {
      await supabase.from("comment_reactions" as any).delete().eq("comment_id", commentId).eq("user_id", user.id);
    } else {
      await supabase.from("comment_reactions" as any).insert({ comment_id: commentId, user_id: user.id, reaction_type: "like" } as any);
    }
  };

  const togglePin = async (commentId: string) => {
    const comment = findComment(comments, commentId);
    if (!comment) return;
    const newPinned = !comment.is_pinned;
    const updatePin = (list: Comment[]): Comment[] =>
      list.map((c) => c.id === commentId ? { ...c, is_pinned: newPinned } : c);
    setComments(updatePin);
    await supabase.from("comments").update({ is_pinned: newPinned } as any).eq("id", commentId);
  };

  const reportComment = async (commentId: string, reason: string) => {
    if (!user || !reason) return;
    const { error } = await supabase.from("comment_reports").insert({
      comment_id: commentId,
      reporter_id: user.id,
      reason: reason.toLowerCase().replace(/\s/g, "_"),
    } as any);
    if (error?.code === "23505") {
      toast({ title: t("cmt.alreadyReported") });
    } else if (error) {
      toast({ title: t("cmt.reportFailed"), variant: "destructive" });
    } else {
      toast({ title: t("cmt.reported") });
    }
  };

  const threadComments = useMemo(() => comments.map(toThread), [comments]);
  const totalCount = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  if (articleId && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-8 w-full flex items-center justify-between gap-3 border-y border-border py-3 px-1 text-sm text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          <span className="font-medium">{t("cmt.comments")}{totalCount > 0 ? ` (${totalCount})` : ""}</span>
          <span className="text-xs text-muted-foreground/70 hidden sm:inline">{t("cmt.joinDiscussion")}</span>
        </span>
        <ChevronDown className="h-4 w-4 group-hover:translate-y-0.5 transition-transform" />
      </button>
    );
  }

  return (
    <div className="mt-8 bg-card rounded-lg shadow-sm border border-border">
      <div className="px-4 pt-4 pb-2 border-b border-border flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-muted-foreground" />
          {t("cmt.comments")}
          {totalCount > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({totalCount})</span>
          )}
        </h3>
        {articleId && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
            title="Collapse"
          >
            {t("cmt.hide")}
          </button>
        )}
      </div>

      <div className="p-4">
        {user ? (
          <div className="mb-4">
            {/* The one shared composer (the post sheet's), so the box looks and
                behaves the same on every surface. */}
            <CommentComposer
              currentUserId={user.id}
              viewer={currentProfile ?? null}
              submitting={submitting}
              maxLength={2200}
              placeholder={t("cmt.phWrite")}
              onSubmit={(content) => handlePost(null, content)}
            />
          </div>
        ) : (
          <div className="bg-muted rounded-lg p-4 text-center mb-4">
            <p className="text-sm text-muted-foreground mb-2">{t("cmt.loginToJoin")}</p>
            <Link to="/login" className="text-sm font-semibold text-primary hover:underline">{t("nav.login")}</Link>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground animate-pulse py-6 text-center">{t("cmt.loading")}</div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <MessageCircle className="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground">{t("cmt.noComments")}</p>
          </div>
        ) : (
          <div className="-mx-3 -my-2">
            <CommentThread
              comments={threadComments}
              loading={false}
              currentUserId={user?.id ?? null}
              viewer={currentProfile ?? null}
              isAdmin={isAdmin}
              canPin={isAdmin}
              submitting={submitting}
              editSubmitting={submitting}
              maxLength={2200}
              hideComposer
              features={{ reactions: true, pinning: true, reporting: true, sorting: true }}
              onAdd={(content, parentId) => handlePost(parentId, content)}
              onEdit={editComment}
              onDelete={handleDelete}
              onToggleLike={toggleLike}
              onTogglePin={togglePin}
              onReport={reportComment}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CommentsSection;
