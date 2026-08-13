import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useFeedRealtime } from "@/hooks/feed/useRealtimeFeed";
import { useNewPostsBanner } from "@/hooks/feed/useNewPostsBanner";
import { useFeedEventTracker } from "@/hooks/feed/useFeedEventTracker";
import { Link, useNavigate } from "react-router-dom";
import { Rss, ArrowUp, WifiOff } from "lucide-react";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";
import PullToRefresh from "@/components/PullToRefresh";
import FeedStoriesBar from "@/components/feed/FeedStoriesBar";
import { useReactToPost, useUnreactToPost } from "@/hooks/feed/usePostReactionMutations";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsBanned } from "@/hooks/core/useIsBanned";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import AdZone from "@/components/ads/AdZone";
import FeedFriendSuggestions from "@/components/feed/FeedFriendSuggestions";
import TodaysBirthdayStrip from "@/components/feed/TodaysBirthdayStrip";
import { slotForPostIndex, shouldShowFeedAd } from "@/lib/ads/feedAdPlacement";
import { useT } from "@/i18n/I18nContext";
import { motion, AnimatePresence } from "framer-motion";
import { useActivityLog } from "@/hooks/core/useActivityLog";
import { useFeedQuery, flattenFeedPages, getNetworkIds, type FeedPost } from "@/hooks/feed/useFeedQuery";
import { useFeedCacheUpdaters } from "@/hooks/feed/useFeedCacheUpdaters";
import PostCard from "@/components/post/PostCard";
import PostCardSkeleton from "@/components/post/PostCardSkeleton";
import WallPosts from "@/components/WallPosts";
import CategoryStrip from "@/components/feed/CategoryStrip";
import { ALL_FILTER } from "@/lib/categories";
import type { ReactionType } from "@/components/ReactionPicker";
import type { UnifiedPost } from "@/types/post";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

