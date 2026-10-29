import { useEffect, useRef, useState } from "react";
import { timedRpc } from "@/lib/logger";
import { onlineManager } from "@tanstack/react-query";
import { loadPostPage, type PostRow } from "@/lib/posts/postPageLoad";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import { publicUrl } from "@/lib/publicUrl";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { inAppHistoryDepth } from "@/hooks/core/useAndroidBackButton";
import { goBackOrFeed, isNotificationEntry } from "@/lib/navigationContract";
import { supabase } from "@/integrations/supabase/client";
import { fetchPostAttachments, attachmentsFor } from "@/lib/posts/postAttachments";
import type { FeedVideo } from "@/lib/video/postVideoRead";
import { useAuth } from "@/hooks/core/useAuth";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { Globe, Users, Lock, ArrowLeft, Share2, Copy, Flag, MoreHorizontal, MessageCircle, Eye, WifiOff } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import { toast } from "@/hooks/core/use-toast";
import RichContentRenderer from "@/components/RichContentRenderer";
import TranslateBar from "@/components/post/TranslateBar";
import PostCommentsSection from "@/components/PostCommentsSection";
import PostCard from "@/components/post/PostCard";
import PostPageMore from "@/components/post/PostPageMore";
import { useCommentsOverlay } from "@/contexts/CommentsOverlayContext";
import { isCommentId, isCommentNotificationType, resolveNotifiedCommentId } from "@/lib/notificationComment";
import { useScrollRestoreOnReturn } from "@/hooks/core/useScrollRestoreOnReturn";
import type { UnifiedPost } from "@/types/post";
import FacebookPhotoGrid from "@/components/FacebookPhotoGrid";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import type { ReactionType } from "@/components/ReactionPicker";
import ReactionSummaryTooltip from "@/components/ReactionSummaryTooltip";
import ShareSummaryTooltip from "@/components/ShareSummaryTooltip";
import { useReactToPost, useUnreactToPost } from "@/hooks/feed/usePostReactionMutations";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import PageSEO from "@/components/PageSEO";
import { avatarInitial } from "@/lib/displayName";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

type Privacy = "public" | "friends" | "private";

interface PostData {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  image_urls: string[];
  privacy: Privacy;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  /** F-95 — the name-URL handle, carried beside the name it belongs to. */
  author_handle: string | null;
  like_count: number;
  comment_count: number;
  share_count: number;
  user_reaction: ReactionType | null;
  top_reactions: string[];
  reaction_counts: Record<string, number>;
  /** VID-1: the post's playable video, when it is a video post. */
  video?: FeedVideo | null;
}

/** S4-b: history entries whose comment focus has already been opened (see below). */
const focusHandled = new Set<string>();

/**
 * S4-b · A COMMENT NOTIFICATION OPENS ON ITS COMMENT (Instagram/Facebook).
 *
 * Arriving from a comment notification (bell, Notifications page, push — the
 * entry state carries its type) or from a link carrying `?comment=<id>`, the
 * post opens with its comments open on that comment — loaded even beyond the
 * first page, scrolled to and marked (src/lib/notificationComment.ts names
 * the comment). Opening the thread is the ordinary rule-1 push, so Back closes
 * it (the post is beneath) and Back again leaves the post: nothing new to
 * learn about Back.
 *
 * ONCE per history entry: the entry is remembered, so Back from the thread
 * (a traversal INTO this same entry) never opens it again — the L1 loop.
 * Rendered only beside the card, i.e. only once the post is on screen.
 */
