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

/** FIX 3: Single RPC call replaces 3 separate queries */
async function fetchCandidatePool(networkIds: string[]): Promise<any[]> {
  const { data, error } = await supabase.rpc("get_feed_candidates", {
    _network_ids: networkIds,
  });

  if (error || !data) {
    console.error("get_feed_candidates RPC failed, falling back:", error);
    // Fallback to simple recent query
    const { data: fallback } = await supabase
      .from("posts")
      .select("id, user_id, content, image_url, image_urls, privacy, created_at, likes_count, comments_count, shares_count")
      .eq("privacy", "public")
      .order("created_at", { ascending: false })
      .limit(200);
    return fallback || [];
  }

  return data;
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
  const [profileMapRes, allReactionsRes, adminIds] =
    await Promise.all([
      fetchProfileMap(authorIds),
      supabase.from("post_reactions").select("post_id, reaction_type, user_id").in("post_id", postIds),
      getAdminIds(),
    ]);

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
    };
  });
}

/** Send candidate pool to rank-feed for scoring + diversity */
async function rankCandidates(
  posts: any[],
  networkIds: string[],
): Promise<string[]> {
  if (posts.length <= 3) return posts.map((p) => p.id);
  try {
    const postData = posts.map((p) => ({
      id: p.id,
      author_id: p.user_id,
      created_at: p.created_at,
      like_count: p.likes_count || 0,
      comment_count: p.comments_count || 0,
      is_from_network: networkIds.includes(p.user_id),
      has_image: ((p.image_urls?.length || 0) > 0) || !!p.image_url,
      author_interaction_count: 0,
    }));
    const res = await supabase.functions.invoke("rank-feed", {
      body: { posts: postData },
    });
    if (res.data?.ranked_ids?.length > 0) {
      return res.data.ranked_ids;
    }
  } catch {
    // Fall through to chronological
  }
  return posts
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((p) => p.id);
}

/* ── The hook ── */

interface FeedPage {
  posts: FeedPost[];
  nextCursor: number | null;
  networkIds: string[];
}

export function useFeedQuery(userId: string | undefined) {
  const networkIdsRef = useRef<string[]>([]);
  const rankedIdsRef = useRef<string[]>([]);
  const rawPostMapRef = useRef<Map<string, any>>(new Map());

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

    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const pageIndex = (pageParam as number | undefined) ?? 0;
      const isFirstPage = pageIndex === 0;

      if (isFirstPage) {
        const networkIds = await fetchRelevantUsers(userId!);
        networkIdsRef.current = networkIds;

        // FIX 3: Single RPC call instead of 3 queries
        const pool = await fetchCandidatePool(networkIds);

        const postMap = new Map<string, any>();
        pool.forEach((p) => postMap.set(p.id, p));
        rawPostMapRef.current = postMap;

        const rankedIds = await rankCandidates(pool, networkIds);
        rankedIdsRef.current = rankedIds;
      }

      const networkIds = networkIdsRef.current;
      const rankedIds = rankedIdsRef.current;

      const start = pageIndex * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const pageIds = rankedIds.slice(start, end);

      if (pageIds.length === 0) {
        return { posts: [], nextCursor: null, networkIds };
      }

      const rawPosts = pageIds
        .map((id) => rawPostMapRef.current.get(id))
        .filter(Boolean);

      const enriched = await enrichPosts(rawPosts, networkIds, userId!);

      const idOrder = new Map(pageIds.map((id, i) => [id, i]));
      enriched.sort((a, b) =>
        ((idOrder.get(a.id) as number) ?? 999) - ((idOrder.get(b.id) as number) ?? 999),
      );

      // Persist first page to localStorage for instant load next visit
      if (isFirstPage && enriched.length > 0) {
        persistFeedPage(enriched, networkIds, userId!);
      }

      const hasMore = end < rankedIds.length;

      return {
        posts: enriched,
        nextCursor: hasMore ? pageIndex + 1 : null,
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
