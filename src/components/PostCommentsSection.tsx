import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { ThumbsUp, Reply, MoreHorizontal, Trash2, Flag, Pin, Pencil, Send, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { isActiveNow } from "@/hooks/core/useLastActive";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { toast } from "@/hooks/core/use-toast";
import MentionInput from "@/components/MentionInput";
import RichContentRenderer from "@/components/RichContentRenderer";
import AutoBadge from "@/components/AutoBadge";
import AutoRole from "@/components/AutoRole";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { useAddComment } from "@/hooks/feed/useAddComment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PostComment {
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
  author_last_active: string | null;
  like_count: number;
  is_liked: boolean;
  replies: PostComment[];
}

interface Props {
  postId: string;
  postOwnerId: string;
  expanded: boolean;
  onCommentCountChange?: (delta: number) => void;
}

const REPORT_REASONS = ["Inappropriate", "Spam", "Harassment", "Nudity", "Hate Speech", "False Information", "Violence"];

const Avatar = ({ src, name, size = "sm", lastActiveAt }: { src: string | null | undefined; name: string | null | undefined; size?: "xs" | "sm"; lastActiveAt?: string | null }) => {
  const cls = size === "xs" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
  const online = isActiveNow(lastActiveAt);
  return (
    <span className={`relative inline-block ${cls}`}>
      {src ? (
        <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={src} alt="" className={`${cls} rounded-full object-cover`} />
      ) : (
        <div className={`${cls} rounded-full bg-muted flex items-center justify-center font-semibold text-muted-foreground`}>
          {(name || "?")[0]?.toUpperCase()}
        </div>
      )}
      {online && (
        <span aria-label="Online" title="Online" className="absolute bottom-0 right-0 block h-2 w-2 rounded-full bg-green-500 ring-2 ring-background" />
      )}
    </span>
  );
};

