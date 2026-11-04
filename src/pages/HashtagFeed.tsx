import { useParams, Link } from "react-router-dom";
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import { toast } from "@/hooks/core/use-toast";
import { useFeedCacheUpdaters } from "@/hooks/feed/useFeedCacheUpdaters";
import { useReactToPost, useUnreactToPost } from "@/hooks/feed/usePostReactionMutations";
import { fetchHashtagPosts } from "@/hooks/feed/useUserPostsQuery";
import PostCard from "@/components/post/PostCard";
import type { ReactionType } from "@/components/ReactionPicker";
import PageSEO from "@/components/PageSEO";
import type { UnifiedPost } from "@/types/post";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

/**
 * /hashtag/:tag — PAGE CHROME PLUS THE ONE CARD (central control K1).
 *
 * This page used to draw its own card, with no counts, comments or menu, so a
 * post looked different here from the same post on the feed. It renders no post
 * markup of its own: anything that belongs to a post goes in PostCard.
 * HashtagFeedPostCard.test.tsx compares the two DOMs.
 */
const HashtagFeed = () => {
  const { tag } = useParams<{ tag: string }>();
  const { user, loading: authLoading } = useAuth();
  const { blockedIds } = useBlockedUsers();
  const { removePost } = useFeedCacheUpdaters();
  const qc = useQueryClient();

  const queryKey = useMemo(() => ["hashtag-posts", tag ?? "", user?.id ?? ""], [tag, user?.id]);
  const { data, isPending: loading } = useQuery({
    queryKey,
    // Waits for the sign-in: the viewer decides the reaction shown on each card.
    enabled: !!tag && !authLoading,
    queryFn: () => fetchHashtagPosts(tag!, user?.id),
  });
  // The ⋯ menu can block an author from here, so the card has to go at once.
  const posts = useMemo(() => (data ?? []).filter((p) => !blockedIds.has(p.user_id)), [data, blockedIds]);

  /** Every change a card reports lands on this page's own list. */
  const mapPosts = useCallback(
    (mapper: (p: UnifiedPost) => UnifiedPost) => {
      qc.setQueryData<UnifiedPost[]>(queryKey, (old) => old?.map(mapper));
    },
    [qc, queryKey],
  );
  const patchPost = useCallback(
    (postId: string, patch: (p: UnifiedPost) => Partial<UnifiedPost>) =>
      mapPosts((p) => (p.id === postId ? { ...p, ...patch(p) } : p)),
    [mapPosts],
  );
  const reactMutation = useReactToPost<UnifiedPost>(mapPosts);
  const unreactMutation = useUnreactToPost<UnifiedPost>(mapPosts);

  const handleReact = useCallback((postId: string, reactionType: ReactionType) => {
    if (!user || reactMutation.isPending) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    reactMutation.mutate({ postId, reactionType, hadPreviousReaction: !!post.user_reaction });
  }, [user, posts, reactMutation]);

  const handleUnreact = useCallback((postId: string) => {
    if (!user || unreactMutation.isPending) return;
    unreactMutation.mutate(postId);
  }, [user, unreactMutation]);

  const handleDelete = useCallback(async (postId: string) => {
    if (!user) return;
    const { error } = await supabase.from("posts").delete().eq("id", postId).eq("user_id", user.id);
    if (error) {
      toast({ title: "Failed to delete post", variant: "destructive" });
      return;
    }
    qc.setQueryData<UnifiedPost[]>(queryKey, (old) => old?.filter((p) => p.id !== postId));
    removePost(postId);
    qc.invalidateQueries({ queryKey: ["user-wall-posts"] });
    qc.invalidateQueries({ queryKey: ["user-own-posts"] });
    toast({ title: "Post moved to trash" });
  }, [user, qc, queryKey, removePost]);

  const handleCommentCountChange = useCallback((postId: string, delta: number) => {
    patchPost(postId, (p) => ({ comment_count: Math.max(0, p.comment_count + delta) }));
  }, [patchPost]);

  const handleShareCountChange = useCallback((postId: string, delta: number) => {
    patchPost(postId, (p) => ({ share_count: Math.max(0, (p.share_count || 0) + delta) }));
  }, [patchPost]);

  const handleContentChange = useCallback((postId: string, content: string) => {
    patchPost(postId, () => ({ content }));
  }, [patchPost]);

  return (
    <div className="py-3 md:py-14 max-w-2xl mx-auto">
      <PageSEO
        title={`#${tag || "hashtag"}`}
        description={`Browse posts tagged #${tag || ""} on 50mm Retina World.`}
      />

      <div className="flex items-center gap-3 mb-4 md:mb-8">
        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Hash className="h-5 w-5 md:h-6 md:w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground" style={headingFont}>#{tag}</h1>
          <p className="text-xs md:text-sm text-muted-foreground" style={bodyFont}>
            {loading ? "Searching..." : `${posts.length} public post${posts.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>
            Loading...
          </span>
        </div>
      ) : posts.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center rounded-lg">
          <Hash className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground" style={bodyFont}>No public posts found with #{tag}</p>
          <Link to="/feed" className="inline-flex items-center gap-1.5 mt-4 text-sm text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to feed
          </Link>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={user?.id}
            onReact={handleReact}
            onUnreact={handleUnreact}
            onDelete={handleDelete}
            onCommentCountChange={handleCommentCountChange}
            onShareCountChange={handleShareCountChange}
            onContentChange={handleContentChange}
          />
        ))
      )}
    </div>
  );
};

export default HashtagFeed;
