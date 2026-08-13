import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { persistFeedPage, getCachedFeed } from "@/lib/feedCache";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";
import type { ReactionType } from "@/components/ReactionPicker";

import { logger } from "@/lib/logger";

const FILE = "src/hooks/feed/useFeedQuery.ts";

const PAGE_SIZE = 10;

import type { UnifiedPost, TaggedPerson } from "@/types/post";

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

async function fetchBroadcastPage(
  excludeIds: string[],
  newestFirst: number,
  categories: string[] | null,
): Promise<any[]> {
  /**
   * `_categories: null` is "All" — the RPC then applies no category predicate
   * at all, which is exactly what keeps posts created before this feature
   * visible. A category filter uses `&&`, which an empty array never matches.
   *
   * The 4-argument overload is called by name. The 3-argument one still exists
   * and still works, so an installed Android build carrying the old bundle is
   * unaffected until it is rebuilt.
   */
  const { data, error } = await supabase.rpc("get_broadcast_feed" as any, {
    _exclude_ids: excludeIds,
    _limit: PAGE_SIZE,
    _newest_first: newestFirst,
    _categories: categories,
  });
  if (error || !data) {
    logger.error({
      code: "DB-3004",
      event: "FEED_RPC_FELL_BACK_TO_CHRONOLOGICAL",
      fn: "fetchBroadcastPage",
      file: FILE,
      message: "The broadcast feed RPC failed; the feed fell back to plain newest-first.",
      reason: error ? (error.message ?? String(error)) : "The RPC returned no data",
      expected: "Fair ordering: unseen first, fewest viewers first, then newest",
      actual: "Plain chronological order",
      nextStep:
        "MEMBERS STILL SEE POSTS, so nobody reports this — but the fairness ordering that equalises reach is gone until it is fixed. Confirm get_broadcast_feed is still deployed.",
      detail: { excludedCount: excludeIds.length, pageSize: PAGE_SIZE },
    });
    // Explicit fallback (used only if the DB function is not deployed yet):
    // plain newest-first public posts. RLS still enforces privacy.
    let query = supabase
      .from("posts")
      .select("id, user_id, content, image_url, image_urls, thumbnail_urls, privacy, created_at, likes_count, comments_count, shares_count")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (excludeIds.length > 0) {
      query = query.not("id", "in", `(${excludeIds.join(",")})`);
    }
    // The fallback must respect the filter as well. Without this, an RPC
    // failure while a category is selected would quietly serve posts from
    // every category under that category's heading — the fallback is already
    // invisible to members, so a wrong-content version of it would be too.
    if (categories && categories.length > 0) {
      query = query.overlaps("categories", categories);
    }
    const { data: fallback, error: fallbackError } = await query;

    /**
     * ⚠ IF THE FALLBACK FAILS TOO, THROW. DO NOT RETURN [].
     *
     * Owner, 2026-08-12: *"when a bit slow network Facebook opening, reel
     * playing from youtube but 50mm retina posts not showing"*. This line was
     * the cause and it was mine.
     *
     * On a weak signal BOTH the RPC and this fallback time out. The old
     * `return fallback || []` turned that double failure into a perfectly
     * ordinary empty page — so the query resolved SUCCESSFULLY with zero posts
     * and the feed rendered "No posts yet. Be the first to share something."
     * The app told the member the platform was empty when the truth was that
     * one request had dropped. Nothing retried, because nothing had failed as
     * far as React Query could tell.
     *
     * Throwing is what makes the difference visible: React Query retries with
     * backoff, the cached first page stays on screen meanwhile, and if it still
     * cannot load, Feed.tsx shows "couldn't load — Try again" instead of a lie
     * about the content.
     *
     * An empty array is still returned when the query SUCCEEDS and there is
     * genuinely nothing there. "No posts" and "no answer" are different facts
     * and this is the line that stopped confusing them.
     */
    if (fallbackError) throw fallbackError;
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

  /**
   * ⚠ DOES THIS PAYLOAD CARRY THE AUTHOR'S IDENTITY?
   *
   * Owner, 2026-08-13: *"Why we cant show the names like FB and Insta ??"*
   *
   * Migration 20260813120000 made `get_broadcast_feed` return `author_name`,
   * `author_avatar`, `thumbnail_urls` and `categories`, so identity now arrives
   * WELDED to the post. Instagram and Facebook have always worked this way, and
   * it is the reason a post can never appear there without a name: there is no
   * second request to fail.
   *
   * Detected from the SHAPE of the row, not from a version constant. `"key" in
   * obj` is true when the column came back NULL, and false only when the
   * column does not exist — which is exactly the distinction needed. That makes
   * this file correct against the old RPC and the new one simultaneously, so
   * the migration and the bundle can ship in either order with no flag day.
   *
   * The fallback below is not decoration: `fetchBroadcastPage` has a
   * chronological fallback query that does NOT select these columns, so a page
   * served by it still resolves names the old way.
   */
  const first = postsData[0] ?? {};
  const rpcHasIdentity = "author_name" in first;
  const rpcHasThumbs = "thumbnail_urls" in first;

  // 3 queries instead of 4: merge reaction queries into ONE, filter user reactions client-side
  // Plus one small query for friendship state, so the "Add friend" button is
  // never offered for someone a friendship row already exists with.
  const [profileMapRes, allReactionsRes, adminIds, friendshipsRes, viewCountsRes, thumbsRes, tagsRes] =
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
      // STORED thumbnails (posts.thumbnail_urls). The broadcast-feed RPC does
      // not return this column and is flagged do-not-touch, so it is
      // batch-fetched here — one query per page, rides the same Promise.all.
      // RLS applies as normal; a post the RPC returned is a post this member
      // can read. If this query fails the feed simply shows originals.
      /**
       * ⚠ SKIPPED ENTIRELY once the RPC returns `thumbnail_urls` itself.
       *
       * As of migration 20260813120000 the feed RPC returns the column, so
       * asking `posts` for the same ten rows we were just handed is a wasted
       * round trip. `rpcHasThumbs` is decided from the payload rather than from
       * a version flag, so this works against BOTH definitions with no
       * coordination: an installed APK on the old bundle keeps making this
       * query, a new one never does, and neither knows about the other.
       */
      rpcHasThumbs
        ? Promise.resolve({ data: [] as { id: string; thumbnail_urls: (string | null)[] | null }[] })
        : supabase.from("posts").select("id, thumbnail_urls").in("id", postIds),
      // Owner ruling, 2026-08-10 (his second, final answer): "Show immediately
      // to public, but tagged person only can remove my Tag anytime." So a
      // pending tag is public the moment it is made, and the tagged member has
      // a Remove control on the post itself — see PostCard's menu.
      // `declined` and `removed` are refusals and are NEVER selected, by anyone.
      // One query per page, rides the same Promise.all.
      supabase
        .from("post_tags")
        .select("post_id, tagged_user_id, status")
        .in("post_id", postIds)
        .in("status", ["pending", "approved"]),
    ]);

  /**
   * post_id -> approved tags, name-resolved.
   *
   * The tagged people are usually NOT the post authors, so their names are not
   * in `profileMap` (which was built from authorIds). One extra profile fetch
   * is made, and ONLY when at least one approved tag exists on the page — a
   * feed with no tags costs nothing extra. fetchProfileMap is the same
   * entity-cached path the rest of the app uses, so names already on screen
   * elsewhere are served from cache rather than refetched.
   */
  const tagRows =
    ((tagsRes as { data?: { post_id: string; tagged_user_id: string; status: string }[] })?.data) || [];
  const taggedMap = new Map<string, TaggedPerson[]>();
  if (tagRows.length > 0) {
    const taggedIds = [...new Set(tagRows.map((r) => r.tagged_user_id))];
    const tagProfiles = await fetchProfileMap(taggedIds);
    for (const r of tagRows) {
      const list = taggedMap.get(r.post_id) || [];
      list.push({
        id: r.tagged_user_id,
        // Same rule as the author line: an admin is the brand, never a real name.
        name: resolveName(
          r.tagged_user_id,
          tagProfiles.get(r.tagged_user_id)?.full_name ?? null,
          adminIds,
        ),
        pending: r.status === "pending",
      });
      taggedMap.set(r.post_id, list);
    }
  }

  const thumbsMap = new Map<string, (string | null)[] | null>();
  ((thumbsRes as { data?: { id: string; thumbnail_urls: (string | null)[] | null }[] })?.data || [])
    .forEach((r) => thumbsMap.set(r.id, r.thumbnail_urls ?? null));

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
      thumbnail_urls: p.thumbnail_urls ?? thumbsMap.get(p.id) ?? null,
      /**
       * THE NAME COMES FROM THE POST'S OWN ROW FIRST.
       *
       * `p.author_name` was fetched in the same statement as the post, so it
       * cannot be missing while the post exists. The `profileMap` lookup is
       * kept only as the fallback for the chronological-fallback path and for
       * any installed build still on the 11-column RPC.
       *
       * `resolveName` still wraps it, and must: the rule that the official
       * account renders as the brand rather than a person's name lives in
       * adminBrand.ts and is deliberately NOT in SQL — the database would have
       * to know who the admins are, which is a second lookup and a second place
       * for that policy to drift.
       */
      author_name: resolveName(
        p.user_id,
        (rpcHasIdentity ? p.author_name : null) ??
          profileMap.get(p.user_id)?.full_name ??
          null,
        adminIds,
      ),
      author_avatar:
        (rpcHasIdentity ? p.author_avatar : null) ??
        profileMap.get(p.user_id)?.avatar_url ??
        null,
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
      tagged_people: taggedMap.get(p.id) ?? [],
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

/**
 * @param categories  Selected category slugs, or null/undefined for "All".
 *                    Phase B always passes null — the category strip that will
 *                    supply this is Phase D. It is threaded through now so the
 *                    cache key is correct from the first day rather than
 *                    retro-fitted onto a live cache.
 */
export function useFeedQuery(userId: string | undefined, categories?: string[] | null) {
  // Normalised once: sorted, empty treated as null, so the key and the RPC
  // argument can never disagree about what "no filter" means.
  const cats = categories && categories.length ? [...categories].sort() : null;
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
    queryKey: queryKeys.feed(cats),
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

    /**
     * THREE ATTEMPTS, BACKING OFF — because the failure being recovered from is
     * a weak mobile signal, not a broken endpoint.
     *
     * `App.tsx` sets a global `retry: 1`, which on a bad connection means one
     * immediate re-attempt over the same dead radio and then giving up. That is
     * barely a retry at all. The delays here (2s, 4s, 8s) are long enough for a
     * phone to actually reacquire a signal, which is the scenario the owner
     * reported.
     *
     * Still bounded. A genuinely dead RPC must fail and be SEEN, not hammered
     * forever behind a spinner.
     */
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),

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
        cats,
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
