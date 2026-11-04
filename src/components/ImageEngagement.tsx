/**
 * Likes and comments on one PHOTOGRAPH (competition lightbox, entry card, entry
 * page, photo viewer).
 *
 * The comments are a DATA ADAPTER, NOT A THIRD COMMENT LIST (central-control
 * plan C2, 4 Nov 2026). This file used to draw its own row, with its own raw
 * avatar, indent and tap sizes, next to the one every other surface shares
 * (src/components/comments/CommentThread.tsx). It now keeps only what is really
 * different about `image_comments`: scoped to one photo of an entity, no
 * per-comment likes, one level of replies, and no editing, because this table's
 * moderation (blocklist trigger, moderate-comment) runs on INSERT only.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Heart, ThumbsUp, MessageCircle, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { useAuth } from "@/hooks/core/useAuth";
import { useProfileCore } from "@/hooks/profile/useProfileData";
import { toast } from "@/hooks/core/use-toast";
import { moderateComment } from "@/lib/commentModeration";
import { motion, AnimatePresence } from "framer-motion";
import CommentThread from "@/components/comments/CommentThread";
import CommentComposer from "@/components/comments/CommentComposer";
import { toThread, type ImageComment } from "@/components/comments/imageCommentThread";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { convertEmojiShortcuts } from "@/lib/emoji";

interface Props {
  imageType: "portfolio" | "competition_entry";
  imageId: string;
  /** Per-photo scoping. Defaults to 0 when omitted (single-photo entities). */
  photoIndex?: number;
  compact?: boolean;
  /** The surface around this already scrolls (the lightbox panel), so the thread takes its full height. */
  panelScrolls?: boolean;
}

interface Reaction {
  type: string;
  count: number;
  userReacted: boolean;
}

const REACTION_CONFIG = [
  { type: "like", icon: ThumbsUp, label: "Like", activeClass: "text-primary" },
  { type: "love", icon: Heart, label: "Love", activeClass: "text-destructive" },
];

const ImageEngagement = ({ imageType, imageId, photoIndex = 0, panelScrolls = false }: Props) => {
  const { user } = useAuth();
  const { data: viewer } = useProfileCore(user?.id);
  const [reactions, setReactions] = useState<Record<string, Reaction>>({});
  const [comments, setComments] = useState<ImageComment[]>([]);
  const threadComments = useMemo(() => comments.map(toThread), [comments]);
  const [showComments, setShowComments] = useState(false);
  /** `true` while the comments panel's height animation is moving. The clip on
   *  that panel is bound to it, so it stops clipping the @mention list once the
   *  panel has arrived — see the note on the box, and the longer one in
   *  PostCommentsSection.tsx. */
  const [commentsRolling, setCommentsRolling] = useState(true);
  const [posting, setPosting] = useState(false);
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
      author_handle: profileMap.get(c.user_id)?.custom_url ?? null,
      badges: resolveBadges(c.user_id, profileMap.get(c.user_id)?.badges || [], adminIds),
    }));

    // Build thread tree
    const rootComments: ImageComment[] = [];
    const replyMap = new Map<string, ImageComment[]>();
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

  /** true when the comment was saved, so the composer knows to clear. */
  const submitComment = async (content: string, parentId: string | null = null): Promise<boolean> => {
    if (!user) { toast({ title: "Please login to comment" }); return false; }
    // Trailing emoji shortcut (`... <3` with nothing after it) — the case the
    // typing-time conversion in MentionInput cannot see. See src/lib/emoji.ts.
    const trimmed = convertEmojiShortcuts(content.trim());
    if (!trimmed) return false;

    // Client-side moderation
    const modResult = moderateComment(trimmed);
    if (!modResult.allowed) {
      toast({ title: "Comment blocked", description: modResult.reason, variant: "destructive" });
      return false;
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
      fetchComments();

      // Trigger AI moderation in background (non-blocking)
      if (inserted?.id) {
        supabase.functions.invoke("moderate-comment", {
          body: { comment_id: inserted.id, content: trimmed },
        }).catch(() => {});
      }
    }
    setPosting(false);
    return !error;
  };

  const reportComment = async (commentId: string, reason: string) => {
    if (!user) return;
    const { error } = await supabase.from("comment_reports").insert({
      comment_id: commentId,
      reporter_id: user.id,
      reason,
    });
    if (error) {
      toast({ title: "Report failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Report submitted", description: "Admin will review this comment." });
    }
  };

  const deleteComment = async (commentId: string) => {
    const { error } = await supabase.from("image_comments").delete().eq("id", commentId);
    if (!error) {
      toast({ title: "Comment deleted" });
      fetchComments();
    }
  };

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
            /*
             * THE SAME CLIP, ONE SCREEN OVER — see the long note in
             * PostCommentsSection.tsx. This box holds the same MentionInput,
             * and here the composer sits at the TOP of the section, so an
             * upward-opening @mention list crosses this edge immediately
             * rather than eventually. Fixed together with the feed's, because
             * fixing only the surface that was reported is how the last sweep
             * missed the sidebar.
             */
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            onAnimationStart={() => setCommentsRolling(true)}
            onAnimationComplete={() => setCommentsRolling(false)}
            className={`mt-2 ${commentsRolling ? "overflow-hidden" : ""}`}
          >
            {/* New Comment Input: the one shared composer */}
            {user ? (
              <div className="mb-3">
                <CommentComposer
                  currentUserId={user.id}
                  viewer={viewer ?? null}
                  submitting={posting}
                  maxLength={2200}
                  onSubmit={(content) => submitComment(content)}
                />
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground mb-3 italic">Login to comment</p>
            )}

            {/* Comments List: the one shared thread. -mx-3 takes back its own side padding. */}
            {comments.length === 0 ? (
              <p className="text-[10px] text-muted-foreground py-2">No comments yet. Be the first!</p>
            ) : (
              <div className={panelScrolls ? "-mx-3" : "-mx-3 max-h-64 overflow-y-auto"}>
                <CommentThread
                  comments={threadComments}
                  loading={false}
                  currentUserId={user?.id ?? null}
                  viewer={viewer ?? null}
                  isAdmin={false}
                  submitting={posting}
                  maxLength={2200}
                  maxReplyDepth={1}
                  hideComposer
                  features={{ reactions: false, pinning: false, reporting: true, sorting: false, editing: false }}
                  onAdd={(content, parentId) => submitComment(content, parentId)}
                  onEdit={async () => false}
                  onDelete={deleteComment}
                  onReport={reportComment}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ImageEngagement;