const CommentNotificationFocus = ({
  post,
  onCommentCountChange,
}: {
  post: UnifiedPost;
  onCommentCountChange: (postId: string, delta: number) => void;
}) => {
  const location = useLocation();
  const { openPostComments } = useCommentsOverlay();
  const search = new URLSearchParams(location.search);
  const focusParam = search.get("comment");
  const state = isNotificationEntry(location.state) ? location.state : null;
  const notifType = state?.type ?? null;
  const wantsFocus = isCommentId(focusParam) || isCommentNotificationType(notifType);
  const entryKey = location.key;
  const onThreadEntry = search.has("comments");
  useEffect(() => {
    if (!wantsFocus || onThreadEntry || focusHandled.has(entryKey)) return;
    focusHandled.add(entryKey);
    let live = true;
    let opened = false;
    void (async () => {
      const commentId = isCommentId(focusParam)
        ? focusParam
        : await resolveNotifiedCommentId(post.id, notifType!).catch(() => null);
      if (!live) return; // the member moved on while the comment was looked up
      opened = true;
      openPostComments(post, onCommentCountChange, { commentId });
    })();
    return () => {
      live = false;
      // Not opened yet (left mid-lookup, or StrictMode's rehearsal unmount):
      // this entry has not had its open, so a later mount may still give it one.
      if (!opened) focusHandled.delete(entryKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, entryKey, wantsFocus, onThreadEntry]);
  return null;
};

const PostDetail = () => {
  const { postId } = useParams<{ postId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  /** S7b-4: no network and this post is not saved on the phone. */
  const [offline, setOffline] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const offlineRef = useRef(false);
  const savedRef = useRef(false);
  offlineRef.current = offline;
  const [showComments, setShowComments] = useState(true);
  const { downloading, download: downloadImg } = useDownloadImage();

  const { blockedIds } = useBlockedUsers();
  // S4-a: the page now scrolls on into the author's posts and the feed — Back
  // from a post opened down there returns to the same place, as on /feed.
  useScrollRestoreOnReturn();
  const reactMutation = useReactToPost();
  const unreactMutation = useUnreactToPost();

  /**
   * L1: this page's own "← Back" / "Go back". `navigate(-1)` with nothing of
   * ours beneath (an external link, a cold start) leaves the site or lands on
   * whatever the WebView had lying there — so with no in-app history it goes to
   * the feed instead, replacing this entry (no extra step for Back to undo).
   */
  const goBack = () => goBackOrFeed(navigate, inAppHistoryDepth());

  /**
   * L1: a notification about a post that has since been deleted (or hidden)
   * lands on the feed with a short notice — not on a dead end. When the tap
   * put the feed beneath this page (cold start), one step back IS the feed;
   * otherwise this entry is replaced by the feed.
   */
  const location = useLocation();
  const fromNotification = isNotificationEntry(location.state) ? location.state : null;
  useEffect(() => {
    if (!notFound || !fromNotification) return;
    toast({ title: "That post is no longer available." });
    if (fromNotification.feedBeneath) navigate(-1);
    else navigate("/feed", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notFound]);

  useEffect(() => {
    if (!postId) return;
    let live = true;
    /** Author, counts and media for a post row (null = not viewable here, e.g. a hidden video). */
    const readDetails = async (rawPost: PostRow & { image_url?: string | null }): Promise<PostData | null> => {
      const profileMap = await fetchProfileMap([rawPost.user_id]);
      const profile = profileMap.get(rawPost.user_id);

      let userReaction: ReactionType | null = null;
      let reactionCounts: Record<string, number> = {};
      let topReactions: string[] = [];

      const { data: reactions } = await supabase
        .from("post_reactions")
        .select("reaction_type, user_id")
        .eq("post_id", postId);

      if (reactions) {
        const counts: Record<string, number> = {};
        for (const r of reactions) {
          counts[r.reaction_type] = (counts[r.reaction_type] || 0) + 1;
          if (user && r.user_id === user.id) userReaction = r.reaction_type as ReactionType;
        }
        reactionCounts = counts;
        topReactions = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => k);
      }

      const { count: commentCount } = await supabase
        .from("post_comments")
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId);

      const { count: shareCount } = await (supabase
        .from("post_shares" as any)
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId) as any);

      /**
       * ITEM E + VID-1 — photographs and video through the one module every
       * surface uses (postAttachments.ts). One post, so one batch of one. A
       * video that is not playable for this viewer (not ready, not visible)
       * hides the post, as the feed does.
       */
      const attached = attachmentsFor(
        await fetchPostAttachments([rawPost.id]), rawPost.id, (rawPost as any).image_urls || [],
      );
      if (attached === null) return null;

      return {
        id: rawPost.id,
        user_id: rawPost.user_id,
        content: rawPost.content || "",
        image_url: rawPost.image_url,
        image_urls: attached.image_urls,
        video: attached.video,
        privacy: (rawPost.privacy || "public") as Privacy,
        created_at: rawPost.created_at,
        author_name: profile?.full_name || null,
        author_avatar: profile?.avatar_url || null,
        author_handle: profile?.custom_url ?? null,
        like_count: Object.values(reactionCounts).reduce((s, v) => s + v, 0),
        comment_count: commentCount || 0,
        share_count: shareCount || 0,
        user_reaction: userReaction,
        top_reactions: topReactions,
        reaction_counts: reactionCounts,
      };
    };
    const load = async () => {
      setLoading(true);
      setOffline(false);
      setNotFound(false);
      // Review #564: never show the previous post under a new address.
      setPost((p) => (p && p.id === postId ? p : null));
      // S7b-4: no network → the copy saved on the phone (src/lib/posts/postPageLoad.ts).
      const result = await loadPostPage(postId, user?.id, {
        online: () => onlineManager.isOnline(),
        readPost: (id) => timedRpc("post.open", "src/pages/PostDetail.tsx", () =>
          supabase.from("posts").select("*").eq("id", id).maybeSingle(),
        ) as Promise<{ data: PostRow | null; error: unknown }>,
        readDetails,
      });
      if (!live) return;
      savedRef.current = result.kind === "post" && result.saved;
      if (result.kind === "post") setPost(result.post as PostData);
      else if (result.kind === "offline") setOffline(true);
      else setNotFound(true);
      setLoading(false);
    };
    load();
    return () => { live = false; };
  }, [postId, user?.id, reloadTick]);

  // Review #564: "it will open when you're back online" — so it does: when the
  // network returns, a page shown offline (or from the saved copy) reloads.
  useEffect(() => onlineManager.subscribe((online) => {
    if (online && (offlineRef.current || savedRef.current)) setReloadTick((n) => n + 1);
  }), []);

  const handleReact = (reactionType: ReactionType) => {
    if (!user || !post || reactMutation.isPending) return;
    reactMutation.mutate({ postId: post.id, reactionType, hadPreviousReaction: !!post.user_reaction });
    setPost((p) => p ? {
      ...p,
      user_reaction: reactionType,
      like_count: p.user_reaction ? p.like_count : p.like_count + 1,
      top_reactions: [...new Set([reactionType, ...p.top_reactions])].slice(0, 3),
      reaction_counts: {
        ...p.reaction_counts,
        ...(p.user_reaction ? { [p.user_reaction]: Math.max(0, (p.reaction_counts[p.user_reaction] || 1) - 1) } : {}),
        [reactionType]: (p.reaction_counts[reactionType] || 0) + 1,
      },
    } : p);
  };

  const handleUnreact = () => {
    if (!user || !post || unreactMutation.isPending) return;
    unreactMutation.mutate(post.id);
    setPost((p) => p ? {
      ...p,
      user_reaction: null,
      like_count: Math.max(0, p.like_count - 1),
      reaction_counts: p.user_reaction
        ? { ...p.reaction_counts, [p.user_reaction]: Math.max(0, (p.reaction_counts[p.user_reaction] || 1) - 1) }
        : p.reaction_counts,
    } : p);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(publicUrl(`/post/${postId}`));
    toast({ title: "Link copied!" });
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const privacyIcon = (p: Privacy) => {
    switch (p) {
      case "public": return <Globe className="h-3 w-3" />;
      case "friends": return <Users className="h-3 w-3" />;
      case "private": return <Lock className="h-3 w-3" />;
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>Loading…</span>
      </main>
    );
  }

  if (offline && !post) {
    // S7b-4: not "not found" — the post may well exist; the phone has no copy.
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <WifiOff className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground" style={bodyFont}>No internet. This post isn't saved on your phone yet — it will open when you're back online.</p>
        <button onClick={goBack} className="text-xs text-primary hover:underline" style={headingFont}>Go back</button>
      </main>
    );
  }

  if (notFound || !post) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground" style={bodyFont}>Post not found or has been removed.</p>
        <button onClick={goBack} className="text-xs text-primary hover:underline" style={headingFont}>Go back</button>
      </main>
    );
  }

  // App Store 1.2: a member the viewer has blocked is not shown to them,
  // including by direct link.
  if (blockedIds.has(post.user_id)) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground" style={bodyFont}>You have blocked the member who posted this. You can unblock them in Settings → Blocked members.</p>
        <button onClick={goBack} className="text-xs text-primary hover:underline" style={headingFont}>Go back</button>
      </main>
    );
  }

  const allImages = post.image_urls?.length ? post.image_urls : post.image_url ? [post.image_url] : [];
  // Id and age only — never reaction/comment counts. Passing those made the
  // figures jump on Like and fall on un-Like (owner report, 2026-08-04).
  /**
   * The page's own row shape, mapped onto the one the card component takes.
   * `thumbnail_urls` is empty because this page fetches originals — the card
   * falls back to the full image, which is what this screen showed anyway.
   */
  const unifiedPost: UnifiedPost = {
    ...post,
    image_url: post.image_url ?? "",
    thumbnail_urls: [],
    is_liked: post.user_reaction !== null,
  };
  const ogImage = allImages[0] || undefined;
  const ogDescription = post.content?.slice(0, 160) || "A post on 50mm Retina World";

  return (
    <>
      <PageSEO
        title={post.author_name ? `Post by ${post.author_name}` : "Post"}
        description={ogDescription}
        ogImage={ogImage}
        ogType="article"
      />

      <div className="py-3 md:py-14 max-w-2xl mx-auto px-2 md:px-0">
        {/* Back button. min-h-11 = 44px; the sweep measured it at 49x16, which
            is the smallest control on the screen and the one a member reaches
            for most often. `-mt-3` takes the extra height back off the top so
            the gap above the card is unchanged, and `self-start`/`w-fit` keeps
            the target the width of the word rather than the whole column. */}
        <button onClick={goBack} className="flex w-fit min-h-11 -mt-3 items-center gap-2 text-xs text-muted-foreground hover:text-primary mb-4 transition-colors" style={headingFont}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        {/**
         * NO BOX AROUND THE CARD.
         *
         * This wrapper used to draw a border and clip its contents. Both are
         * wrong now that the card itself is rendered here: PostCard breaks out
         * to the full screen width on a phone (`bleed-phone`), so the
         * `overflow-hidden` sliced 16px off its left edge — visible in the
         * harness screenshot, the member's own name cut in half. And the owner
         * removed borders from the post card on 2026-08-10: "I told No border
         * anything to anywhere, example like Instagram". A border here put one
         * back on the same post, on a different screen. Same rule, one place.
         */}
        <div>
          {/**
           * ONE FUNNEL. THIS PAGE RENDERS THE SAME CARD THE FEED DOES.
           *
           * ─────────────────────────────────────────────────────────────────
           * OWNER, 2026-08-15, after opening a post from his wall and finding
           * the old layout on a post whose feed card had already changed:
           *
           *   "you are not maintaing one funnel - that is again creating
           *    issues multi funnel for same result... Again damaging rule
           *    established."
           *
           * He was right, and the duplication was not small. Everything
           * between this comment and the comments below used to be a SECOND,
           * hand-written copy of PostCard: its own header, its own media, its
           * own counts row, its own ReactionPicker, its own displayEngagement
           * call, its own caption. ~150 lines rendering the same post a second
           * way.
           *
           * The cost is not tidiness. It is that every change had to be made
           * TWICE and, when it was not, the same post read one way in the feed
           * and another way here — which is exactly how he found it. The
           * caption here never even got `break-words`; a one-word caption was
           * still being sliced off the edge on this screen after it had been
           * fixed in the feed.
           *
           * So this page is now page CHROME (the back bar above) plus the one
           * card component. There is no second implementation to keep in step,
           * because there is no second implementation.
           * ─────────────────────────────────────────────────────────────────
           */}
          <PostCard
            post={unifiedPost}
            currentUserId={user?.id}
            onReact={(_, type) => handleReact(type)}
            onUnreact={() => handleUnreact()}
            onCommentCountChange={(_, delta) =>
              setPost((p) => (p ? { ...p, comment_count: Math.max(0, p.comment_count + delta) } : p))
            }
            onShareCountChange={(_, delta) =>
              setPost((p) => (p ? { ...p, share_count: Math.max(0, p.share_count + delta) } : p))
            }
            onContentChange={(_, content) => setPost((p) => (p ? { ...p, content } : p))}
          />
          <CommentNotificationFocus
            post={unifiedPost}
            onCommentCountChange={(_, delta) =>
              setPost((p) => (p ? { ...p, comment_count: Math.max(0, p.comment_count + delta) } : p))
            }
          />

        </div>

        <PostPageMore
          key={post.id}
          postId={post.id}
          authorId={post.user_id}
          authorName={post.author_name}
          authorHandle={post.author_handle}
          currentUserId={user?.id}
        />
      </div>
    </>
  );
};

export default PostDetail;
