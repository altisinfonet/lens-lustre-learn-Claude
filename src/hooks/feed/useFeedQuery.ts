import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { persistFeedPage, getCachedFeed } from "@/lib/feedCache";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";
import type { ReactionType } from "@/components/ReactionPicker";

const PAGE_SIZE = 10;

import type { UnifiedPost } from "@/types/post";

export type FeedPost = UnifiedPost & { is_suggested: boolean };

/* ── Helpers ── */

/**
 * Friends + followed users + self. Used ONLY to label posts as
 * `is_suggested` (author outside the user's network) — it no longer
 * restricts what appears in the feed.
 */
async function fetchRelevantUsers(userId: string): Promise<string[]> {
  const [followsRes, friendsRes] = await Promise.all([
    supabase.from("follows").select("following_id").eq("follower_id", userId),
    supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
  ]);
  const followedIds = new Set((followsRes.data || []).map((f) => f.following_id));
  const friendIds = new Set<string>();
  (friendsRes.data || []).forEach((f) => {
    if (f.requester_id === userId) friendIds.add(f.addressee_id);
    else friendIds.add(f.requester_id);
  });
  return Array.from(new Set([...followedIds, ...friendIds, userId]));
}

/**
 * BROADCAST + NEVER-REPEAT FEED (owner-approved spec, 2026-07-30).
 *
 * One RPC call per page. The database returns, in order:
 *   Tier 0 "newest"   — the newest posts, pinned to the top of page 1 only.
 *   Tier 1 "unseen"   — every visible post the user has never viewed,
 *                       fewest total viewers first.
 *   Tier 2 "recycled" — when unseen runs out: already-seen posts,
 *                       least-recently-seen first. The feed never runs dry.
 *
 * `excludeIds` = posts already delivered in THIS scroll session, so a
 * post is never repeated while the user keeps scrolling.
 */

/**
 * How many of the newest posts are pinned to the very top of the FIRST page.
 *
 * Owner order, 2026-08-05: "last post will be seen 1st on refresh … on app and
 * web 1st loading always current posts 1st" — and, in the same sentence,
 * "every pic must be maximum interaction try method".
 *
 * Three, not ten: pinning the whole page would turn the feed back into a plain
 * newest-first list and throw away the maximum-visibility deal he asked for in
 * the second half of the sentence. Three answers "what's new" on the opening
 * screen and leaves 7 of the first 10 to the fairness shuffle.
 *
 * Only page 0 gets them. Later pages pass 0, because pinning the newest posts
 * again further down would show them twice.
 */
const NEWEST_PINNED_ON_FIRST_PAGE = 3;

async function fetchBroadcastPage(excludeIds: string[], newestFirst: number): Promise<any[]> {
  const { data, error } = await supabase.rpc("get_broadcast_feed" as any, {
    _exclude_ids: excludeIds,
    _limit: PAGE_SIZE,
    _newest_first: newestFirst,
  });
  if (error || !data) {
    console.error("get_broadcast_feed RPC failed, falling back to chronological:", error);
    // Explicit fallback (used only if the DB function is not deployed yet):
    // plain newest-first public posts. RLS still enforces privacy.
    let query = supabase
      .from("posts")
      .select("id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count, shares_count")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (excludeIds.length > 0) {
      query = query.not("id", "in", `(${excludeIds.join(",")})`);
    }
    const { data: fallback } = await query;
    return fallback || [];
  }
  return data as any[];
}

