import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, ThumbsUp, MoreHorizontal, Trash2, Flag, Pin, Pencil, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { toast } from "@/hooks/core/use-toast";
import MentionInput from "@/components/MentionInput";
import RichContentRenderer from "@/components/RichContentRenderer";
import AutoBadge from "@/components/AutoBadge";
import AutoRole from "@/components/AutoRole";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Comment {
  id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  profile: { full_name: string | null; avatar_url: string | null } | null;
  badges: string[];
  like_count: number;
  is_liked: boolean;
  replies: Comment[];
}

interface Props {
  articleId?: string;
  entryId?: string;
}

const REPORT_REASONS = ["Inappropriate", "Spam", "Harassment", "Nudity", "Hate Speech", "False Information", "Violence"];

const Avatar = ({ src, name, size = "sm" }: { src: string | null | undefined; name: string | null | undefined; size?: "xs" | "sm" }) => {
  const cls = size === "xs" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
  if (src) return <img loading="lazy" decoding="async" src={src} alt="" className={`${cls} rounded-full object-cover`} />;
  return (
    <div className={`${cls} rounded-full bg-muted flex items-center justify-center font-semibold text-muted-foreground`}>
      {(name || "?")[0]?.toUpperCase()}
    </div>
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

const CommentsSection = ({ articleId, entryId }: Props) => {
  const { user } = useAuth();
  const { data: currentProfile } = useProfileCore(user?.id);
  const { isAdmin } = useIsAdmin();
  const [comments, setComments] = useState<Comment[]>([]);
  const [rawComments, setRawComments] = useState<any[]>([]);
  const [rawReactions, setRawReactions] = useState<{ likeCountMap: Map<string, number>; userLikedSet: Set<string> }>({ likeCountMap: new Map(), userLikedSet: new Set() });
  const [commentUserIds, setCommentUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sortMode, setSortMode] = useState<"relevant" | "newest">("relevant");
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

    const [adminIds, reactionsRes, userReactionsRes] = await Promise.all([
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
        },
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

  const sortedComments = [...comments].sort((a, b) => {
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

  const handlePost = async (parentId: string | null = null) => {
    if (!user) return;
    const text = parentId ? replyText.trim() : newComment.trim();
    if (!text) return;
    if (text.length > 2000) {
      toast({ title: "Comment too long (max 2000 chars)", variant: "destructive" });
      return;
    }

    const optimistic: Comment = {
      id: `temp-${Date.now()}`,
      user_id: user.id,
      content: text,
      parent_id: parentId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_pinned: false,
      profile: { full_name: currentProfile?.full_name || "You", avatar_url: currentProfile?.avatar_url || null },
      badges: [],
      like_count: 0,
      is_liked: false,
      replies: [],
    };

    if (parentId) {
      setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: [...c.replies, optimistic] } : c));
      setReplyText(""); setReplyTo(null);
    } else {
      setComments((prev) => [...prev, optimistic]);
      setNewComment("");
    }

    setSubmitting(true);
    const { error } = await supabase.from("comments").insert({
      user_id: user.id,
      content: text,
      parent_id: parentId,
      article_id: articleId || null,
      entry_id: entryId || null,
    } as any);

    if (error) {
      toast({ title: "Failed to post comment", description: error.message, variant: "destructive" });
      if (parentId) {
        setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== optimistic.id) } : c));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      }
    } else {
      fetchComments();
    }
    setSubmitting(false);
  };

  const handleDelete = async (commentId: string, parentId: string | null) => {
    if (parentId) {
      setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== commentId) } : c));
    } else {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
    const { error } = await supabase.from("comments").delete().eq("id", commentId);
    if (error) {
      toast({ title: "Failed to delete", variant: "destructive" });
      fetchComments();
    }
  };

  const editComment = async (commentId: string) => {
    if (!editInput.trim()) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("comments")
      .update({ content: editInput.trim(), updated_at: new Date().toISOString() })
      .eq("id", commentId);
    if (error) {
      toast({ title: "Failed to edit", variant: "destructive" });
    } else {
      const updateInTree = (list: Comment[]): Comment[] =>
        list.map((c) => c.id === commentId
          ? { ...c, content: editInput.trim(), updated_at: new Date().toISOString() }
          : { ...c, replies: updateInTree(c.replies) }
        );
      setComments(updateInTree);
      setEditingId(null);
      setEditInput("");
    }
    setSubmitting(false);
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

  const reportComment = async (commentId: string) => {
    if (!user || !reportReason) return;
    const { error } = await supabase.from("comment_reports").insert({
      comment_id: commentId,
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

  const findComment = (list: Comment[], id: string): Comment | undefined => {
    for (const c of list) {
      if (c.id === id) return c;
      const found = findComment(c.replies, id);
      if (found) return found;
    }
    return undefined;
  };

  const isEdited = (c: Comment) => c.updated_at && c.updated_at !== c.created_at && new Date(c.updated_at).getTime() - new Date(c.created_at).getTime() > 2000;

  const totalCount = comments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  const CommentItem = ({ comment, depth = 0 }: { comment: Comment; depth?: number }) => {
    const isOwn = user?.id === comment.user_id;
    const canDelete = isOwn || isAdmin;

    return (
      <div className={`${depth > 0 ? "ml-10" : ""}`}>
        <div className="flex gap-2 group/comment py-0.5">
          <Link to={`/profile/${comment.user_id}`} className="shrink-0 mt-0.5">
            <Avatar src={comment.profile?.avatar_url} name={comment.profile?.full_name} size={depth > 0 ? "xs" : "sm"} />
          </Link>
          <div className="flex-1 min-w-0">
            {editingId === comment.id ? (
              <div className="flex gap-2 items-end">
                <MentionInput
                  value={editInput}
                  onChange={setEditInput}
                  onSubmit={() => editComment(comment.id)}
                  placeholder="Edit comment..."
                  disabled={submitting}
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
                {comment.is_pinned && (
                  <div className="flex items-center gap-1 text-[10px] text-primary font-medium mb-0.5">
                    <Pin className="h-3 w-3" /> Pinned comment
                  </div>
                )}

                <div className="relative inline-block max-w-full">
                  <div className="bg-muted rounded-2xl px-3 py-2 inline-block max-w-full">
                    <UserIdentityBlock
                      userId={comment.user_id}
                      name={comment.profile?.full_name || "Anonymous"}
                      linkTo={`/profile/${comment.user_id}`}
                    />
                    <p className="text-[15px] text-foreground leading-[1.33] break-words">
                      <RichContentRenderer content={comment.content} />
                    </p>
                    {isEdited(comment) && (
                      <span className="text-[10px] text-muted-foreground italic ml-1">Edited</span>
                    )}
                  </div>

                  {comment.like_count > 0 && (
                    <span className="absolute -bottom-2 right-2 bg-card border border-border rounded-full px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm flex items-center gap-0.5">
                      👍 {comment.like_count}
                    </span>
                  )}
                </div>

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
                          const name = comment.profile?.full_name || "Photographer";
                          setReplyText(`@[${name}](${comment.user_id}) `);
                        } else {
                          setReplyText("");
                        }
                      }}
                      className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Reply
                    </button>
                  )}

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
                        {isAdmin && depth === 0 && (
                          <DropdownMenuItem onClick={() => togglePin(comment.id)} className="cursor-pointer">
                            <Pin className="h-3.5 w-3.5 mr-2" /> {comment.is_pinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem onClick={() => handleDelete(comment.id, comment.parent_id)} className="cursor-pointer text-destructive focus:text-destructive">
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

                {replyTo === comment.id && (
                  <div className="flex gap-2 mt-2">
                    <Avatar src={currentProfile?.avatar_url} name={currentProfile?.full_name} size="xs" />
                    <MentionInput
                      value={replyText}
                      onChange={setReplyText}
                      onSubmit={() => handlePost(comment.id)}
                      placeholder={`Reply to ${comment.profile?.full_name || "Photographer"}...`}
                      disabled={submitting}
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

        {comment.replies.map((reply) => (
          <CommentItem key={reply.id} comment={reply} depth={depth + 1} />
        ))}
      </div>
    );
  };

  if (articleId && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-8 w-full flex items-center justify-between gap-3 border-y border-border py-3 px-1 text-sm text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          <span className="font-medium">Comments{totalCount > 0 ? ` (${totalCount})` : ""}</span>
          <span className="text-xs text-muted-foreground/70 hidden sm:inline">— Join the discussion</span>
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
          Comments
          {totalCount > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({totalCount})</span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {totalCount > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1">
                  {sortMode === "relevant" ? "Most relevant" : "Newest first"}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => setSortMode("relevant")} className="cursor-pointer text-xs">Most relevant</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("newest")} className="cursor-pointer text-xs">Newest first</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {articleId && (
            <button
              onClick={() => setExpanded(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
              title="Collapse"
            >
              Hide
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        {user ? (
          <div className="flex gap-2 mb-4">
            <Avatar src={currentProfile?.avatar_url} name={currentProfile?.full_name} size="sm" />
            <MentionInput
              value={newComment}
              onChange={setNewComment}
              onSubmit={() => handlePost()}
              placeholder="Write a comment..."
              disabled={submitting}
              maxLength={2200}
            />
          </div>
        ) : (
          <div className="bg-muted rounded-lg p-4 text-center mb-4">
            <p className="text-sm text-muted-foreground mb-2">Log in to join the conversation</p>
            <Link to="/login" className="text-sm font-semibold text-primary hover:underline">Login</Link>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground animate-pulse py-6 text-center">Loading comments…</div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <MessageCircle className="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground">No comments yet. Be the first to share your thoughts!</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sortedComments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommentsSection;