const Feed = () => {
  const { user, loading: authLoading } = useAuth();
  const { isBanned } = useIsBanned();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const { log } = useActivityLog();
  const t = useT();
  const { insertPost, replacePost, patchPost, removePost } = useFeedCacheUpdaters();
  const { bufferedCount, bufferPost, flushBuffer } = useNewPostsBanner();
  const { trackViewStart, trackViewEnd, trackAction } = useFeedEventTracker(user?.id);
  /**
   * Stage D — the selected category strip chip.
   *
   * ALL_FILTER means no predicate at all, which is why it is translated to
   * `null` rather than an empty array: `null` skips the filter entirely in the
   * RPC and keeps every uncategorised post visible, while `[]` would match
   * nothing. The distinction is the whole reason old posts still appear.
   */
  const [activeCategory, setActiveCategory] = useState<string>(ALL_FILTER);

  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
    refetch,
    // The feed can FAIL, and until 2026-08-13 this page had no idea that was
    // possible — see the error branch below.
    isError,
    isFetching,
  } = useFeedQuery(user?.id, activeCategory === ALL_FILTER ? null : [activeCategory]);

  const posts = useMemo(() => flattenFeedPages(data?.pages), [data?.pages]);
  const relevantUserIds = useMemo(() => getNetworkIds(data?.pages), [data?.pages]);

  const reactMutation = useReactToPost();
  const unreactMutation = useUnreactToPost();

  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  // ── Realtime handlers ──
  const handleNewPost = useCallback((rawPost: any) => {
    const fp: FeedPost = {
      id: rawPost.id,
      user_id: rawPost.user_id,
      content: rawPost.content || "",
      image_url: rawPost.image_url || null,
      image_urls: rawPost.image_urls?.length > 0 ? rawPost.image_urls : rawPost.image_url ? [rawPost.image_url] : [],
      privacy: rawPost.privacy || "public",
      created_at: rawPost.created_at,
      author_name: null,
      author_avatar: null,
      author_badges: [],
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      is_liked: false,
      user_reaction: null,
      top_reactions: [],
      reaction_counts: {},
      is_suggested: !relevantUserIds.includes(rawPost.user_id),
    };
    // Own post -> show at top instantly; others -> keep behind the banner.
    if (user?.id && rawPost.user_id === user.id) {
      insertPost(fp);
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.setTimeout(() => { void refetch(); }, 5000);
    } else {
      bufferPost(fp);
    }
  }, [relevantUserIds, bufferPost, insertPost, refetch, user?.id]);

  const handleUpdatePost = useCallback((rawPost: any) => {
    patchPost(rawPost.id, (current) => ({
      ...current,
      ...rawPost,
      image_urls: rawPost.image_urls?.length > 0 ? rawPost.image_urls : rawPost.image_url ? [rawPost.image_url] : [],
    }));
  }, [patchPost]);

  const handleDeletePost = useCallback((postId: string) => {
    removePost(postId);
  }, [removePost]);

  const handleReactionChange = useCallback((postId: string, event: "INSERT" | "DELETE", reaction: any) => {
    const delta = event === "INSERT" ? 1 : -1;
    const reactionType = reaction?.reaction_type as string | undefined;
    patchPost(postId, (current) => {
      const newCounts = { ...current.reaction_counts };
      if (reactionType) {
        newCounts[reactionType] = Math.max(0, (newCounts[reactionType] || 0) + delta);
      }
      const topReactions = Object.entries(newCounts)
        .filter(([, c]) => c > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type]) => type);
      return {
        like_count: Math.max(0, current.like_count + delta),
        reaction_counts: newCounts,
        top_reactions: topReactions,
      };
    });
  }, [patchPost]);

  const handleCommentChange = useCallback((postId: string, event: "INSERT" | "DELETE", _comment: any) => {
    const delta = event === "INSERT" ? 1 : -1;
    patchPost(postId, (current) => ({
      comment_count: Math.max(0, current.comment_count + delta),
    }));
  }, [patchPost]);

  const handleShareChange = useCallback((postId: string, event: "INSERT" | "DELETE") => {
    const delta = event === "INSERT" ? 1 : -1;
    patchPost(postId, (current) => ({
      share_count: Math.max(0, (current.share_count || 0) + delta),
    }));
  }, [patchPost]);

  useFeedRealtime({
    userId: user?.id,
    relevantUserIds,
    onNewPost: handleNewPost,
    onUpdatePost: handleUpdatePost,
    onDeletePost: handleDeletePost,
    onReactionChange: handleReactionChange,
    onCommentChange: handleCommentChange,
    onShareChange: handleShareChange,
  });

  const handleShowNewPosts = useCallback(() => {
    const posts = flushBuffer();
    posts.forEach((p) => insertPost(p));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [flushBuffer, insertPost]);

  const handleReact = useCallback((postId: string, reactionType: ReactionType) => {
    if (!user || reactMutation.isPending) return;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    trackAction(postId, post.user_id, "like");
    reactMutation.mutate({ postId, reactionType, hadPreviousReaction: !!post.user_reaction });
  }, [user, posts, reactMutation, trackAction]);

  const handleUnreact = useCallback((postId: string) => {
    if (!user || unreactMutation.isPending) return;
    unreactMutation.mutate(postId);
  }, [user, unreactMutation]);

  const handleShareToWall = useCallback(async (post: UnifiedPost) => {
    if (!user) return;
    if (isBanned) {
      toast({ title: "Your account is restricted from posting", variant: "destructive" });
      return;
    }
    // Record the share reference (not a duplicate post).
    // BUG-062: post_shares has no UPDATE policy, so a default upsert
    // (ON CONFLICT DO UPDATE) fails RLS on re-share. ignoreDuplicates makes it
    // ON CONFLICT DO NOTHING so re-sharing is a safe no-op instead of an error.
    const { error } = await supabase.from("post_shares" as any).upsert(
      { post_id: post.id, user_id: user.id } as any,
      { onConflict: "post_id,user_id", ignoreDuplicates: true }
    );
    if (error) {
      toast({ title: "Failed to share", variant: "destructive" });
    } else {
      patchPost(post.id, (current) => ({ share_count: (current.share_count || 0) + 1 }));
      trackAction(post.id, post.user_id, "share");
      toast({ title: "Shared to your wall!" });
    }
  }, [user, isBanned, patchPost, trackAction]);

  const handleDelete = useCallback(async (postId: string) => {
    if (!user) return;
    const { error } = await supabase.from("posts").delete().eq("id", postId).eq("user_id", user.id);
    if (error) {
      toast({ title: "Failed to delete post", variant: "destructive" });
    } else {
      removePost(postId);
      toast({ title: "Post moved to trash" });
    }
  }, [user, removePost]);

  const handleCommentCountChange = useCallback((postId: string, delta: number) => {
    patchPost(postId, (current) => ({ comment_count: Math.max(0, current.comment_count + delta) }));
  }, [patchPost]);

  const handleShareCountChange = useCallback((postId: string, delta: number) => {
    patchPost(postId, (current) => ({ share_count: Math.max(0, (current.share_count || 0) + delta) }));
  }, [patchPost]);

  const handleContentChange = useCallback((postId: string, newContent: string) => {
    patchPost(postId, () => ({ content: newContent }));
  }, [patchPost]);

  if (authLoading || !user) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>Loading...</span>
      </main>
    );
  }

  return (
    <PullToRefresh onRefresh={async () => { await refetch(); }}>
    <div className="py-3 md:py-14">
      <div className="min-w-0">
        {/* Stage D — the category strip.

            ⚠ IT SITS ABOVE THE STORIES ROW. Owner's app mock, 2026-08-12:
            Create header → category strip → Your Story → posts. It shipped
            BELOW the stories bar first; that is the order this replaces. The
            filter is what the whole feed obeys, so it reads before the thing
            it filters, not after it.

            Sticky, so it stays reachable while scrolling a long feed. "All" is
            the default and applies no predicate, which is what keeps the posts
            created before categories existed visible. */}
        <div className="sticky top-0 z-20 -mx-4 mb-3">
          <CategoryStrip value={activeCategory} onChange={setActiveCategory} />
        </div>

        {/* Stories bar — everyone's public stories (official first, then followed by recency) */}
        <FeedStoriesBar />

        {/*
          Today's Birthday on phones, tablets and inside the Android app.
          The left sidebar that carries it is `hidden xl:block`, so below
          1280px it was never rendered at all. This is `xl:hidden` — the exact
          complement — and renders nothing on days with no birthday.
        */}
        <TodaysBirthdayStrip />

        {/*
          NO HEADING AND NO REFRESH BUTTON. Owner, 2026-08-10, after seeing the
          build on his phone: "Dont Wrote News feed, your feed etc on the Top,
          refresh icon It must be like Instagram" — and, asked whether he meant
          the app only: "Dont show it anywhere neither on Web nor in App".

          What used to be here: a "NEWS FEED" eyebrow, a "Your Feed" h1 at
          text-lg/2xl, and a RefreshCw button.

          Nothing is lost by removing the button. This whole screen is already
          wrapped in <PullToRefresh onRefresh={refetch}> a few lines above, so
          pulling down still refreshes — which is exactly how Instagram does it
          and is why the button was redundant. `refetch` is also still called by
          the realtime handler.

          Do not put a title back. Instagram's feed starts at the first post.
        */}

        {/* Composer — same as My Wall, posts go to posts table → appear on Wall + Feed */}
        <WallPosts targetUserId={user.id} isOwnWall composerOnly />

        {/* Feed */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <PostCardSkeleton key={i} />)}
          </div>
        ) : isError && posts.length === 0 ? (
          /**
           * ⚠ "COULDN'T LOAD" IS NOT "NOTHING TO SHOW".
           *
           * Owner, 2026-08-12: *"when a bit slow network … 50mm retina posts
           * not showing"*. Until this branch existed, a failed feed fell
           * straight through to the empty state below and the app announced
           * "No posts yet — Be the first to share something" to a member
           * looking at a platform with hundreds of posts on it. That reads as
           * a dead product, and it is the single most damaging thing a feed
           * can say when the only real problem is a dropped request.
           *
           * The distinction is now made on screen, in the member's words: the
           * network failed, and here is the button that tries again. React
           * Query has already retried three times with backoff by the time
           * anyone sees this, so the button is for the case where the signal
           * came back after we stopped asking.
           */
          <div className="border border-dashed border-border p-12 text-center">
            <WifiOff className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2" style={bodyFont}>
              {t("feed.error.title", "Couldn't load your feed")}
            </p>
            <p className="text-xs text-muted-foreground" style={bodyFont}>
              {t("feed.error.body", "This looks like a connection problem, not an empty feed. Your posts are safe.")}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-block mt-4 text-[10px] tracking-[0.15em] uppercase text-primary hover:underline disabled:opacity-50"
              style={headingFont}
            >
              {isFetching ? t("common.loading", "Loading…") : t("common.tryAgain", "Try again")}
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="border border-dashed border-border p-12 text-center">
            <Rss className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2" style={bodyFont}>No posts yet</p>
            <p className="text-xs text-muted-foreground" style={bodyFont}>Be the first to share something or discover photographers to follow.</p>
            <Link to="/discover" className="inline-block mt-4 text-[10px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
              Discover photographers
            </Link>
          </div>
        ) : (
          <>
            {/* THE OTHER HALF OF THE SAME FIX.
                We have posts — from the localStorage cache — but the refresh
                failed. Showing them silently would present a stale deal as if
                it were live; showing the error page instead would throw away
                content we already have. So: keep the posts, and say plainly
                that they are the saved ones. */}
            {isError && (
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="w-full mb-3 py-2 px-4 rounded-lg bg-muted/60 border border-border text-muted-foreground text-xs flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-50"
                style={bodyFont}
              >
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                {isFetching
                  ? t("common.loading", "Loading…")
                  : t("feed.error.stale", "Showing saved posts — tap to try again")}
              </button>
            )}

            {/* New posts available banner */}
            <AnimatePresence>
              {bufferedCount > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  onClick={handleShowNewPosts}
                  className="w-full mb-3 py-2.5 px-4 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/15 transition-colors"
                  style={headingFont}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  {bufferedCount === 1 ? "1 new post available" : `${bufferedCount} new posts available`}
                </motion.button>
              )}
            </AnimatePresence>

            <AnimatePresence mode="popLayout">
              {posts.map((post, i) => (
                <Fragment key={post.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(i, 5) * 0.03 }}
                  >
                    <PostCard
                      post={post}
                      currentUserId={user.id}
                      onReact={handleReact}
                      onUnreact={handleUnreact}
                      onDelete={handleDelete}
                      onShareToWall={handleShareToWall}
                      onCommentCountChange={handleCommentCountChange}
                      onShareCountChange={handleShareCountChange}
                      onContentChange={handleContentChange}
                    />
                  </motion.div>

                  {/*
                    FRIEND SUGGESTIONS AFTER THE 10th POST — app only.
                    Owner, 2026-08-04: "after 10 feed post show this kind of
                    left to right scrolled for friend suggestion."

                    `i === 9` is the tenth post (zero-based), so the rail sits
                    directly BELOW it. The component itself returns null on web
                    and when there is nobody to suggest, so this stays a single
                    honest condition here rather than three.
                  */}
                  {i === 9 && <FeedFriendSuggestions />}

                  {(() => {
                    // Picture #N in the Story Card library owns a fixed place:
                    // #1 after 2 posts, #2 after 5, #3 after 10, #4 after 15,
                    // then one every 10. slotForPostIndex is the inverse of that
                    // mapping, so the feed and the admin panel cannot disagree.
                    const slot = slotForPostIndex(i);
                    if (slot === null || !shouldShowFeedAd(i, posts.length)) return null;
                    return (
                      <div key={`feed-ad-${slot}`}>
                        <AdZone zone="story-card" slotIndex={slot} />
                      </div>
                    );
                  })()}
                </Fragment>
              ))}
            </AnimatePresence>

            {/* Infinite scroll sentinel */}
            <InfiniteScrollSentinel
              onLoadMore={fetchNextPage}
              hasNextPage={!!hasMore}
              isFetching={loadingMore}
              enabled={!loading}
              rootMargin="300px"
              showEndMarker={posts.length > 0}
            />
          </>
        )}
      </div>

      {/* Back to top */}
      <AnimatePresence>
        {showBackToTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-20 left-4 lg:bottom-6 lg:left-auto lg:right-6 z-[35] p-2.5 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-colors"
            aria-label="Back to top"
          >
            <ArrowUp className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
    </PullToRefresh>
  );
};

export default Feed;
