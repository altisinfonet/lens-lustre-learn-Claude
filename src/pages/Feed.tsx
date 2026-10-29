import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import PendingPhotoPosts from "@/components/upload/PendingPhotoPosts";
import { useQuery } from "@tanstack/react-query";

import { useFeedRealtime } from "@/hooks/feed/useRealtimeFeed";
import { useNewPostsBanner } from "@/hooks/feed/useNewPostsBanner";
import { useFeedEventTracker } from "@/hooks/feed/useFeedEventTracker";
import { FeedSignalsContext } from "@/hooks/feed/FeedSignalsContext";
import { useNewPostsCount } from "@/hooks/feed/useNewPostsCount";
import FeedSeenObserver from "@/components/feed/FeedSeenObserver";
import NewPostsPill from "@/components/feed/NewPostsPill";
import { Link, useNavigate, useNavigationType } from "react-router-dom";
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
import { slotForPostIndex, shouldShowFeedAd } from "@/lib/ads/feedAdPlacement";
import { useT } from "@/i18n/I18nContext";
import { motion, AnimatePresence } from "framer-motion";
import { useActivityLog } from "@/hooks/core/useActivityLog";
import { useScrollRestoreOnReturn } from "@/hooks/core/useScrollRestoreOnReturn";
import { useFeedQuery, useFeedRefresh, flattenFeedPages, getNetworkIds, type FeedPost } from "@/hooks/feed/useFeedQuery";
import { useFeedCacheUpdaters } from "@/hooks/feed/useFeedCacheUpdaters";
import PostCard from "@/components/post/PostCard";
import { fetchPostAttachments, attachmentsFor } from "@/lib/posts/postAttachments";
import PostCardSkeleton from "@/components/post/PostCardSkeleton";
import WallPosts from "@/components/WallPosts";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import CategoryStrip from "@/components/feed/CategoryStrip";
import FeedTabs, { useFeedTab } from "@/components/feed/FeedTabs";
import { useHideAndMute } from "@/hooks/feed/useHideAndMute";
import FeedCardWindow, { EAGER_CARDS } from "@/components/feed/FeedCardWindow";
import { ALL_FILTER } from "@/lib/categories";
import { mapServerCounts, applyReactionDelta } from "@/lib/feed/realtimeCounts";
import type { ReactionType } from "@/components/ReactionPicker";
import type { UnifiedPost } from "@/types/post";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

