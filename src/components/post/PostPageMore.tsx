/**
 * S4-a · UNDER A POST, THE INSTAGRAM WAY.
 *
 * Open a post and keep scrolling: first "More posts from <name>" — the
 * author's other posts, newest first, without the one on screen — then the
 * ordinary feed carries on beneath it. A post page is never a dead end.
 *
 * Nothing here is a second copy of anything:
 *   · the author's posts come through the wall's own read
 *     (useUserPostsQuery, own posts only) and draw in the wall's own grid
 *     (ProfilePostGrid) — so privacy is the posts table's, as on the wall;
 *   · the feed beneath is the feed's own read (usePostPageFeed, beside
 *     useFeedQuery) drawn with the ONE post card;
 *   · paging is the shared InfiniteScrollSentinel.
 *
 * Signed out, the feed beneath is not shown (as /feed is not); the author's
 * public posts still are, by the same rules as their wall.
 */
import { useCallback, useMemo } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import ProfileLink from "@/components/ProfileLink";
import ProfilePostGrid from "@/components/profile/ProfilePostGrid";
import PostCard from "@/components/post/PostCard";
import InfiniteScrollSentinel from "@/components/InfiniteScrollSentinel";
import { useUserPostsQuery, flattenUserPosts } from "@/hooks/feed/useUserPostsQuery";
import { usePostPageFeed, type FeedPost } from "@/hooks/feed/useFeedQuery";
import { useReactToPost, useUnreactToPost } from "@/hooks/feed/usePostReactionMutations";
import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";

const headingFont = { fontFamily: "var(--font-heading)" };

/** Instagram shows two rows of three. */
export const MORE_FROM_AUTHOR = 6;

interface Props {
  postId: string;
  authorId: string;
  authorName: string | null;
  authorHandle: string | null;
  currentUserId: string | undefined;
}

type PageFeed = InfiniteData<{ posts: FeedPost[]; nextCursor: number | null; seen: string[] }, number>;

const PostPageMore = ({ postId, authorId, authorName, authorHandle, currentUserId }: Props) => {
  const { blockedIds } = useBlockedUsers();

  // ── More posts from <name> ────────────────────────────────────────────────
  const own = useUserPostsQuery(authorId, currentUserId, { ownOnly: true });
  const morePosts = useMemo(
    () => flattenUserPosts(own.data?.pages).filter((p) => p.id !== postId).slice(0, MORE_FROM_AUTHOR),
    [own.data, postId],
  );

  // ── The feed beneath ──────────────────────────────────────────────────────
  const qc = useQueryClient();
  const feedKey = useMemo(() => ["post-page-feed", currentUserId ?? "", postId], [currentUserId, postId]);
  const feed = usePostPageFeed(currentUserId, postId);
  const shown = new Set([postId, ...morePosts.map((p) => p.id)]);
  const feedPosts = (feed.data?.pages ?? [])
    .flatMap((p) => p.posts)
    .filter((p, i, all) => !shown.has(p.id) && !blockedIds.has(p.user_id) && all.findIndex((q) => q.id === p.id) === i);

  /** Every change a card reports lands on THIS list's cache entry — the feed's own entry is never touched. */
  const mapPosts = useCallback(
    (mapper: (p: FeedPost) => FeedPost) =>
      qc.setQueryData<PageFeed>(feedKey, (old) =>
        old ? { ...old, pages: old.pages.map((pg) => ({ ...pg, posts: pg.posts.map(mapper) })) } : old,
      ),
    [qc, feedKey],
  );
  const react = useReactToPost<FeedPost>(mapPosts);
  const unreact = useUnreactToPost<FeedPost>(mapPosts);

  const name = authorName?.trim() || "this member";

  return (
    <>
      {morePosts.length > 0 && (
        <section aria-labelledby="more-from-author" data-testid="more-posts-from" className="mt-8">
          <h2
            id="more-from-author"
            className="px-2 md:px-0 mb-3 text-xs tracking-[0.12em] uppercase text-muted-foreground"
            style={headingFont}
          >
            More posts from{" "}
            <ProfileLink userId={authorId} handle={authorHandle} className="text-foreground hover:text-primary">
              {name}
            </ProfileLink>
          </h2>
          <ProfilePostGrid posts={morePosts} />
        </section>
      )}

      {currentUserId && (feedPosts.length > 0 || !!feed.hasNextPage) && (
        <section aria-label="More from your feed" data-testid="post-page-feed" className="mt-8 border-t border-border pt-6 space-y-4">
          {feedPosts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              currentUserId={currentUserId}
              onReact={(id, type) =>
                react.mutate({ postId: id, reactionType: type, hadPreviousReaction: !!p.user_reaction })
              }
              onUnreact={(id) => unreact.mutate(id)}
              onCommentCountChange={(id, delta) =>
                mapPosts((x) => (x.id === id ? { ...x, comment_count: Math.max(0, (x.comment_count ?? 0) + delta) } : x))
              }
              onShareCountChange={(id, delta) =>
                mapPosts((x) => (x.id === id ? { ...x, share_count: Math.max(0, (x.share_count ?? 0) + delta) } : x))
              }
              onContentChange={(id, content) => mapPosts((x) => (x.id === id ? { ...x, content } : x))}
            />
          ))}
          <InfiniteScrollSentinel
            onLoadMore={() => feed.fetchNextPage()}
            hasNextPage={!!feed.hasNextPage}
            isFetching={feed.isFetchingNextPage}
            showEndMarker={false}
          />
        </section>
      )}
    </>
  );
};

export default PostPageMore;
