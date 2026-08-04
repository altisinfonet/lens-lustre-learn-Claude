import { useMemo, useState } from "react";
import { publicUrl } from "@/lib/publicUrl";
import { Link } from "react-router-dom";
import { MessageCircle, Share2, Copy, MoreHorizontal, Trash2, Flag, Heart, Repeat, Eye, Pencil, UserPlus, Users } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { isActiveNow } from "@/hooks/core/useLastActive";
import { REACTION_EMOJI_MAP, type ReactionType } from "@/components/ReactionPicker";
import ReactionPicker from "@/components/ReactionPicker";
import ReactionSummaryTooltip from "@/components/ReactionSummaryTooltip";
import ShareSummaryTooltip from "@/components/ShareSummaryTooltip";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import PostMedia from "@/components/post/PostMedia";
import Caption from "@/components/post/Caption";
import PostCommentsSection from "@/components/PostCommentsSection";
import { timeAgo, privacyIcon } from "@/lib/postUtils";
import { formatNumber } from "@/lib/postAnalytics";
import { displayEngagement, formatEngagementCount } from "@/lib/displayEngagement";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { UnifiedPost } from "@/types/post";
import { useT } from "@/i18n/I18nContext";
import { useSendFriendRequest } from "@/hooks/social/useFriendshipMutations";

const displayFont = { fontFamily: "var(--font-display)" };
const headingFont = { fontFamily: "var(--font-heading)" };

interface PostCardProps {
  post: UnifiedPost;
  currentUserId: string | undefined;
  onReact: (postId: string, type: ReactionType) => void;
  onUnreact: (postId: string) => void;
  onDelete?: (postId: string) => void;
  /**
   * Provided ONLY by the wall, and only when the viewer is looking at their own
   * wall at a post they reshared. Its presence is what turns on "Remove from my
   * wall". A mis-tapped share used to be permanent: the post belongs to someone
   * else, so the menu offered nothing but "Report content".
   */
  onRemoveShare?: (postId: string) => void;
  onShareToWall?: (post: UnifiedPost) => void;
  /** Callback for optimistic comment count updates */
  onCommentCountChange?: (postId: string, delta: number) => void;
  /** Callback for optimistic share count updates */
  onShareCountChange?: (postId: string, delta: number) => void;
  /** Callback for optimistic caption updates after edit */
  onContentChange?: (postId: string, newContent: string) => void;
}

