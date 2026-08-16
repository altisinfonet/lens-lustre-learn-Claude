import { useMemo, useState } from "react";
import { publicUrl } from "@/lib/publicUrl";
import { Link } from "react-router-dom";
import { MessageCircle, Share2, Send, Copy, MoreHorizontal, Trash2, Flag, Eye, Pencil, UserPlus, UserCheck, UserMinus, Users } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { isActiveNow } from "@/hooks/core/useLastActive";
import { REACTIONS, type ReactionType } from "@/components/ReactionPicker";
import ReactionPicker from "@/components/ReactionPicker";
import ReactionSummaryTooltip from "@/components/ReactionSummaryTooltip";
import ShareSummaryTooltip from "@/components/ShareSummaryTooltip";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import ContributorScore from "@/components/ContributorScore";
import TaggedPeople from "@/components/post/TaggedPeople";
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
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { avatarInitial } from "@/lib/displayName";

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
  const queryClient = useQueryClient();
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
  /**
   * Whether the reach/views chip over the photograph is showing.
   *
   * Touch only. On a pointer device `group-hover/media` handles it in CSS and
   * this stays false for ever — a hover state must not be something React has
   * to re-render for, sixty times a second, on every card in a feed.
   */
  const [statsRevealed, setStatsRevealed] = useState(false);

  /**
   * Which reactions this post actually received, biggest first, with the
   * emoji the picker uses so the row and the picker can never disagree.
   * Capped at four: a 360px row has to hold the three action controls too.
   */
  const breakdown = useMemo(
    () =>
      Object.entries(post.reaction_counts ?? {})
        .filter(([, n]) => (n ?? 0) > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([type, count]) => ({
          type,
          count,
          emoji: REACTIONS.find((r) => r.type === type)?.emoji ?? "👍",
        })),
    [post.reaction_counts],
  );

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

  /**
   * Is the person looking at this post tagged in it? Drives the Remove control.
   * Signed-out visitors have no id, so `currentUserId &&` is load-bearing —
   * without it an undefined id could match an undefined tag id.
   */
  const viewerIsTagged = Boolean(
    currentUserId && (post.tagged_people ?? []).some((t) => t.id === currentUserId),
  );

  const imageUrls = post.image_urls.length > 0 ? post.image_urls : post.image_url ? [post.image_url] : [];
  // Stored thumbnails ride along ONLY when they align one-to-one with the
  // images. A mismatched array (single-image fallback path, partial uploads)
  // must not put photo 1's thumbnail under photo 2 — no thumbs is merely
  // heavier, wrong thumbs is wrong.
  const thumbUrls =
    post.thumbnail_urls && post.thumbnail_urls.length === imageUrls.length
      ? post.thumbnail_urls
      : undefined;

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

  /**
   * REMOVE MY OWN TAG — available to the tagged member at ANY time.
   *
   * Owner ruling, 2026-08-10: "Show immediately to public, but tagged person
   * only can remove my Tag anytime." Making a pending tag public without this
   * control would have been the harmful half of that sentence on its own:
   * anyone may tag anyone (shipped the same day), so a member could have had
   * their name on a stranger's photo with no way to take it off. Accept/Decline
   * on the bell notification only ever worked while the tag was still pending
   * and only until the notification was dismissed.
   *
   * The database already allowed this and nothing here weakens it: the policy
   * "Tagged user updates tag status" is USING (auth.uid() = tagged_user_id)
   * with NO status condition, and validate_post_tag_update() refuses to let any
   * column but `status`/`responded_at` change and refuses the update outright
   * unless auth.uid() is the tagged user. So this can only ever remove YOUR OWN
   * tag, on any status, and cannot touch the post or anybody else's tag.
   */
  const removeMyTag = async () => {
    if (!currentUserId || actionLoading) return;
    setActionLoading(true);
    const { data, error } = await supabase
      .from("post_tags")
      .update({ status: "removed" })
      .eq("post_id", post.id)
      .eq("tagged_user_id", currentUserId)
      .select("id");
    setActionLoading(false);
    if (error) {
      toast({ title: "Couldn't remove the tag", description: error.message, variant: "destructive" });
      return;
    }
    // A write that succeeds but changes ZERO rows is the signature of an RLS
    // refusal, and it would otherwise look like success while the name stayed
    // on the photo. Say so instead of lying.
    if (!data || data.length === 0) {
      toast({
        title: "Tag not removed",
        description: "The tag could not be found, or it is not yours to remove.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Tag removed", description: "Your name no longer appears on this post." });
    // Both surfaces read tags, so both have to be refreshed.
    queryClient.invalidateQueries({ queryKey: queryKeys.feedAll() });
    queryClient.invalidateQueries({ queryKey: ["user-wall-posts"] });
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

  // NO BORDER AT ALL. NOT EVEN BETWEEN POSTS.
  //
  // Owner, 2026-08-10, twice. First: "I told No border anything to anywhere,
  // example like Instagram, didnt do it it" — which removed `md:border` and the
  // desktop card. Then, looking at the result: "between two posts there is
  // line, but instagram has no border, why kept ??"
  //
  // So the separating hairline is gone too. It was kept on the argument that
  // without it consecutive photos touch and read as one image; that is not what
  // happens, because the NEXT post opens with its header at `p-3`, which puts
  // 12px of clear space and a name between one photograph and the next. This
  // component now draws no border on any edge, at any screen size.
  //
  // If a separator is ever wanted back it belongs BETWEEN cards, in the list
  // that renders them — not as a bottom border on the card, which also drew a
  // line under the very last post in the feed.
  return (
    <div className="bleed-phone mb-4 overflow-hidden">
      {/* ── Header ── */}
      {/* Header. `pb-2` is load-bearing: it is the ONLY thing standing between
          the header and the media on a post with no caption. Until 2026-08-01
          this was `pb-0` and the gap came entirely from Caption's `py-2`, so a
          caption-less post — every Suggested post, most reshares — had its photo
          jammed against the name. Any change here must keep the header-to-media
          gap identical whether or not a caption exists. */}
      <div className="flex items-center gap-2.5 p-3 pb-2">
        {/* THE AVATAR IS 32px BY DESIGN; THE TAP TARGET IS 44px.
            Reported by the sweep at 32x37 on the feed and on post detail. The
            photo itself must stay 32px — it is the Instagram proportion the
            whole card is built around, and growing it would push the name and
            the menu button out of line on a 360px phone.
            `p-1.5 -m-1.5` makes the ANCHOR 44x44 (32 + 6 + 6) and pulls the
            padding back out of the flow, so nothing moves by a pixel. This is
            a real enlargement of a real element, not an invisible hit area
            behind an unchanged one — the anchor's own box is what grows, which
            is why the checker can see it. `-ml-1.5` is absorbed by the row's
            `gap-2.5`, so the avatar sits exactly where it did. */}
        <Link to={`/profile/${post.user_id}`} className="shrink-0 grid place-items-center p-1.5 -m-1.5">
          <span className="relative inline-block w-8 h-8">
            {post.author_avatar ? (
              <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={post.author_avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xs text-primary" style={displayFont}>{avatarInitial(post.author_name)}</span>
              </div>
            )}
            {isActiveNow(post.author_last_active) && (
              <span aria-label="Online" title="Online" className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-card" />
            )}
          </span>
        </Link>
        <div className="flex-1 min-w-0">
          {/* Name, then "with <tagged people>" on the same line — the Instagram
              shape the owner asked for on 2026-08-10. `flex-wrap` lets the tag
              phrase drop to a second line on a narrow phone instead of pushing
              the name into an ellipsis; UserIdentityBlock keeps its own
              truncation for the name itself. Renders nothing when the post has
              no approved tags. */}
          {/* gap-x-1 IS THE SPACE BEFORE "with", AND IT HAS TO BE A GAP.
              Owner, 2026-08-11, with a Facebook post beside ours: "After
              verification tick check the space ... you did wrong". Ours read
              "50mm Retina World(tick)with AVIJIT SHEEL" with the words jammed
              together. TaggedPeople opened with a {" "} exactly for this, but
              this container is a FLEX box, so that leading space sits at the
              start of its own flex item and CSS collapses it to nothing. Text
              spacing cannot be written as a text node across a flex boundary;
              it has to be the container's gap. Vertical spacing is unchanged
              (gap-x only), so a wrapped tag phrase keeps the same line height. */}
          <div className="flex flex-wrap items-center gap-x-1 min-w-0 text-sm">
            <UserIdentityBlock
              userId={post.user_id}
              name={post.author_name || "Photographer"}
              // ⚠ PASS THE BADGES THE QUERY ALREADY FETCHED. Every feed/wall/
              // hashtag query has computed `author_badges` for months and no
              // caller read it, so the tick fell back to a second per-name
              // lookup at render time — and a verified author showed with no
              // tick (owner, 2026-08-14). The name and the badge now travel
              // together, exactly like author_name itself.
              badges={post.author_badges}
              linkTo={`/profile/${post.user_id}`}
              nameClassName="text-sm font-semibold hover:text-primary transition-colors truncate [font-family:var(--font-heading)]"
            />
            <TaggedPeople people={post.tagged_people ?? []} />
          </div>
          {/* THE SECOND LINE IS QUIET ON PURPOSE.
              Owner, 2026-08-10: "Entire App fonts are extremely big. Match with
              Instagram exactly." The sizes here were already 8-9px, but a
              readability rule he asked for earlier the same day raises anything
              under 12px to 12px — so uppercase text at 0.1em letter-spacing was
              being rendered at 12px and SHOUTED. Instagram sets no meta line in
              capitals and adds no tracking to it. Dropping the capitals and the
              tracking is what makes this read small; the pixel size is
              unchanged and the readability floor is untouched. */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground" style={headingFont}>
            {/* The Contributor Score sits at the FRONT of this line, so it reads
                as "just below the name" without the card growing a third line.
                Renders nothing for an admin, a suspended or deleted account, or
                a score of zero. */}
            <ContributorScore userId={post.user_id} />
            <span>{timeAgo(post.created_at)}</span>
            <span className="inline-flex items-center gap-1">{privacyIcon(post.privacy)}</span>
            {post.is_suggested && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground text-xs font-medium">
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
          /* THE ICON, AND NOTHING ELSE. Owner, 2026-08-10: "Dont shoe the text
             Add friend, Show only the icon, icon size same size like Like and
             Comment icons."

             So: 24px, the same as MessageCircle and Send in the action row, and
             the same 1.75 stroke. The bordered pill and the words are gone.

             A wordless control has to say what it is some other way, which is
             what `aria-label` and `title` are for — a screen reader announces
             it and a hover shows it. And the two STATES have to be tellable
             apart without words, so a sent request switches to UserCheck; the
             disabled look alone would read as broken. */
          <button
            onClick={() => {
              if (friendRequested || sendFriend.isPending) return;
              sendFriend.mutate(post.user_id, { onSuccess: () => setFriendRequested(true) });
            }}
            disabled={friendRequested || sendFriend.isPending}
            aria-label={friendRequested ? "Friend request sent" : "Add friend"}
            title={friendRequested ? "Friend request sent" : "Add friend"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-primary hover:bg-primary/10 transition-colors disabled:opacity-60"
          >
            {friendRequested
              ? <UserCheck className="h-6 w-6" strokeWidth={1.75} />
              : <UserPlus className="h-6 w-6" strokeWidth={1.75} />}
          </button>
        )}
        {currentUserId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                /* 44x44. Measured at 36x36 in the harness: this is the post's
                   own menu — delete, report, remove from wall — so a miss here
                   is a member tapping the wrong post's actions. The glyph is
                   unchanged; the circle around it reaches the floor. */
                className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-muted/50 transition-colors"
              >
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
                  {viewerIsTagged && (
                    <DropdownMenuItem
                      onClick={removeMyTag}
                      disabled={actionLoading}
                      className="py-2.5"
                    >
                      <UserMinus className="h-4 w-4 mr-2.5" /> Remove tag of me
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleDelete} disabled={actionLoading} className="text-destructive focus:text-destructive py-2.5">
                    <Trash2 className="h-4 w-4 mr-2.5" /> Move to trash
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  {viewerIsTagged && (
                    <DropdownMenuItem
                      onClick={removeMyTag}
                      disabled={actionLoading}
                      className="text-destructive focus:text-destructive py-2.5"
                    >
                      <UserMinus className="h-4 w-4 mr-2.5" /> Remove tag of me
                    </DropdownMenuItem>
                  )}
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

      {/* ── Media ──
          REACH AND VIEWS LIVE HERE NOW, OVER THE PHOTOGRAPH.

          Owner, 2026-08-15: *"Viewed by and reached by will show on mouse over
          or on 1st touch on the image and emoji will show on the right side
          where now viewed by and rached by showinw... web and app both."*

          Two things drove it. The row was CUT IN HALF at 360px on a busy post
          — "943 reached (eye) 66" — and, worse, the figures arrive after the
          card has already painted, so the whole action row SHIFTED under the
          member's thumb as they went to tap it. Moving them out of the row
          removes both faults at once: the row is now a fixed set of controls
          that never reflows.

          • Web: `group-hover/media`, pure CSS, no JavaScript and no click stolen.
          • App: the FIRST tap reveals them and opens nothing; the second opens
            the photograph, exactly as it always did. See `interceptFirstTap`. */}
      {imageUrls.length > 0 && (
        <div className="relative group/media px-0">
          <PostMedia
            urls={imageUrls}
            thumbUrls={thumbUrls}
            onDoubleTapLike={() => {
              if (currentUserId && !post.user_reaction) onReact(post.id, "like");
            }}
            interceptFirstTap={() => {
              // Only ever consumes ONE tap, and only when there is something to
              // show: a post under 24 hours old has no figures yet, and eating
              // a tap to reveal nothing would just feel broken.
              if (!stats || statsRevealed) return false;
              setStatsRevealed(true);
              return true;
            }}
          />

          {stats && (
            <div
              data-testid="post-reach-views"
              className={`pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-3 rounded-full bg-black/65 px-3 py-1.5 text-xs text-white backdrop-blur-sm transition-opacity duration-200 group-hover/media:opacity-100 ${
                statsRevealed ? "opacity-100" : "opacity-0"
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span className="font-medium">{formatEngagementCount(stats.reach)}</span>
                <span className="text-white/75">reached</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3 w-3" />
                <span className="font-medium">{formatEngagementCount(stats.views)}</span>
                <span className="text-white/75">viewed</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── ACTION ROW — ICONS WITH THEIR COUNTS BESIDE THEM ──

          This is ONE row where there used to be two. Owner, 2026-08-10, with an
          Instagram screenshot of exactly this: a heart with 50.9K next to it, a
          speech bubble with 656, a repost arrow with 2,085, a paper plane with
          43.1K — all on the same line, all pushed left.

          What was here before: a counts row (emoji + number, then reach/viewed)
          and, under a horizontal rule, a second row of bare icons. Two rows for
          the same three facts, and a divider Instagram does not draw. The rule
          is gone with everything else he called a border, and each number now
          sits beside the icon it belongs to.

          Nothing lost a tooltip. The like number is still wrapped in
          ReactionSummaryTooltip and the share number in ShareSummaryTooltip —
          they moved, they were not deleted. The counts still disappear at zero,
          so a fresh post shows three clean icons.

          Icon size is 24px, the same as Instagram's, in a 44x48 tap area. */}
      <div className="select-none px-1.5">
        <div className="flex items-center">
          {/* Like — the picker owns the button, the count sits beside it */}
          <div className="flex items-center">
            <ReactionPicker
              currentReaction={post.user_reaction}
              onReact={(type) => onReact(post.id, type)}
              onUnreact={() => onUnreact(post.id)}
              disabled={!currentUserId}
            />
            {post.like_count > 0 && (
              <ReactionSummaryTooltip reactionCounts={post.reaction_counts} totalCount={post.like_count} postId={post.id}>
                {/* JUST THE NUMBER IN THE ROW. THE BREAK-UP IS ONE TAP AWAY.

                    Owner, 2026-08-10, with Instagram open beside this: "Like
                    count exactly show like Instagram but when All likes will
                    see then love and wow break up will show. Same for Comment
                    and Share."

                    Instagram writes "50.9K" beside the heart and nothing else,
                    and that is what this is. Nothing is lost: this span is the
                    trigger for ReactionSummaryTooltip, which lists every
                    reaction with its own emoji, its name and its count, and
                    then every member who left one. Comment and Share behave the
                    same way — a plain number that opens the detail.

                    The two emoji faces that used to sit here were also what
                    made the row's spacing uneven, because they were wider than
                    the number they preceded. */}
                <span className="pr-2 cursor-pointer text-sm font-semibold text-foreground">
                  {formatNumber(post.like_count)}
                </span>
              </ReactionSummaryTooltip>
            )}
          </div>

          {/* Comment */}
          <button onClick={() => setCommentsExpanded(!commentsExpanded)}
            aria-label={t("post.comment")}
            title={t("post.comment")}
            className="h-12 px-2.5 flex items-center gap-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation">
            <MessageCircle className="h-6 w-6" strokeWidth={1.75} />
            {post.comment_count > 0 && (
              <span className="text-sm font-semibold text-foreground">{formatNumber(post.comment_count)}</span>
            )}
          </button>

          {/* Share */}
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={t("post.share")}
                  title={t("post.share")}
                  className="h-12 px-2.5 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation">
                  <Send className="h-6 w-6" strokeWidth={1.75} />
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
            {post.share_count > 0 && (
              <ShareSummaryTooltip shareCount={post.share_count} postId={post.id}>
                <span className="pr-2 cursor-pointer text-sm font-semibold text-foreground">{formatNumber(post.share_count)}</span>
              </ShareSummaryTooltip>
            )}
          </div>

          {/* Reach and Viewed-by. DISPLAY figures from `displayEngagement`, not
              measurements. The real distinct-viewer count (`post.views`, from
              get_post_view_counts) is still collected and still on the object —
              it is simply not what this renders. Everything about why, and the
              four properties that keep the pair internally consistent, is
              documented in src/lib/displayEngagement.ts. Every other number
              here is real.
              Kept at the owner's explicit instruction on 2026-08-10 when he was
              offered its removal. `ml-auto` holds it against the right edge
              even on a post with no reactions, comments or shares at all.
              `stats` is null for the first 24 hours after posting — the pair is
              then absent entirely, which is his rule. */}
          {/* ── THE REACTION BREAKDOWN, ON THE RIGHT ──

              Owner, 2026-08-15: *"emoji mean love and like icons of likes post
              posts like fb"*, with *"Icons + a count per reaction, total
              reaction on left side as per FB current style"*.

              So the total stays where it always was — beside the thumb on the
              left, which is Facebook's own arrangement — and the right-hand
              side, which used to hold the reach/views figures that were being
              sliced off at 360px, now carries each reaction that the post
              actually received with its own count.

              It is derived from `reaction_counts`, which arrives WITH the post,
              so unlike the figures it replaced this cannot appear late and
              shift the row. Zero-count reactions are dropped rather than shown
              as "0" — an emoji nobody chose is noise. `ml-auto` holds the group
              right even on a post with no reactions at all.

              It opens the same ReactionSummaryTooltip as the total does, so
              tapping any of it still lists every member who reacted. */}
          {breakdown.length > 0 && (
            /* `ml-auto` sits on a wrapper OUTSIDE the tooltip, not on the row
               itself: the tooltip renders its own element around the trigger,
               so a margin on the child never reaches the flex parent and the
               group drifted in from the right edge. Measured in the harness. */
            <div className="ml-auto">
            <ReactionSummaryTooltip reactionCounts={post.reaction_counts} totalCount={post.like_count} postId={post.id}>
              <div className="flex cursor-pointer items-center gap-2.5 pr-1.5 text-xs text-muted-foreground">
                {breakdown.map(({ type, emoji, count }) => (
                  <span key={type} className="inline-flex items-center gap-1" title={type}>
                    <span aria-hidden className="text-[13px] leading-none">{emoji}</span>
                    <span className="font-medium text-foreground/80">{formatNumber(count)}</span>
                  </span>
                ))}
              </div>
            </ReactionSummaryTooltip>
            </div>
          )}
        </div>
      </div>

      {/* ── Caption, UNDER the actions, with the name in front of it ──
          Instagram's order, which the owner chose on 2026-08-10 when he was
          shown both: photo, then the icon row, then "<name> caption", then the
          comments. The name is passed as `prefix` so it sits INSIDE the clamped
          paragraph — put above it and it would survive on its own line while
          the sentence it introduces was collapsed.

          THE EDITOR IS IN THE SAME SLOT, deliberately. When the caption moved
          below the action row the edit box was left where the caption used to
          be, above the photograph — so tapping "Edit caption" made the text
          jump the height of the picture and reappear somewhere else. The owner
          had that corrected on 2026-08-10. Reading and editing must happen in
          the same place; if the caption ever moves again, the editor moves with
          it because they are now the two halves of one ternary. */}
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
        <Caption
          content={post.content}
          prefix={
            <Link
              to={`/profile/${post.user_id}`}
              className="font-semibold text-foreground hover:text-primary transition-colors mr-1.5"
            >
              {post.author_name || "Photographer"}
            </Link>
          }
        />
      )}

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
