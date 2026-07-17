import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { Globe, Users, Lock, ArrowLeft, Share2, Copy, Flag, MoreHorizontal, MessageCircle } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import { toast } from "@/hooks/core/use-toast";
import RichContentRenderer from "@/components/RichContentRenderer";
import PostCommentsSection from "@/components/PostCommentsSection";
import EngagementFooter from "@/components/EngagementFooter";
import FacebookPhotoGrid from "@/components/FacebookPhotoGrid";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import ReactionPicker, { ReactionType, REACTION_EMOJI_MAP } from "@/components/ReactionPicker";
import ReactionSummaryTooltip from "@/components/ReactionSummaryTooltip";
import ShareSummaryTooltip from "@/components/ShareSummaryTooltip";
import { useReactToPost, useUnreactToPost } from "@/hooks/feed/usePostReactionMutations";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import PageSEO from "@/components/PageSEO";

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

      setPost({
        id: rawPost.id,
        user_id: rawPost.user_id,
        content: rawPost.content || "",
        image_url: rawPost.image_url,
        image_urls: (rawPost as any).image_urls || [],
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
    navigator.clipboard.writeText(`${window.location.origin}/post/${postId}`);
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
        {/* Back button */}
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary mb-4 transition-colors" style={headingFont}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <div className="border border-border rounded-xl md:rounded-none overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 p-3 pb-0">
            <Link to={`/profile/${post.user_id}`} className="shrink-0">
              {post.author_avatar ? (
                <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={post.author_avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm text-primary" style={displayFont}>{(post.author_name || "?")[0]?.toUpperCase()}</span>
                </div>
              )}
            </Link>
            <div className="flex-1 min-w-0">
              <UserIdentityBlock
                userId={post.user_id}
                name={post.author_name || "Photographer"}
                linkTo={`/profile/${post.user_id}`}
                nameClassName="text-sm font-light hover:text-primary transition-colors truncate [font-family:var(--font-heading)]"
              />
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                <span>{timeAgo(post.created_at)}</span>
                <span>·</span>
                {privacyIcon(post.privacy)}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={copyLink}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Copy Link
                </DropdownMenuItem>
                {user && post && user.id !== post.user_id && (
                  <DropdownMenuItem onClick={async () => {
                    const { error } = await supabase.from("post_reports").insert({ post_id: post.id, reporter_id: user.id, reason: "inappropriate" });
                    if (error && error.code === "23505") {
                      toast({ title: "You have already reported this post" });
                    } else if (error) {
                      toast({ title: "Failed to report", variant: "destructive" });
                    } else {
                      toast({ title: "Report submitted" });
                    }
                  }}>
                    <Flag className="h-3.5 w-3.5 mr-2" /> Report Post
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Content */}
          {post.content && (
            <div className="px-3 py-2">
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={bodyFont}>
                <RichContentRenderer content={post.content} />
              </p>
            </div>
          )}

          {/* Images */}
          {allImages.length > 0 && (
            <div className="mt-1">
              {allImages.length === 1 ? (
                <div className="relative group/img">
                  <img src={allImages[0]} alt="" className="w-full" loading="lazy" />
                  <DownloadButton
                    downloading={downloading === allImages[0]}
                    onClick={(e) => { e.stopPropagation(); downloadImg(allImages[0]); }}
                    className="absolute bottom-3 right-3 p-2 rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-card shadow-sm disabled:opacity-60"
                  />
                </div>
              ) : (
                <FacebookPhotoGrid urls={allImages} />
              )}
            </div>
          )}

          {/* Counts + Engagement Stats */}
          <div className="flex items-center gap-3 px-3 pb-1.5 pt-2 text-[10px] text-muted-foreground" style={headingFont}>
            {post.like_count > 0 && (
              <ReactionSummaryTooltip reactionCounts={post.reaction_counts} totalCount={post.like_count} postId={post.id}>
                <span className="inline-flex items-center gap-1 cursor-pointer">
                  {(post.top_reactions.length > 0 ? post.top_reactions : ["like"]).map((type) => (
                    <span key={type} className="text-sm">{REACTION_EMOJI_MAP[type] || "👍"}</span>
                  ))}
                  {post.like_count}
                </span>
              </ReactionSummaryTooltip>
            )}
            {post.comment_count > 0 && (
              <button onClick={() => setShowComments(!showComments)} className="hover:text-foreground transition-colors">
                {post.comment_count} {post.comment_count === 1 ? "comment" : "comments"}
              </button>
            )}
            {post.share_count > 0 && (
              <ShareSummaryTooltip shareCount={post.share_count} postId={post.id}>
                <span className="hover:text-foreground transition-colors">
                  {post.share_count} {post.share_count === 1 ? "share" : "shares"}
                </span>
              </ShareSummaryTooltip>
            )}
            <div className="flex-1" />
          </div>

          {/* Actions */}
          <div className="mx-2.5 border-t border-border select-none">
            <div className="flex">
              <ReactionPicker
                currentReaction={post.user_reaction}
                onReact={(type) => handleReact(type)}
                onUnreact={handleUnreact}
                disabled={!user}
              />
              <button
                onClick={() => setShowComments(!showComments)}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md my-1 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <MessageCircle className="h-5 w-5" /> Comment
              </button>
              <button
                onClick={copyLink}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md my-1 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <Share2 className="h-5 w-5" /> Share
              </button>
            </div>
          </div>

          {/* Comments */}
          {showComments && (
            <PostCommentsSection
              postId={post.id}
              postOwnerId={post.user_id}
              expanded={showComments}
              onCommentCountChange={(delta) => setPost((p) => p ? { ...p, comment_count: Math.max(0, p.comment_count + delta) } : p)}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default PostDetail;
