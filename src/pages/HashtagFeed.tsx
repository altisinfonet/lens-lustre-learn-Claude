import { useParams, Link, useNavigate } from "react-router-dom";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Hash, ArrowLeft, Heart, Grid3x3, Rows3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";
import { toast } from "@/hooks/core/use-toast";
import { useFeedCacheUpdaters } from "@/hooks/feed/useFeedCacheUpdaters";
import { useReactToPost, useUnreactToPost } from "@/hooks/feed/usePostReactionMutations";
import { useFollowHashtag, useHashtagInfo, useHashtagPosts, type HashtagSort } from "@/hooks/feed/useHashtagPage";
import PostCard from "@/components/post/PostCard";
import ProfilePostGrid from "@/components/profile/ProfilePostGrid";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";
import type { WallView } from "@/components/profile/WallViewToggle";
import type { ReactionType } from "@/components/ReactionPicker";
import PageSEO from "@/components/PageSEO";
import { formatNumber } from "@/lib/postAnalytics";
import type { UnifiedPost } from "@/types/post";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const BRAND = "bg-gradient-to-br from-primary to-amber-400";

type Page = { posts: UnifiedPost[]; nextCursor: string | null };

/**
 * /hashtag/:tag — H1 (Owner plan 2026-11-09).
 *
 * Header: the tag, how many PHOTOGRAPHERS and posts carry it, Follow, related
 * tags. Then Top | Recent, shown as the wall's grid (ProfilePostGrid) or the
 * feed's card (PostCard) — no post markup of its own (central control K1;
 * HashtagFeedPostCard.test.tsx compares the card DOMs).
 */
