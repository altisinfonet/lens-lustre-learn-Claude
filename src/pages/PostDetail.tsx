import { useEffect, useState } from "react";
import { publicUrl } from "@/lib/publicUrl";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchPostMediaMap, resolvePostImageUrls } from "@/lib/media/postMediaRead";
import { useAuth } from "@/hooks/core/useAuth";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { Globe, Users, Lock, ArrowLeft, Share2, Copy, Flag, MoreHorizontal, MessageCircle, Eye } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import { toast } from "@/hooks/core/use-toast";
import RichContentRenderer from "@/components/RichContentRenderer";
import TranslateBar from "@/components/post/TranslateBar";
import PostCommentsSection from "@/components/PostCommentsSection";
import PostCard from "@/components/post/PostCard";
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
  like_count: number;
  comment_count: number;
  share_count: number;
  user_reaction: ReactionType | null;
  top_reactions: string[];
  reaction_counts: Record<string, number>;
}

const PostDetail = () => {
  const { postId } = useParams<{ postId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showComments, setShowComments] = useState(true);
  const { downloading, download: downloadImg } = useDownloadImage();

  const reactMutation = useReactToPost();
  const unreactMutation = useUnreactToPost();

  useEffect(() => {
    if (!postId) return;
    const load = async () => {
      setLoading(true);
      const { data: rawPost, error } = await supabase
        .from("posts")
        .select("*")
        .eq("id", postId)
        .maybeSingle();

      if (error || !rawPost) {
        setNotFound(true);
        setLoading(false);
        return;
      }

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
       * ITEM E — the photo detail page reads media through the same sanctioned
       * path as the feed and the wall. One post, so one batch of one; the
       * function is still the batching one because there must be exactly one
       * media reader in this codebase.
       */
      const postMediaMap = await fetchPostMediaMap([rawPost.id]);

      setPost({
        id: rawPost.id,
        user_id: rawPost.user_id,
        content: rawPost.content || "",
        image_url: rawPost.image_url,
        image_urls: resolvePostImageUrls(postMediaMap, rawPost.id, (rawPost as any).image_urls || []),
        privacy: (rawPost.privacy || "public") as Privacy,
        created_at: rawPost.created_at,
        author_name: profile?.full_name || null,
        author_avatar: profile?.avatar_url || null,
        like_count: Object.values(reactionCounts).reduce((s, v) => s + v, 0),
        comment_count: commentCount || 0,
        share_count: shareCount || 0,
        user_reaction: userReaction,
        top_reactions: topReactions,
        reaction_counts: reactionCounts,
      });
      setLoading(false);
    };
    load();
  }, [postId, user?.id]);

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

  if (notFound || !post) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground" style={bodyFont}>Post not found or has been removed.</p>
        <button onClick={() => navigate(-1)} className="text-xs text-primary hover:underline" style={headingFont}>Go back</button>
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
        <button onClick={() => navigate(-1)} className="flex w-fit min-h-11 -mt-3 items-center gap-2 text-xs text-muted-foreground hover:text-primary mb-4 transition-colors" style={headingFont}>
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

        </div>
      </div>
    </>
  );
};

export default PostDetail;
