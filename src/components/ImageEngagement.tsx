import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Heart, ThumbsUp, Vote, MessageCircle, Send, Flag, Trash2, ChevronDown, ChevronUp, Loader2, AlertTriangle } from "lucide-react";
import RichContentRenderer from "@/components/RichContentRenderer";
import MentionInput from "@/components/MentionInput";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { moderateComment } from "@/lib/commentModeration";
import { motion, AnimatePresence } from "framer-motion";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";

interface Props {
  imageType: "portfolio" | "competition_entry";
  imageId: string;
  /** Per-photo scoping. Defaults to 0 when omitted (single-photo entities). */
  photoIndex?: number;
  compact?: boolean;
}

interface Reaction {
  type: string;
  count: number;
  userReacted: boolean;
}

interface Comment {
  id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  profile_name: string | null;
  avatar_url: string | null;
  badges: string[];
  is_pinned?: boolean;
  is_admin_seed?: boolean;
  replies?: Comment[];
}

const REACTION_CONFIG = [
  { type: "like", icon: ThumbsUp, label: "Like", activeClass: "text-primary" },
  { type: "love", icon: Heart, label: "Love", activeClass: "text-destructive" },
];

const ImageEngagement = ({ imageType, imageId, photoIndex = 0, compact }: Props) => {
  const { user } = useAuth();
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  const [comments, setComments] = useState<Comment[]>([]);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [posting, setPosting] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [commentCount, setCommentCount] = useState(0);

  const fetchReactions = useCallback(async () => {
    const { data } = await supabase
      .from("image_reactions")
      .select("reaction_type, user_id")
      .eq("image_type", imageType)
      .eq("image_id", imageId)
      .eq("photo_index", photoIndex);

    const map: Record<string, Reaction> = {};
    for (const r of REACTION_CONFIG) {
      const matching = data?.filter(d => d.reaction_type === r.type) || [];
      map[r.type] = {
        type: r.type,
        count: matching.length,
        userReacted: user ? matching.some(d => d.user_id === user.id) : false,
      };
    }
    setReactions(map);
  }, [imageType, imageId, photoIndex, user]);

  const fetchComments = useCallback(async () => {
    const { data } = await supabase
      .from("image_comments")
      .select("id, user_id, content, parent_id, created_at, is_pinned, is_admin_seed")
      .eq("image_type", imageType)
      .eq("image_id", imageId)
      .eq("photo_index", photoIndex)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: true });

    if (!data || data.length === 0) {
      setComments([]);
      setCommentCount(0);
      return;
    }

    const userIds = [...new Set(data.map(c => c.user_id))];
    const [profileMap, adminIds] = await Promise.all([
      fetchProfileMap(userIds),
      getAdminIds(),
    ]);

    const withProfiles = data.map(c => ({
      ...c,
      profile_name: resolveName(c.user_id, profileMap.get(c.user_id)?.full_name ?? null, adminIds),
      avatar_url: profileMap.get(c.user_id)?.avatar_url || null,
      badges: resolveBadges(c.user_id, profileMap.get(c.user_id)?.badges || [], adminIds),
    }));

    // Build thread tree
    const rootComments: Comment[] = [];
    const replyMap = new Map<string, Comment[]>();
    for (const c of withProfiles) {
      if (c.parent_id) {
        if (!replyMap.has(c.parent_id)) replyMap.set(c.parent_id, []);
        replyMap.get(c.parent_id)!.push(c);
      } else {
        rootComments.push(c);
      }
    }
    for (const root of rootComments) {
      root.replies = replyMap.get(root.id) || [];
    }

    setComments(rootComments);
    setCommentCount(data.length);
  }, [imageType, imageId, photoIndex]);

  useEffect(() => {
    fetchReactions();
    fetchComments();
  }, [fetchReactions, fetchComments]);

  const toggleReaction = async (type: string) => {
    if (!user) { toast({ title: "Please login to react" }); return; }
    const current = reactions[type];
    if (current?.userReacted) {
      await supabase.from("image_reactions")
        .delete()
        .eq("user_id", user.id)
        .eq("image_type", imageType)
        .eq("image_id", imageId)
        .eq("photo_index", photoIndex)
        .eq("reaction_type", type);
    } else {
      await supabase.from("image_reactions").insert({
        user_id: user.id,
        image_type: imageType,
        image_id: imageId,
        photo_index: photoIndex,
        reaction_type: type,
      });
    }
    // Optimistic
    setReactions(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        count: current?.userReacted ? prev[type].count - 1 : prev[type].count + 1,
        userReacted: !current?.userReacted,
      },
    }));
  };

  const submitComment = async (content: string, parentId: string | null = null) => {
    if (!user) { toast({ title: "Please login to comment" }); return; }
    const trimmed = content.trim();
    if (!trimmed) return;

    // Client-side moderation
    const modResult = moderateComment(trimmed);
    if (!modResult.allowed) {
      toast({ title: "Comment blocked", description: modResult.reason, variant: "destructive" });
      return;
    }

    setPosting(true);
    const { data: inserted, error } = await supabase.from("image_comments").insert({
      user_id: user.id,
      image_type: imageType,
      image_id: imageId,
      photo_index: photoIndex,
      parent_id: parentId,
      content: trimmed,
    }).select("id").single();

    if (error) {
      toast({ title: "Failed to post comment", description: error.message, variant: "destructive" });
    } else {
      setNewComment("");
      setReplyText("");
      setReplyTo(null);
      fetchComments();

      // Trigger AI moderation in background (non-blocking)
      if (inserted?.id) {
        supabase.functions.invoke("moderate-comment", {
          body: { comment_id: inserted.id, content: trimmed },
        }).catch(() => {});
      }
    }
    setPosting(false);
  };

  const reportComment = async (commentId: string) => {
    if (!user) return;
    if (!reportReason.trim()) {
      toast({ title: "Please select a reason", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("comment_reports").insert({
      comment_id: commentId,
      reporter_id: user.id,
      reason: reportReason,
    });
    if (error) {
      toast({ title: "Report failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Report submitted", description: "Admin will review this comment." });
    }
    setReportingId(null);
    setReportReason("");
  };

  const deleteComment = async (commentId: string) => {
    const { error } = await supabase.from("image_comments").delete().eq("id", commentId);
    if (!error) {
      toast({ title: "Comment deleted" });
      fetchComments();
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d`;
    return new Date(dateStr).toLocaleDateString();
  };

  const renderComment = (comment: Comment, isReply = false) => (
    <div key={comment.id} className={`${isReply ? "ml-6 border-l border-border/50 pl-3" : ""} ${comment.is_pinned ? "bg-primary/5 rounded-sm p-1.5 -mx-1.5" : ""}`}>
      <div className="group flex gap-2 py-2">
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 text-[9px] font-medium text-muted-foreground uppercase">
          {comment.avatar_url ? (
            <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={comment.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
          ) : (
            comment.profile_name?.[0] || "?"
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <UserIdentityBlock
              userId={comment.user_id}
              name={comment.profile_name}
              linkTo={`/profile/${comment.user_id}`}
              nameClassName="text-[10px] font-medium hover:text-primary hover:underline transition-colors"
            />
            <span className="text-[9px] text-muted-foreground">{timeAgo(comment.created_at)}</span>
            {comment.is_pinned && <span className="text-[8px] text-primary">ð</span>}
            {comment.is_admin_seed && <span className="text-[8px] text-primary/70">â</span>}
          </div>
          <p className="text-xs text-foreground/90 mt-0.5 break-words" style={{ fontFamily: "var(--font-body)" }}>
            <RichContentRenderer content={comment.content} />
          </p>
          <div className="flex items-center gap-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {user && !isReply && (
              <button onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                className="text-[9px] text-muted-foreground hover:text-primary transition-colors">
                Reply
              </button>
            )}
            {user && comment.user_id !== user.id && (
              <button onClick={() => setReportingId(comment.id)}
                className="text-[9px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5">
                <Flag className="h-2.5 w-2.5" /> Report
              </button>
            )}
            {user && comment.user_id === user.id && (
              <button onClick={() => deleteComment(comment.id)}
                className="text-[9px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5">
                <Trash2 className="h-2.5 w-2.5" /> Delete
              </button>
            )}
          </div>

          {/* Report Modal */}
          {reportingId === comment.id && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2 p-2 border border-border rounded-sm space-y-2">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider" style={{ fontFamily: "var(--font-heading)" }}>Report reason</span>
              <div className="flex flex-wrap gap-1.5">
                {["Inappropriate", "Spam", "Harassment", "Nudity", "Hate Speech"].map(r => (
                  <button key={r} onClick={() => setReportReason(r)}
                    className={`text-[9px] px-2 py-1 border rounded-sm transition-all ${reportReason === r ? "border-destructive text-destructive bg-destructive/5" : "border-border text-muted-foreground"}`}>
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => reportComment(comment.id)}
                  className="text-[9px] px-3 py-1 bg-destructive text-destructive-foreground rounded-sm hover:opacity-90">
                  Submit Report
                </button>
                <button onClick={() => { setReportingId(null); setReportReason(""); }}
                  className="text-[9px] px-3 py-1 border border-border rounded-sm text-muted-foreground">
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {/* Reply Input */}
          {replyTo === comment.id && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2 flex gap-2">
              <MentionInput
                value={replyText}
                onChange={setReplyText}
                onSubmit={() => submitComment(replyText, comment.id)}
                placeholder="Write a replyâ¦"
                disabled={posting}
                className="bg-transparent border-b border-border focus:border-primary rounded-none px-0 text-xs"
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* Replies */}
      {comment.replies?.map(reply => renderComment(reply, true))}
    </div>
  );

  return (
    <div className="w-full">
      {/* Reactions Bar */}
      <div className="flex items-center gap-1 flex-wrap">
        {REACTION_CONFIG.map(({ type, icon: Icon, label, activeClass }) => {
          const r = reactions[type];
          return (
            <button
              key={type}
              onClick={() => toggleReaction(type)}
              className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-sm transition-all duration-200 ${
                r?.userReacted
                  ? `${activeClass} bg-muted/50`
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
              title={label}
            >
              <Icon className={`h-3 w-3 ${r?.userReacted ? "fill-current" : ""}`} />
              {(r?.count || 0) > 0 && <span>{r?.count}</span>}
            </button>
          );
        })}
        <button
          onClick={() => setShowComments(!showComments)}
          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-sm transition-all duration-200 ${
            showComments ? "text-primary bg-muted/50" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <MessageCircle className="h-3 w-3" />
          <span>{commentCount > 0 ? commentCount : 0} Comments</span>
          {showComments ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        </button>
      </div>

      {/* Comments Section */}
      <AnimatePresence>
        {showComments && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 overflow-hidden"
          >
            {/* New Comment Input */}
            {user ? (
              <div className="flex gap-2 mb-3">
                <MentionInput
                  value={newComment}
                  onChange={setNewComment}
                  onSubmit={() => submitComment(newComment)}
                  placeholder="Add a commentâ¦"
                  disabled={posting}
                  maxLength={2200}
                  className="bg-transparent border-b border-border focus:border-primary rounded-none px-0 text-xs"
                />
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground mb-3 italic">Login to comment</p>
            )}

            {/* Comments List */}
            <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
              {comments.length === 0 ? (
                <p className="text-[10px] text-muted-foreground py-2">No comments yet. Be the first!</p>
              ) : (
                comments.map(c => renderComment(c))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ImageEngagement;