const HashtagFeed = () => {
  const { tag: rawTag } = useParams<{ tag: string }>();
  // Sent as written: the server's normalize_hashtag alone decides which tags are
  // the same (hashtagRule.ts), so the page can never look up a different tag.
  const tag = rawTag ?? "";
  const { user, loading: authLoading } = useAuth();
  const { blockedIds } = useBlockedUsers();
  const { removePost } = useFeedCacheUpdaters();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [sort, setSort] = useState<HashtagSort>("top");
  const [view, setView] = useState<WallView>("grid");

  const ready = !authLoading;
  const info = useHashtagInfo(tag, user?.id, ready);
  const list = useHashtagPosts(tag, sort, user?.id, ready);
  const follow = useFollowHashtag(tag, user?.id);

  const queryKey = useMemo(() => ["hashtag-posts", tag, sort, user?.id ?? ""], [tag, sort, user?.id]);
  const posts = useMemo(() => {
    const seen = new Set<string>();
    const out: UnifiedPost[] = [];
    for (const page of list.data?.pages ?? []) for (const p of page.posts) {
      if (seen.has(p.id) || blockedIds.has(p.user_id)) continue;
      seen.add(p.id); out.push(p);
    }
    return out;
  }, [list.data, blockedIds]);

  /** Every change a card reports lands on this page's own list. */
  const mapPosts = useCallback(
    (mapper: (p: UnifiedPost) => UnifiedPost) => {
      qc.setQueryData<InfiniteData<Page>>(queryKey, (old) =>
        old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: pg.posts.map(mapper) })) } : old);
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
    qc.setQueryData<InfiniteData<Page>>(queryKey, (old) =>
      old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: pg.posts.filter((p) => p.id !== postId) })) } : old);
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

  const meta = info.data;
  const shown = meta?.display_tag || rawTag || tag;
  const loading = list.isPending || info.isPending;
  const isFollowing = !!meta?.is_following;
  const onFollow = () => {
    if (!user) { navigate("/login"); return; }
    follow.mutate(!isFollowing);
  };

  const tabBase = "relative flex min-h-11 items-center justify-center text-[14px] font-semibold transition-colors";
  const tabOn = "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[1.5px] after:bg-foreground";
  const tabOff = "text-muted-foreground/70 hover:text-foreground";

  return (
    <div className="py-3 md:py-10 max-w-2xl mx-auto" data-testid="hashtag-page">
      <PageSEO
        title={`#${shown || "hashtag"}`}
        description={`Photographs tagged #${shown} on 50mm Retina World.`}
      />

      {/* Header — tag, photographers · posts, Follow */}
      <div className="flex items-center gap-4">
        <span className={`grid h-[72px] w-[72px] md:h-20 md:w-20 shrink-0 place-items-center rounded-[20px] ${BRAND} text-white shadow-lg shadow-primary/30`}>
          <Hash className="h-8 w-8 md:h-9 md:w-9" strokeWidth={2.25} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] md:text-[26px] font-bold leading-tight text-foreground" style={headingFont}>#{shown}</h1>
          <p className="mt-0.5 text-[13px] md:text-sm text-muted-foreground" style={bodyFont} data-testid="hashtag-counts">
            {meta ? (
              <>
                <span className="font-semibold text-foreground">{formatNumber(meta.people_count)}</span> photographer{meta.people_count !== 1 ? "s" : ""}
                {" · "}
                <span className="font-semibold text-foreground">{formatNumber(meta.post_count)}</span> post{meta.post_count !== 1 ? "s" : ""}
              </>
            ) : loading ? "Searching…" : "No posts yet"}
          </p>
          <button
            type="button"
            onClick={onFollow}
            disabled={follow.isPending}
            aria-pressed={isFollowing}
            className={`mt-2.5 hidden md:inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-6 text-[14px] font-semibold transition-colors disabled:opacity-50 ${
              isFollowing ? "bg-muted text-foreground hover:bg-muted/80" : "bg-primary text-primary-foreground hover:opacity-90"
            }`}
            style={headingFont}
          >
            <Heart className={`h-3.5 w-3.5 ${isFollowing ? "fill-current" : ""}`} aria-hidden />
            {isFollowing ? "Following" : "Follow"}
          </button>
        </div>
      </div>
      {/* Phone: the same button, full width under the header (Instagram) */}
      <div className="mt-3 md:hidden">
        <button
          type="button"
          onClick={onFollow}
          disabled={follow.isPending}
          aria-pressed={isFollowing}
          className={`inline-flex h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[14px] font-semibold transition-colors disabled:opacity-50 ${
            isFollowing ? "bg-muted text-foreground hover:bg-muted/80" : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
          style={headingFont}
        >
          <Heart className={`h-3.5 w-3.5 ${isFollowing ? "fill-current" : ""}`} aria-hidden />
          {isFollowing ? "Following" : "Follow"}
        </button>
      </div>

      {/* Related tags */}
      {meta && meta.related.length > 0 && (
        <nav aria-label="Related hashtags" className="mt-4">
          <ul className="flex gap-2 overflow-x-auto pb-1 max-md:-mx-[calc((100vw-100%)/2)] max-md:px-[calc((100vw-100%)/2)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {meta.related.map((r) => (
              <li key={r.tag} className="shrink-0">
                <Link
                  to={`/hashtag/${encodeURIComponent(r.tag)}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-3 text-[13px] text-foreground hover:bg-muted"
                  style={bodyFont}
                >
                  <span className="font-medium">#{r.display_tag}</span>
                  <span className="text-muted-foreground">{formatNumber(r.post_count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Top | Recent  ·  grid | cards */}
      <div className="mt-4 flex w-full items-stretch border-b border-border/60">
        <div role="tablist" aria-label="Sort hashtag posts" className="grid flex-1 grid-cols-2">
          {(["top", "recent"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={sort === s} onClick={() => setSort(s)}
              className={`${tabBase} ${sort === s ? tabOn : tabOff}`} style={headingFont}>
              {s === "top" ? "Top" : "Recent"}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="Layout" className="flex shrink-0 border-l border-border/60">
          {([["grid", Grid3x3, "Grid"], ["feed", Rows3, "Cards"]] as const).map(([v, Icon, label]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} aria-label={label} onClick={() => setView(v)}
              className={`${tabBase} w-12 ${view === v ? tabOn : tabOff}`}>
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div className={view === "grid" ? "mt-0.5" : "mt-3"}>
        {loading ? (
          <div className="text-center py-16">
            <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>
              Loading...
            </span>
          </div>
        ) : posts.length === 0 ? (
          <div className="mt-3 border border-dashed border-border p-12 text-center rounded-lg">
            <Hash className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" style={bodyFont}>No posts with #{shown} yet</p>
            <Link to="/feed" className="inline-flex items-center gap-1.5 mt-4 text-sm text-primary hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to feed
            </Link>
          </div>
        ) : view === "grid" ? (
          <ProfilePostGrid posts={posts} />
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
        {posts.length > 0 && (
          <InfiniteScrollSentinel
            onLoadMore={() => { void list.fetchNextPage(); }}
            hasNextPage={!!list.hasNextPage}
            isFetching={list.isFetchingNextPage}
            showEndMarker={false}
            rootMargin="1200px"
          />
        )}
      </div>
    </div>
  );
};

export default HashtagFeed;