const Feed = () => {
  const { user, loading: authLoading } = useAuth();
  const { isBanned } = useIsBanned();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  // L1 · B1: Back (POP) returns to the deal on screen; a fresh visit deals new (useFeedQuery).
  const navigationType = useNavigationType();
  const { log } = useActivityLog();
  const t = useT();
  const { insertPost, replacePost, patchPost, removePost } = useFeedCacheUpdaters();
  const { bufferedIds, bufferPost, flushBuffer } = useNewPostsBanner();
  /**
   * Stage L2 (F-REV4-8, cause 1) — "seen" is recorded. Until now this line took
   * trackViewStart/trackViewEnd and nothing ever called them, so the database
   * never learned what a member had seen. Every card is now wrapped in a
   * FeedSeenObserver below; the tracker sends through the OFF-2 outbox.
   */
  const tracker = useFeedEventTracker(user?.id);
  const { trackAction, trackWatch, trackShareClick } = tracker;
  /** S12-F1 · video watch % and "Copy link" reach the same tracker from inside PostCard. */
  const feedSignals = useMemo(() => ({ watch: trackWatch, shareClick: trackShareClick }), [trackWatch, trackShareClick]);
  /**
   * Stage D — the selected category strip chip.
   *
   * ALL_FILTER means no predicate at all, which is why it is translated to
   * `null` rather than an empty array: `null` skips the filter entirely in the
   * RPC and keeps every uncategorised post visible, while `[]` would match
   * nothing. The distinction is the whole reason old posts still appear.
   */
  const [activeCategory, setActiveCategory] = useState<string>(ALL_FILTER);
  /** S12-F5 · For you / Following / Favourites — shown only while personal_feed is on for this member. */
  const { tab: feedTab, setTab: setFeedTab, showTabs } = useFeedTab();
  /** S12-F5 · ⋯ → Not interested / Mute: the card goes at once, with Undo. */
  const { notInterested, mute, isHidden } = useHideAndMute(user?.id);
  const feedCategories = useMemo(() => (activeCategory === ALL_FILTER ? null : [activeCategory]), [activeCategory]);

  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
    // The feed can FAIL, and until 2026-08-13 this page had no idea that was
    // possible — see the error branch below.
    isError,
    isFetching,
  } = useFeedQuery(user?.id, feedCategories, navigationType, feedTab);
  const refreshFeed = useFeedRefresh(feedCategories, feedTab);

  /**
   * Stage L2 · ONE way to deal a new hand: pull-to-refresh, the "new posts"
   * pill, the retry buttons and the refresh after the member's own post all
   * come here.
   *   1. send what was just seen, FIRST (bounded wait), so the new deal already
   *      knows not to lead with it;
   *   2. ask for the new deal — the feed restarts from its first page with a
   *      new session seed (useFeedRefresh);
   *   3. only when it has ARRIVED, start a new seen-session, so the posts of
   *      the new deal can be recorded (again). Not before: on a slow link the
   *      old cards are still on screen while the request is out, and resetting
   *      first would record every one of them a second time.
   * A refresh that did not arrive changes nothing: the posts stay, the "new
   * posts" count stays, and the screen says so (`refreshFailed`, below).
   *
   * It is called `refetch` because it IS this screen's refetch: it replaces the
   * React Query `refetch` that pull-to-refresh, the retry button and the
   * own-post refresh used to call (that one only re-read the pages still held
   * — never page 0 once `maxPages` had dropped it — and sent nothing that was
   * seen). The pull-to-refresh wrapper keeps its exact pre-L2 form, which
   * instagramChrome.test.ts and feedFreshness.test.ts pin.
   */
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refetch = useCallback(async () => {
    await tracker.flushNow();
    const dealt = await refreshFeed();
    setRefreshFailed(!dealt);
    if (dealt) {
      flushBuffer();
      tracker.newSession();
    }
  }, [tracker, flushBuffer, refreshFeed]);

  // Blocked members' posts leave the feed the instant the block exists (App
  // Store guideline 1.2) — filtered here, over the cached pages, so there is no
  // refetch and no flash of the content.
  const { blockedIds } = useBlockedUsers();
  const posts = useMemo(() => {
    const all = flattenFeedPages(data?.pages);
    // S12-F5: and the posts hidden / authors muted from the ⋯ menu (Undo brings them back).
    return all.filter((p) => !blockedIds.has(p.user_id) && !isHidden(p));
  }, [data?.pages, blockedIds, isHidden]);
  const relevantUserIds = useMemo(() => getNetworkIds(data?.pages), [data?.pages]);

  /**
   * Stage L2 · "N new posts": ids from the 60-second light count, plus (on live,
   * where `posts` is in the realtime publication) posts that arrived by
   * realtime — minus anything already in the feed. The list itself never
   * moves; the posts arrive when the member taps the pill or pulls to refresh.
   */
  const firstPage = data?.pages?.[0];
  const polledNew = useNewPostsCount({
    userId: user?.id,
    categories: feedCategories,
    watermark: firstPage?.watermark,
    sessionKey: firstPage?.sessionSeed,
  });
  const newPostCount = useMemo(() => {
    const inFeed = new Set(posts.map((p) => p.id));
    // A blocked member's new post is not "new for you": a refresh would not show it.
    const polledIds = polledNew.filter((p) => !blockedIds.has(p.user_id)).map((p) => p.id);
    // S12-F5: the count is For you's; Following / Favourites refresh by pull.
    if (feedTab !== "for_you") return 0;
    return new Set([...bufferedIds, ...polledIds].filter((id) => !inFeed.has(id))).size;
  }, [bufferedIds, polledNew, posts, blockedIds, feedTab]);
  /** A page on screen came from the DB-3004 chronological fallback: it is not the feed, so say so. */
  // S7b-3: posts read from the phone are the saved ones, not the live feed.
  const servedStale = data?.pages?.some((p) => p.degraded === true || p.offline === true) ?? false;

  const reactMutation = useReactToPost();
  const unreactMutation = useUnreactToPost();

  // L1: coming Back to the feed (from a post, a profile, anywhere) puts the
  // member where they were — see useScrollRestoreOnReturn.ts for why the
  // browser alone cannot.
  useScrollRestoreOnReturn();

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

  /**
   * Posts that arrived by realtime, with their photographs and video read
   * through postAttachments in ONE batched call. A post whose video this viewer
   * may not play is dropped (attached === null), never shown empty. If the
   * read fails, the posts keep what their rows carry.
   */
  const attachLive = useCallback(async (live: FeedPost[]): Promise<FeedPost[]> => {
    if (live.length === 0) return [];
    try {
      const a = await fetchPostAttachments(live.map((p) => p.id));
      return live.flatMap((p) => {
        const attached = attachmentsFor(a, p.id, p.image_urls);
        if (attached === null) return [];
        return [{ ...p, image_urls: attached.image_urls, video: attached.video }];
      });
    } catch {
      return live;
    }
  }, []);

  const handleNewPost = useCallback(async (rawPost: any) => {
    const legacyImageUrls: string[] = rawPost.image_urls?.length > 0 ? rawPost.image_urls : rawPost.image_url ? [rawPost.image_url] : [];
    const fp: FeedPost = {
      id: rawPost.id,
      user_id: rawPost.user_id,
      content: rawPost.content || "",
      image_url: rawPost.image_url || null,
      image_urls: legacyImageUrls,
      video: null,
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
      // VID-1 · photographs AND video through the one reader every surface
      // uses. A video post arriving live used to show as an empty text post
      // until a refresh: the bare row carries no video. Other people's posts
      // are read in ONE batch when the banner is tapped (handleShowNewPosts) —
      // not two reads per post on every open feed (review #415).
      const [withMedia] = await attachLive([fp]);
      if (!withMedia) return; // a video this viewer may not play: no empty post
      insertPost(withMedia);
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.setTimeout(() => { void refetch(); }, 5000);
    } else {
      bufferPost(fp);
    }
  }, [relevantUserIds, bufferPost, insertPost, refetch, user?.id, attachLive]);

  /**
   * A realtime `posts` UPDATE is now the ONLY writer of the three counters.
   *
   * `mapServerCounts` exists because the table spells them `likes_count` /
   * `comments_count` / `shares_count` and this type spells them `like_count` /
   * `comment_count` / `share_count`. The old plain spread therefore dropped
   * every authoritative count on the floor — see realtimeCounts.ts.
   *
   * For your OWN post only the counters are taken. The content is whatever you
   * just typed; a server row arriving mid-edit must not overwrite it.
   */
  const handleUpdatePost = useCallback((rawPost: any, isOwnPost: boolean) => {
    patchPost(rawPost.id, (current) =>
      isOwnPost
        ? mapServerCounts(rawPost)
        : {
            ...current,
            ...rawPost,
            ...mapServerCounts(rawPost),
            image_urls: rawPost.image_urls?.length > 0 ? rawPost.image_urls : rawPost.image_url ? [rawPost.image_url] : [],
          },
    );
  }, [patchPost]);

  /**
   * ⚠ THIS NO LONGER TOUCHES `like_count`, AND THAT IS THE POINT.
   *
   * One reaction fires TWO events: this delta, and a `posts` UPDATE carrying
   * the absolute count (trg_update_post_likes_count writes it). Applying both
   * makes the number wrong by one whenever the absolute lands first. The
   * absolute wins; this keeps only the per-type breakdown, which `posts` does
   * not carry. Guarded by realtimeCounts.test.ts.
   */
  const handleReactionChange = useCallback((postId: string, event: "INSERT" | "DELETE", reaction: any) => {
    const reactionType = reaction?.reaction_type as string | undefined;
    patchPost(postId, (current) =>
      applyReactionDelta(current.reaction_counts, reactionType, event),
    );
  }, [patchPost]);

  // S6-b: the posts on screen are the posts watched live (filtered bindings).
  const watchPostIds = useMemo(() => posts.map((p) => p.id), [posts]);
  useFeedRealtime({
    userId: user?.id,
    relevantUserIds,
    watchPostIds,
    onNewPost: handleNewPost,
    onUpdatePost: handleUpdatePost,
    onReactionChange: handleReactionChange,
  });

  /**
   * Stage L2 · tapping the pill is a refresh from the top: the new posts are
   * newest and unseen, so the new deal leads with them (R-LIVE-5). It used to
   * splice realtime rows in above the current list; the polled count has only
   * ids, and one path for both keeps "what arrives" identical on web and app.
   */
  const handleShowNewPosts = useCallback(async () => {
    window.scrollTo({ top: 0 });
    await refetch();
  }, [refetch]);

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
          {showTabs && <FeedTabs value={feedTab} onChange={setFeedTab} />}
          <CategoryStrip value={activeCategory} onChange={setActiveCategory} />
          {/* Stage L2 — floats just below the strip (absolute; the sticky strip
              is its containing block), so it never moves the list. It still
              animates in and out, as the banner it replaces did. It starts at
              opacity 0 only because it is SUMMONED (rendered only while there
              are new posts) — the animation props sit right under that
              condition, where contentNeverStartsInvisible.test.tsx looks for
              it, the same shape the banner had. */}
          <AnimatePresence>
            {newPostCount > 0 && (
              <NewPostsPill
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                key="new-posts-pill"
                count={newPostCount}
                onClick={() => void handleShowNewPosts()}
                label={(n) => (n === 1 ? t("feed.newPosts.one", "1 new post") : t("feed.newPosts.many", "{n} new posts").replace("{n}", String(n)))}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Stories bar — everyone's public stories (official first, then followed by recency) */}
        <FeedStoriesBar />

        {/*
          No birthday box above the posts. Owner, 2026-10-29: "In web left card
          is okay but in App NO, Only Push Notification, Email are Okay."
          Phones and the app get birthdays by push and email; the desktop
          left-sidebar card stays. Guarded by noBirthdayBoxAboveFeed.test.ts.
        */}

        {/*
          NO HEADING AND NO REFRESH BUTTON. Owner, 2026-08-10, after seeing the
          build on his phone: "Dont Wrote News feed, your feed etc on the Top,
          refresh icon It must be like Instagram" — and, asked whether he meant
          the app only: "Dont show it anywhere neither on Web nor in App".

          What used to be here: a "NEWS FEED" eyebrow, a "Your Feed" h1 at
          text-lg/2xl, and a RefreshCw button.

          Nothing is lost by removing the button. This whole screen is already
          wrapped in <PullToRefresh onRefresh={async () => { await refetch(); }}> a few lines above, so
          pulling down still refreshes — which is exactly how Instagram does it
          and is why the button was redundant. The realtime handler asks for a
          refresh the same way, after the member's own post.

          Do not put a title back. Instagram's feed starts at the first post.
        */}

        {/*
          Composer — same as My Wall, posts go to posts table → appear on Wall + Feed

          WEB ONLY, from 2026-08-16. On the app the composer is now mounted once
          in the shell (see Layout.tsx / GlobalComposer.tsx) so the top bar's
          Create button works from every page instead of only this one. Leaving
          this mount in place as well would give the app TWO composers, both
          watching `?compose=1`, and both would open.

          The website keeps its inline composer row exactly as it was: it is the
          only way to post on the web, and it was never the thing that broke.
        */}
        {!isNativeCapacitorApp() && (
          <WallPosts targetUserId={user.id} isOwnWall composerOnly />
        )}

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
        ) : posts.length === 0 && feedTab !== "for_you" ? (
          <div className="border border-dashed border-border p-12 text-center" data-testid={`feed-empty-${feedTab}`}>
            <Rss className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2" style={bodyFont}>
              {feedTab === "following" ? "No posts from people you follow yet" : "No favourites yet"}
            </p>
            <p className="text-xs text-muted-foreground" style={bodyFont}>
              {feedTab === "following"
                ? "Follow photographers to see their newest posts here."
                : "Open a member's profile and tap ★ Add to Favourites to see their posts here, newest first."}
            </p>
            <Link to="/discover" className="inline-block mt-4 text-[10px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
              Discover photographers
            </Link>
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
            {/* Stage L2 — HONEST: a refresh that failed (or could not start: no
                network), or a page served by the DB-3004 chronological
                fallback, is not the feed. The posts stay (availability), and
                the screen says they are stale. */}
            {/* S7b-5b: posts with photos made offline, kept on the phone. */}
            <PendingPhotoPosts />
            {(isError || servedStale || refreshFailed) && (
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                data-testid="feed-refresh-failed"
                className="w-full mb-3 py-2 px-4 rounded-lg bg-muted/60 border border-border text-muted-foreground text-xs flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-50"
                style={bodyFont}
              >
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                {isFetching
                  ? t("common.loading", "Loading…")
                  : t("feed.refresh.failed", "Couldn't refresh — tap to retry")}
              </button>
            )}

            {/* The in-flow "N new posts available" banner that pushed the whole
                list down when it appeared is gone: Stage L2's NewPostsPill
                floats under the category strip instead. */}

            {/**
              * NO `AnimatePresence` HERE — and that is the fix, not an omission.
              *
              * It used to wrap this list, and it did two things: nothing, and
              * harm. Nothing, because `AnimatePresence` exists to run `exit`
              * animations and not one of the cards below has an `exit` prop —
              * their `initial`/`animate` entry animation works without it.
              * Harm, because `AnimatePresence` attaches a ref to each child to
              * measure it, each child here is a `<Fragment>` (it groups the
              * card with the friend rail and the ad slot), and a Fragment
              * cannot hold a ref. React 19 logged
              *   "Invalid prop `ref` supplied to `React.Fragment`"
              * once per post, every render, on every member's feed.
              *
              * Found by rendering the real feed in the screenshot harness and
              * reading the console. Removing the wrapper changes no pixel — it
              * removes an error and a measurement that was never used.
              */}
            {posts.map((post, i) => (
                <Fragment key={post.id}>
                  {/*
                    F-99 — STARTS VISIBLE. This is page-body content, and it is
                    the busiest page on the site.
                    Measured on deployed staging: TEN blocks of real post text
                    frozen at opacity ZERO, eight seconds after load. It was
                    `initial={{ opacity: 1, y: 12 }}`, so a reveal that never
                    completes leaves the member looking at an empty feed with
                    every post present in the DOM.
                    The feed is NOT one of the nine pages that declared their own
                    fadeUp — it declares this inline — which is why fixing those
                    nine would not have reached it. The rule is the pattern, not
                    the variable name: content animates from visible, decoration
                    may animate from nothing.
                  */}
                  <motion.div
                    initial={{ opacity: 1, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(i, 5) * 0.03 }}
                  >
                  {/* ⚠ THE WINDOW GOES INSIDE THE motion.div, NOT AROUND IT.
                      Put it outside and the motion.div unmounts with the card,
                      so its entry animation REPLAYS every time a member scrolls
                      back up — every card fading in again on the way up reads
                      as the feed reloading itself. Inside, the motion.div stays
                      mounted for the life of the post and only its contents
                      come and go. */}
                  <FeedSignalsContext.Provider value={feedSignals}>
                  <FeedSeenObserver postId={post.id} authorId={post.user_id} onVisibility={tracker.reportVisibility}>
                  <FeedCardWindow eager={i < EAGER_CARDS}>
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
                      onNotInterested={showTabs ? notInterested : undefined}
                      onMuteAuthor={showTabs ? mute : undefined}
                    />
                  </FeedCardWindow>
                  </FeedSeenObserver>
                  </FeedSignalsContext.Provider>
                  </motion.div>

                  {/* S12-F3 · personal feed only: the server marks the post after
                      which this session has no unseen friends/follows post left. */}
                  {post.caught_up_after && (
                    <div className="flex items-center gap-3 my-4" role="separator" data-testid="feed-caught-up">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-xs text-muted-foreground" style={bodyFont}>
                        {t("feed.caughtUp", "You're all caught up")}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}

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
            /* 44px. It was `p-2.5` around a 20px icon = 32x32, and it is a
               FLOATING button over the feed — nothing around it to aim at if
               the thumb misses, unlike a control sitting in a row. The disc
               grows from 32 to 44, which is the same size as every other
               round control in the app. `dock-fab` (src/lib/ui/bottomDock.ts):
               the same bottom-20 / lg:bottom-6, lifted above the server-video
               card or a banner while one shows. */
            className="fixed dock-fab left-4 lg:left-auto lg:right-6 z-[35] grid h-11 w-11 place-items-center bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-colors"
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