const timeAgo = (date: string) => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const PostCommentsSection = ({ postId, postOwnerId, expanded, onCommentCountChange }: Props) => {
  const { user } = useAuth();
  const { data: currentProfile } = useProfileCore(user?.id);
  const { isAdmin } = useIsAdmin();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [rawComments, setRawComments] = useState<any[]>([]);
  const [rawReactions, setRawReactions] = useState<{ likeCountMap: Map<string, number>; userLikedSet: Set<string> }>({ likeCountMap: new Map(), userLikedSet: new Set() });
  const [commentUserIds, setCommentUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [sortMode, setSortMode] = useState<"relevant" | "newest">("relevant");
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

    const [adminIds, reactionsRes, userReactionsRes] = await Promise.all([
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

      const allComments: PostComment[] = rawComments.map((c: any) => ({
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
      const map = new Map<string, PostComment>();
      allComments.forEach((c) => map.set(c.id, c));
      const roots: PostComment[] = [];
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

  const sortedComments = [...comments].sort((a, b) => {
    // Pinned first
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    if (sortMode === "relevant") {
      const scoreA = a.like_count + a.replies.length;
      const scoreB = b.like_count + b.replies.length;
      if (scoreA !== scoreB) return scoreB - scoreA;
    }
    if (sortMode === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const submitComment = (parentId: string | null = null) => {
    if (!user || addCommentMutation.isPending) return;
    const text = parentId ? replyInput.trim() : commentInput.trim();
    if (!text) return;
    if (parentId) {
      setReplyInput("");
      setReplyTo(null);
    } else {
      setCommentInput("");
    }
    addCommentMutation.mutate({ postId, content: text, parentId });
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

  const editComment = async (commentId: string) => {
    if (!editInput.trim()) return;
    setEditSubmitting(true);
    const { error } = await supabase
      .from("post_comments")
      .update({ content: editInput.trim(), updated_at: new Date().toISOString() })
      .eq("id", commentId);
    if (error) {
      toast({ title: "Failed to edit", variant: "destructive" });
    } else {
      // Update locally
      const updateInTree = (list: PostComment[]): PostComment[] =>
        list.map((c) => c.id === commentId
          ? { ...c, content: editInput.trim(), updated_at: new Date().toISOString() }
          : { ...c, replies: updateInTree(c.replies) }
        );
      setComments(updateInTree);
      setEditingId(null);
      setEditInput("");
    }
    setEditSubmitting(false);
  };

  const toggleLike = async (commentId: string) => {
    if (!user) return;
    const updateLike = (list: PostComment[]): PostComment[] =>
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
    const updatePin = (list: PostComment[]): PostComment[] =>
      list.map((c) => c.id === commentId ? { ...c, is_pinned: newPinned } : c);
    setComments(updatePin);
    await supabase.from("post_comments").update({ is_pinned: newPinned }).eq("id", commentId);
  };

  const reportComment = async (commentId: string) => {
    if (!user || !reportReason) return;
    const { error } = await supabase.from("comment_reports").insert({
      post_comment_id: commentId,
      reporter_id: user.id,
      reason: reportReason.toLowerCase().replace(/\s/g, "_"),
    } as any);
    if (error?.code === "23505") {
      toast({ title: "You already reported this comment" });
    } else if (error) {
      toast({ title: "Failed to report", variant: "destructive" });
    } else {
      toast({ title: "Comment reported" });
    }
    setReportingId(null);
    setReportReason("");
  };

  const findComment = (list: PostComment[], id: string): PostComment | undefined => {
    for (const c of list) {
      if (c.id === id) return c;
      const found = findComment(c.replies, id);
      if (found) return found;
    }
    return undefined;
  };

  if (!expanded) return null;

  const isEdited = (c: PostComment) => c.updated_at && c.updated_at !== c.created_at && new Date(c.updated_at).getTime() - new Date(c.created_at).getTime() > 2000;

  const CommentItem = ({ comment, depth = 0 }: { comment: PostComment; depth?: number }) => {
    const isOwn = user?.id === comment.user_id;
    const canPin = isAdmin || user?.id === postOwnerId;
    const canDelete = isOwn || isAdmin;

    return (
      <div className={depth > 0 ? "ml-10" : ""}>
        <div className="flex gap-2 group/comment py-0.5">
          <Link to={`/profile/${comment.user_id}`} className="shrink-0 mt-0.5">
            <Avatar src={comment.author_avatar} name={comment.author_name} size={depth > 0 ? "xs" : "sm"} lastActiveAt={comment.author_last_active} />
          </Link>
          <div className="flex-1 min-w-0">
            {/* Editing mode */}
            {editingId === comment.id ? (
              <div className="flex gap-2 items-end">
                <MentionInput
                  value={editInput}
                  onChange={setEditInput}
                  onSubmit={() => editComment(comment.id)}
                  placeholder="Edit comment..."
                  disabled={editSubmitting}
                  maxLength={2200}
                  autoFocus
                  className="bg-muted rounded-2xl px-3 py-2 text-sm"
                />
                <button onClick={() => { setEditingId(null); setEditInput(""); }} className="text-xs text-muted-foreground hover:text-foreground mb-2">
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {/* Pinned badge */}
                {comment.is_pinned && (
                  <div className="flex items-center gap-1 text-[10px] text-primary font-medium mb-0.5">
                    <Pin className="h-3 w-3" /> Pinned comment
                  </div>
                )}

                {/* Bubble */}
                <div className="relative inline-block max-w-full">
                  <div className="bg-popover rounded-2xl px-3 py-2 inline-block max-w-full">
                    <UserIdentityBlock
                      userId={comment.user_id}
                      name={comment.author_name || "Photographer"}
                      linkTo={`/profile/${comment.user_id}`}
                    />
                    <p className="text-[15px] text-foreground leading-[1.33] break-words">
                      <RichContentRenderer content={comment.content} />
                    </p>
                    {isEdited(comment) && (
                      <span className="text-[10px] text-muted-foreground italic ml-1">Edited</span>
                    )}
                  </div>

                  {/* Like count badge on bubble */}
                  {comment.like_count > 0 && (
                    <span className="absolute -bottom-2 right-2 bg-card border border-border rounded-full px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm flex items-center gap-0.5">
                      👍 {comment.like_count}
                    </span>
                  )}
                </div>

                {/* Action row */}
                <div className="flex items-center gap-3 mt-1 px-1">
                  <span className="text-xs text-muted-foreground font-medium">{timeAgo(comment.created_at)}</span>
                  {user && (
                    <button
                      onClick={() => toggleLike(comment.id)}
                      className={`text-xs font-semibold transition-colors ${comment.is_liked ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Like
                    </button>
                  )}
                  {user && (
                    <button
                      onClick={() => {
                        const opening = replyTo !== comment.id;
                        setReplyTo(opening ? comment.id : null);
                        if (opening) {
                          const name = comment.author_name || "Photographer";
                          setReplyInput(`@[${name}](${comment.user_id}) `);
                        } else {
                          setReplyInput("");
                        }
                      }}
                      className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Reply
                    </button>
                  )}

                  {/* 3-dot menu */}
                  {user && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="opacity-0 group-hover/comment:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted">
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        {isOwn && (
                          <DropdownMenuItem onClick={() => { setEditingId(comment.id); setEditInput(comment.content); }} className="cursor-pointer">
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                        )}
                        {canPin && depth === 0 && (
                          <DropdownMenuItem onClick={() => togglePin(comment.id)} className="cursor-pointer">
                            <Pin className="h-3.5 w-3.5 mr-2" /> {comment.is_pinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem onClick={() => deleteComment(comment.id, comment.parent_id)} className="cursor-pointer text-destructive focus:text-destructive">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        )}
                        {!isOwn && (
                          <DropdownMenuItem onClick={() => { setReportingId(comment.id); setReportReason(""); }} className="cursor-pointer text-destructive focus:text-destructive">
                            <Flag className="h-3.5 w-3.5 mr-2" /> Report
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Report inline */}
                <AnimatePresence>
                  {reportingId === comment.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden mt-1 ml-1"
                    >
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {REPORT_REASONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setReportReason(r)}
                            className={`text-[10px] px-2 py-1 border rounded-md transition-all ${reportReason === r ? "border-destructive text-destructive bg-destructive/5 font-medium" : "border-border text-muted-foreground hover:border-muted-foreground/50"}`}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => reportComment(comment.id)} disabled={!reportReason} className="text-[10px] px-3 py-1 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50">
                          Submit
                        </button>
                        <button onClick={() => { setReportingId(null); setReportReason(""); }} className="text-[10px] px-3 py-1 border border-border rounded-md text-muted-foreground">
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Reply input */}
                {replyTo === comment.id && (
                  <div className="flex gap-2 mt-2">
                    <Avatar src={currentProfile?.avatar_url} name={currentProfile?.full_name} size="xs" />
                    <MentionInput
                      value={replyInput}
                      onChange={setReplyInput}
                      onSubmit={() => submitComment(comment.id)}
                      placeholder={`Reply to ${comment.author_name || "Photographer"}...`}
                      disabled={addCommentMutation.isPending}
                      maxLength={2200}
                      autoFocus
                      className="bg-muted rounded-full px-3 py-1.5 text-sm"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Replies */}
        {comment.replies.map((reply) => (
          <CommentItem key={reply.id} comment={reply} depth={depth + 1} />
        ))}
      </div>
    );
  };

  const totalCount = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden border-t border-border"
    >
      <div className="px-3 py-2">
        {/* Sort selector */}
        {totalCount > 1 && (
          <div className="flex items-center gap-1 mb-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1">
                  {sortMode === "relevant" ? "Most relevant" : "Newest first"}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuItem onClick={() => setSortMode("relevant")} className="cursor-pointer text-xs">
                  Most relevant
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("newest")} className="cursor-pointer text-xs">
                  Newest first
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Comments */}
        {loading && !loaded ? (
          <div className="text-sm text-muted-foreground animate-pulse py-4 text-center">Loading comments…</div>
        ) : (
          <div className="space-y-0.5">
            {sortedComments.map((c) => (
              <CommentItem key={c.id} comment={c} />
            ))}
          </div>
        )}

        {/* New comment input */}
        {user && (
          <div className="flex gap-2 pt-2 pb-1">
            <Avatar src={currentProfile?.avatar_url} name={currentProfile?.full_name} size="sm" />
            <MentionInput
              value={commentInput}
              onChange={setCommentInput}
              onSubmit={() => submitComment(null)}
              placeholder="Write a comment..."
              disabled={addCommentMutation.isPending}
              maxLength={2200}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default PostCommentsSection;