const PostCard = ({
  post,
  currentUserId,
  onReact,
  onUnreact,
  onDelete,
  onRemoveShare,
  onShareToWall,
  onCommentCountChange,
  onShareCountChange,
  onContentChange,
}: PostCardProps) => {
  const t = useT();
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [reportingOpen, setReportingOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.content || "");
  const [savingEdit, setSavingEdit] = useState(false);
  // Add-friend from suggested posts (sends request + auto-follows)
  const sendFriend = useSendFriendRequest();
  const [friendRequested, setFriendRequested] = useState(false);

  // Reach / Viewed-by.
  //
  // The dependency list is EXACTLY [id, created_at] and must stay that way.
  // It used to include like_count and comment_count, which meant tapping Like
  // recomputed the figures in the same frame — the number moved because of a
  // button the member had just pressed, and moved back DOWN when they un-liked.
  // Owner report with screenshots, 2026-08-04. See src/lib/displayEngagement.ts.
  //
  // NULL for the first 24 hours after posting — the whole line is then absent.
  const stats = useMemo(
    () => displayEngagement({ id: post.id, createdAt: post.created_at }),
    [post.id, post.created_at],
  );

  const handleSaveCaption = async () => {
    if (!currentUserId || savingEdit) return;
    const trimmed = editDraft.trim();
    if (trimmed === (post.content || "").trim()) {
      setIsEditing(false);
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from("posts")
      .update({ content: trimmed })
      .eq("id", post.id);
    setSavingEdit(false);
    if (error) {
      toast({ title: "Failed to update caption", description: error.message, variant: "destructive" });
      return;
    }
    onContentChange?.(post.id, trimmed);
    setIsEditing(false);
    toast({ title: "Caption updated" });
  };

  const imageUrls = post.image_urls.length > 0 ? post.image_urls : post.image_url ? [post.image_url] : [];

  const handleDelete = async () => {
    if (!currentUserId) return;
    setActionLoading(true);
    onDelete?.(post.id);
    setActionLoading(false);
  };

  const handleReport = async () => {
    if (!currentUserId || !reportReason) return;
    setActionLoading(true);
    const { error } = await supabase
      .from("post_reports")
      .insert({ post_id: post.id, reporter_id: currentUserId, reason: reportReason });
    if (error) {
      if (error.code === "23505") toast({ title: "You have already reported this post" });
      else toast({ title: "Failed to submit report", variant: "destructive" });
    } else {
      toast({ title: "Report submitted" });
    }
    setReportingOpen(false);
    setReportReason("");
    setActionLoading(false);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl(`/post/${post.id}`));
    toast({ title: "Link copied to clipboard!" });
  };

  const shareToWall = async () => {
    if (onShareToWall) {
      onShareToWall(post);
    } else if (currentUserId) {
      // Only record the share reference — do NOT duplicate the post
      const { error } = await supabase.from("post_shares" as any).upsert(
        { post_id: post.id, user_id: currentUserId } as any,
        { onConflict: "post_id,user_id" }
      );
      if (!error) {
        onShareCountChange?.(post.id, 1);
        toast({ title: "Shared to your wall!" });
      } else {
        if ((error as any).code === "23505") {
          toast({ title: "You already shared this post" });
        } else {
          toast({ title: "Failed to share", variant: "destructive" });
        }
      }
    }
  };

  return (
    <div className="border border-border mb-2 md:mb-4 rounded-xl md:rounded-none overflow-hidden">
      {/* ── Header ── */}
      {/* Header. `pb-2` is load-bearing: it is the ONLY thing standing between
          the header and the media on a post with no caption. Until 2026-08-01
          this was `pb-0` and the gap came entirely from Caption's `py-2`, so a
          caption-less post — every Suggested post, most reshares — had its photo
          jammed against the name. Any change here must keep the header-to-media
          gap identical whether or not a caption exists. */}
      <div className="flex items-center gap-2.5 p-3 pb-2">
        <Link to={`/profile/${post.user_id}`} className="shrink-0">
          <span className="relative inline-block w-8 h-8">
            {post.author_avatar ? (
              <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={post.author_avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xs text-primary" style={displayFont}>{(post.author_name || "?")[0]?.toUpperCase()}</span>
              </div>
            )}
            {isActiveNow(post.author_last_active) && (
              <span aria-label="Online" title="Online" className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-card" />
            )}
          </span>
        </Link>
        <div className="flex-1 min-w-0">
          <UserIdentityBlock
            userId={post.user_id}
            name={post.author_name || "Photographer"}
            linkTo={`/profile/${post.user_id}`}
            nameClassName="text-sm font-light hover:text-primary transition-colors truncate [font-family:var(--font-heading)]"
          />
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground" style={headingFont}>
            <span>{timeAgo(post.created_at)}</span>
            <span className="inline-flex items-center gap-1">{privacyIcon(post.privacy)}</span>
            {post.is_suggested && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground text-[8px] tracking-[0.1em] uppercase font-medium">
                Suggested
              </span>
            )}
          </div>
        </div>
        {/*
          Only offer "Add friend" when NO friendship row exists in either
          direction. `is_suggested` alone was not enough: someone you had
          already sent a request to (or who had requested you) is still
          "suggested" until accepted, so tapping inserted a duplicate row and
          the raw Postgres unique-constraint error was shown to the user
          (owner report 2026-07-31).
        */}
        {/*
          Strict equality on purpose: if friend_state is UNDEFINED we do not
          know the relationship (e.g. a post inserted live by realtime, or a
          post restored from the localStorage feed cache written before this
          field existed). Unknown must mean "don't offer the action" — treating
          it as "none" is what let the duplicate-key error through.
        */}
        {currentUserId && post.is_suggested && currentUserId !== post.user_id
          && post.friend_state === "none" && (
          <button
            onClick={() => {
              if (friendRequested || sendFriend.isPending) return;
              sendFriend.mutate(post.user_id, { onSuccess: () => setFriendRequested(true) });
            }}
            disabled={friendRequested || sendFriend.isPending}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-primary/40 text-primary text-[9px] tracking-[0.1em] uppercase hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-60"
            style={headingFont}
          >
            <UserPlus className="h-3 w-3" /> {friendRequested ? "Requested" : "Add friend"}
          </button>
        )}
        {currentUserId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 rounded-full text-muted-foreground hover:bg-muted/50 transition-colors">
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              {currentUserId === post.user_id ? (
                <>
                  <DropdownMenuItem
                    onClick={() => { setEditDraft(post.content || ""); setIsEditing(true); }}
                    className="py-2.5"
                  >
                    <Pencil className="h-4 w-4 mr-2.5" /> Edit caption
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} disabled={actionLoading} className="text-destructive focus:text-destructive py-2.5">
                    <Trash2 className="h-4 w-4 mr-2.5" /> Move to trash
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  {onRemoveShare && post.is_reshare && (
                    <DropdownMenuItem
                      onClick={() => onRemoveShare(post.id)}
                      className="text-destructive focus:text-destructive py-2.5"
                    >
                      <Trash2 className="h-4 w-4 mr-2.5" /> Remove from my wall
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => { setReportingOpen(true); setReportReason(""); }} className="py-2.5">
                    <Flag className="h-4 w-4 mr-2.5" /> Report content
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* ── Report Panel ── */}
      {reportingOpen && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          className="mx-3 mb-2 p-3 border border-border rounded-lg space-y-2.5 bg-muted/20">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold" style={headingFont}>Why are you reporting this post?</span>
          <div className="flex flex-wrap gap-1.5">
            {["Inappropriate", "Spam", "Harassment", "Nudity", "Hate Speech", "False Information", "Violence"].map((r) => (
              <button key={r} onClick={() => setReportReason(r)}
                className={`text-[10px] px-2.5 py-1.5 border rounded-md transition-all ${reportReason === r ? "border-destructive text-destructive bg-destructive/5 font-medium" : "border-border text-muted-foreground hover:border-muted-foreground/50"}`}>
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleReport} disabled={!reportReason || actionLoading}
              className="text-[10px] px-4 py-1.5 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50 transition-all uppercase tracking-wider font-medium" style={headingFont}>
              Submit Report
            </button>
            <button onClick={() => { setReportingOpen(false); setReportReason(""); }}
              className="text-[10px] px-4 py-1.5 border border-border rounded-md text-muted-foreground hover:border-foreground/40 transition-all uppercase tracking-wider" style={headingFont}>
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* ── Caption ── */}
      {isEditing ? (
        <div className="px-3 pb-2 space-y-2">
          <Textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            placeholder="Write a caption..."
            className="text-[13px] min-h-[80px] resize-none"
            autoFocus
          />
          {/* No running counter (owner, 2026-08-04: "Don't show it anywhere").
              The line appears ONLY over the limit, where Save is disabled and
              silence would leave a dead button unexplained. */}
          {editDraft.length > 2200 && (
            <div className="text-[10px] text-right tabular-nums text-destructive font-semibold">
              {editDraft.length - 2200} over the 2200 limit — shorten to save
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setIsEditing(false); setEditDraft(post.content || ""); }}
              disabled={savingEdit}
              className="text-[11px] px-3 py-1.5 border border-border rounded-md text-muted-foreground hover:border-foreground/40 transition-all uppercase tracking-wider disabled:opacity-50"
              style={headingFont}
            >
              Cancel
            </button>
            <button
              onClick={handleSaveCaption}
              disabled={savingEdit || editDraft.length > 2200}
              className="text-[11px] px-4 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-wider font-medium"
              style={headingFont}
            >
              {savingEdit ? "Saving..." : editDraft.length > 2200 ? `Trim ${editDraft.length - 2200}` : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <Caption content={post.content} />
      )}

      {/* ── Media ── */}
      {imageUrls.length > 0 && (
        <div className="px-0">
          <PostMedia
            urls={imageUrls}
            onDoubleTapLike={() => {
              if (currentUserId && !post.user_reaction) onReact(post.id, "like");
            }}
          />
        </div>
      )}

      {/* ── Reactions Row ──
          Reach / Viewed-by share this line, pushed to the right edge with
          `ml-auto` (owner instruction 2026-08-01). They were a second row until
          then, which cost a whole line of card height for two small numbers. */}
      <div className="flex items-center gap-4 px-3 py-1.5 text-sm text-muted-foreground" style={headingFont}>
        {post.like_count > 0 && (
          <ReactionSummaryTooltip reactionCounts={post.reaction_counts} totalCount={post.like_count} postId={post.id}>
            <span className="inline-flex items-center gap-1 cursor-pointer">
              {post.top_reactions.length > 0 ? (
                post.top_reactions.map((type) => (
                  <span key={type} className="text-base">{REACTION_EMOJI_MAP[type] || "👍"}</span>
                ))
              ) : (
                <Heart className="h-4 w-4 text-rose-500" />
              )}
              <span className="text-sm font-semibold">{formatNumber(post.like_count)}</span>
            </span>
          </ReactionSummaryTooltip>
        )}
        {post.comment_count > 0 && (
          <button onClick={() => setCommentsExpanded(!commentsExpanded)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <MessageCircle className="h-4 w-4" />
            <span className="text-sm font-semibold">{formatNumber(post.comment_count)}</span>
          </button>
        )}
        {post.share_count > 0 && (
          <ShareSummaryTooltip shareCount={post.share_count} postId={post.id}>
            <span className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              <Repeat className="h-4 w-4" />
              <span className="text-sm font-semibold">{formatNumber(post.share_count)}</span>
            </span>
          </ShareSummaryTooltip>
        )}

        {/* Reach and Viewed-by. DISPLAY figures from `displayEngagement`, not
            measurements. The real distinct-viewer count (`post.views`, from
            get_post_view_counts) is still collected and still on the object — it
            is simply not what this renders. Everything about why, and the four
            properties that keep the pair internally consistent, is documented in
            src/lib/displayEngagement.ts. Every other number here is real.
            `ml-auto` is what holds it against the right edge even when the post
            has no reactions, comments or shares at all.
            `stats` is null for the first 24 hours after posting — the line is
            then absent entirely, which is the owner's rule. */}
        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="ml-auto flex items-center gap-3 text-xs whitespace-nowrap"
          >
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span className="font-medium text-foreground/80">{formatEngagementCount(stats.reach)}</span>
              <span>reached</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3" />
              <span className="font-medium text-foreground/80">{formatEngagementCount(stats.views)}</span>
              <span>viewed</span>
            </span>
          </motion.div>
        )}
      </div>

      {/* ── Action Bar ── */}
      <div className="mx-2.5 border-t border-border select-none">
        <div className="flex justify-start md:justify-stretch gap-1 md:gap-0">
          <ReactionPicker
            currentReaction={post.user_reaction}
            onReact={(type) => onReact(post.id, type)}
            onUnreact={() => onUnreact(post.id)}
            disabled={!currentUserId}
          />
          <button onClick={() => setCommentsExpanded(!commentsExpanded)}
            className="md:flex-1 flex items-center justify-center md:gap-2 py-2 px-3 md:px-0 rounded-md my-1 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation">
            <MessageCircle className="h-5 w-5" /> <span className="hidden md:inline">{t("post.comment")}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="md:flex-1 flex items-center justify-center md:gap-2 py-2 px-3 md:px-0 rounded-md my-1 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation">
                <Share2 className="h-5 w-5" /> <span className="hidden md:inline">{t("post.share")}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={shareToWall} className="py-2.5 cursor-pointer">
                <Share2 className="h-4 w-4 mr-2.5" /> Share to your wall
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyLink} className="py-2.5 cursor-pointer">
                <Copy className="h-4 w-4 mr-2.5" /> Copy link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Comments ── */}
      <AnimatePresence>
        {commentsExpanded && (
          <PostCommentsSection
            postId={post.id}
            postOwnerId={post.user_id}
            expanded={commentsExpanded}
            onCommentCountChange={(delta) => onCommentCountChange?.(post.id, delta)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default PostCard;