/** Reduced enrichment — uses precomputed counts, fewer queries */
async function enrichPosts(
  postsData: any[],
  networkIds: string[],
  currentUserId: string,
): Promise<FeedPost[]> {
  if (postsData.length === 0) return [];

  const authorIds = [...new Set(postsData.map((p) => p.user_id))];
  const postIds = postsData.map((p) => p.id);

  // 3 queries instead of 4: merge reaction queries into ONE, filter user reactions client-side
  // Plus one small query for friendship state, so the "Add friend" button is
  // never offered for someone a friendship row already exists with.
  const [profileMapRes, allReactionsRes, adminIds, friendshipsRes, viewCountsRes] =
    await Promise.all([
      fetchProfileMap(authorIds),
      supabase.from("post_reactions").select("post_id, reaction_type, user_id").in("post_id", postIds),
      getAdminIds(),
      supabase
        .from("friendships")
        .select("requester_id, addressee_id, status")
        .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`),
      // REAL view counts (distinct viewers from feed_events, author excluded).
      // Replaces the simulated 2K-100K figures removed on 2026-07-31.
      supabase.rpc("get_post_view_counts" as never, { _post_ids: postIds } as never),
    ]);

    const viewCountMap = new Map<string, number>();
    ((viewCountsRes as { data?: { post_id: string; views: number }[] })?.data || [])
      .forEach((r) => viewCountMap.set(r.post_id, r.views ?? 0));

  // authorId -> friendship state with the current viewer
  const friendStateMap = new Map<string, "sent" | "received" | "friends">();
  (friendshipsRes.data || []).forEach((f: any) => {
    const other = f.requester_id === currentUserId ? f.addressee_id : f.requester_id;
    if (f.status === "accepted") friendStateMap.set(other, "friends");
    else if (f.requester_id === currentUserId) friendStateMap.set(other, "sent");
    else friendStateMap.set(other, "received");
  });

  const profileMap = profileMapRes;

  const reactionTypeCounts: Record<string, Record<string, number>> = {};
  const userReactionMap = new Map<string, string>();
  (allReactionsRes.data || []).forEach((r: any) => {
    if (!reactionTypeCounts[r.post_id]) reactionTypeCounts[r.post_id] = {};
    reactionTypeCounts[r.post_id][r.reaction_type] =
      (reactionTypeCounts[r.post_id][r.reaction_type] || 0) + 1;
    // Extract current user's reaction from the same result set
    if (r.user_id === currentUserId) {
      userReactionMap.set(r.post_id, r.reaction_type);
    }
  });

  return postsData.map((p) => {
    const userRx = userReactionMap.get(p.id) as ReactionType | undefined;
    const typeCounts = reactionTypeCounts[p.id] || {};
    const topReactions = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);
    const imageUrls =
      p.image_urls?.length > 0 ? p.image_urls : p.image_url ? [p.image_url] : [];
    return {
      ...p,
      image_urls: imageUrls,
      author_name: resolveName(
        p.user_id,
        profileMap.get(p.user_id)?.full_name ?? null,
        adminIds,
      ),
      author_avatar: profileMap.get(p.user_id)?.avatar_url || null,
      author_last_active: profileMap.get(p.user_id)?.last_active_at ?? null,
      author_badges: resolveBadges(
        p.user_id,
        profileMap.get(p.user_id)?.badges || [],
        adminIds,
      ),
      like_count: p.likes_count || 0,
      comment_count: p.comments_count || 0,
      share_count: p.shares_count || 0,
      is_liked: !!userRx,
      user_reaction: userRx || null,
      top_reactions: topReactions,
      reaction_counts: typeCounts,
      is_suggested: !networkIds.includes(p.user_id),
      // POLICY: the official/admin account can be FOLLOWED but never friended.
      // useFriendFollow already enforced this on profiles; the feed's Add-friend
      // button bypassed it (owner report 2026-07-31), so it is enforced here too.
      friend_state: adminIds.has(p.user_id)
        ? ("unavailable" as const)
        : (friendStateMap.get(p.user_id) ?? "none"),
      views: viewCountMap.get(p.id) ?? 0,
    };
  });
}

/**
 * Diversity rule kept from the previous ranking engine: no same author
 * back-to-back. Reorders WITHIN the page only; `prevAuthor` carries the
 * last author of the previous page so the rule also holds across the
 * page boundary. If every remaining post is by the same author the rule
 * is unavoidable and posts are emitted as-is.
 */
function reorderNoBackToBack<T extends { user_id: string }>(
  posts: T[],
  prevAuthor: string | null,
): T[] {
  const result: T[] = [];
  const pool = [...posts];
  let last = prevAuthor;
  while (pool.length > 0) {
    let idx = pool.findIndex((p) => p.user_id !== last);
    if (idx === -1) idx = 0; // all remaining posts share one author — unavoidable
    const [p] = pool.splice(idx, 1);
    result.push(p);
    last = p.user_id;
  }
  return result;
}

/* ── The hook ── */

interface FeedPage {
  posts: FeedPost[];
  nextCursor: number | null;
  networkIds: string[];
}

export function useFeedQuery(userId: string | undefined) {
  const networkIdsRef = useRef<string[]>([]);
  // Snapshot of delivered post ids BEFORE each page, keyed by page index.
  // Makes React Query page refetches deterministic (a refetch of page N
  // re-uses exactly the exclude list page N was originally fetched with).
  const excludeByPageRef = useRef<Map<number, string[]>>(new Map());
  // Last author of the previous page — lets the no-back-to-back rule
  // hold across page boundaries.
  const lastAuthorByPageRef = useRef<Map<number, string | null>>(new Map());

  // Build placeholderData from localStorage cache for instant render
  const placeholderData = useMemo(() => {
    if (!userId) return undefined;
    const cached = getCachedFeed(userId);
    if (!cached) return undefined;
    return {
      pages: [{
        posts: cached.posts as FeedPost[],
        nextCursor: 1 as number | null,
        networkIds: cached.networkIds,
      }],
      pageParams: [0],
    };
  }, [userId]);

  return useInfiniteQuery<FeedPage, Error>({
    queryKey: queryKeys.feed(),
    enabled: !!userId,
    placeholderData,

    /**
     * THE FEED IS NEVER FRESH. Owner spec, restated 2026-08-05:
     * "on every refresh changing is must to ensure maximum visibility of all
     *  posts, not newer one."
     *
     * MEASURED ON PRODUCTION, 2026-08-05, and the split matters:
     *
     *   * The DATABASE half works. `get_broadcast_feed` is VOLATILE and
     *     re-deals on every call — three consecutive calls as the same member
     *     returned 10 posts each and shared only 1, then 0. The 2026-08-04
     *     reshuffle migration is intact.
     *   * The CLIENT half was throwing that away. `App.tsx` sets a global
     *     `staleTime: 5 * 60 * 1000`, and this query never overrode it. So for
     *     five minutes React Query considered the feed fresh and would not
     *     refetch — leave /feed for a profile, come back, and you are handed
     *     the identical deal from cache. The database had already shuffled;
     *     nobody asked it.
     *
     * `staleTime: 0` + `refetchOnMount: "always"` makes returning to the feed
     * deal a new hand, which is what the owner asked for. Pull-to-refresh
     * already worked (it calls `refetch()` explicitly) — this fixes every OTHER
     * way a member arrives at the feed.
     *
     * Cost, stated plainly: one extra RPC + enrichment per feed mount. That is
     * the price of the requirement; the 5-minute cache was buying staleness,
     * not speed, because `placeholderData` above already gives an instant
     * first paint from localStorage.
     */
    staleTime: 0,
    refetchOnMount: "always",

    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const pageIndex = (pageParam as number | undefined) ?? 0;
      const isFirstPage = pageIndex === 0;

      if (isFirstPage) {
        // Network list is fetched ONLY to label `is_suggested`.
        const networkIds = await fetchRelevantUsers(userId!);
        networkIdsRef.current = networkIds;
        excludeByPageRef.current = new Map([[0, []]]);
        lastAuthorByPageRef.current = new Map([[0, null]]);
      }

      const networkIds = networkIdsRef.current;
      const excludeIds = excludeByPageRef.current.get(pageIndex) ?? [];

      const rawPosts = await fetchBroadcastPage(
        excludeIds,
        isFirstPage ? NEWEST_PINNED_ON_FIRST_PAGE : 0,
      );

      if (rawPosts.length === 0) {
        // Everything visible has been delivered this session — feed end.
        // (Tier 2 recycling already happened server-side, so reaching here
        // means the user scrolled through literally every visible post twice.)
        return { posts: [], nextCursor: null, networkIds };
      }

      const enriched = await enrichPosts(rawPosts, networkIds, userId!);

      // Keep server order (tier + fairness), then apply the one client-side
      // rule: no same author back-to-back.
      const prevAuthor = lastAuthorByPageRef.current.get(pageIndex) ?? null;
      const ordered = reorderNoBackToBack(enriched, prevAuthor);

      // Record state snapshots for the NEXT page.
      excludeByPageRef.current.set(
        pageIndex + 1,
        [...excludeIds, ...ordered.map((p) => p.id)],
      );
      lastAuthorByPageRef.current.set(
        pageIndex + 1,
        ordered.length > 0 ? ordered[ordered.length - 1].user_id : prevAuthor,
      );

      // Persist first page to localStorage for instant load next visit
      if (isFirstPage && ordered.length > 0) {
        persistFeedPage(ordered, networkIds, userId!);
      }

      return {
        posts: ordered,
        nextCursor: pageIndex + 1,
        networkIds,
      };
    },

    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
  });
}

export function flattenFeedPages(pages: FeedPage[] | undefined): FeedPost[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const result: FeedPost[] = [];
  for (const page of pages) {
    for (const post of page.posts) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        result.push(post);
      }
    }
  }
  return result;
}

export function getNetworkIds(pages: FeedPage[] | undefined): string[] {
  return pages?.[0]?.networkIds ?? [];
}
