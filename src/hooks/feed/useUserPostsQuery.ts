import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import type { UnifiedPost } from "@/types/post";
import type { ReactionType } from "@/components/ReactionPicker";

const PAGE_SIZE = 10;

interface UserPostsPage {
  posts: UnifiedPost[];
  nextCursor: string | null;
}

async function fetchAndEnrich(
  targetUserId: string,
  currentUserId: string | undefined,
  cursor: string | null,
): Promise<UserPostsPage> {
  let query = supabase
    .from("posts")
    .select("*")
    .eq("user_id", targetUserId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data: postsData, error } = await query;
  if (error || !postsData || postsData.length === 0) {
    return { posts: [], nextCursor: null };
  }

  const authorIds = [...new Set(postsData.map((p) => p.user_id))];
  const postIds = postsData.map((p) => p.id);

  // Merge reaction queries into ONE — filter user reactions client-side
  const [profileMap, adminIds, allReactionsRes] = await Promise.all([
    fetchProfileMap(authorIds),
    getAdminIds(),
    supabase.from("post_reactions").select("post_id, reaction_type, user_id").in("post_id", postIds),
  ]);

  const reactionTypeCounts: Record<string, Record<string, number>> = {};
  const userReactionMap = new Map<string, string>();
  (allReactionsRes.data || []).forEach((r: any) => {
    if (!reactionTypeCounts[r.post_id]) reactionTypeCounts[r.post_id] = {};
    reactionTypeCounts[r.post_id][r.reaction_type] = (reactionTypeCounts[r.post_id][r.reaction_type] || 0) + 1;
    if (currentUserId && r.user_id === currentUserId) {
      userReactionMap.set(r.post_id, r.reaction_type);
    }
  });

  const posts: UnifiedPost[] = postsData.map((p: any) => {
    const userRx = userReactionMap.get(p.id) as ReactionType | undefined;
    const typeCounts = reactionTypeCounts[p.id] || {};
    const topReactions = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);
    const imageUrls = p.image_urls?.length > 0 ? p.image_urls : p.image_url ? [p.image_url] : [];

    return {
      id: p.id,
      user_id: p.user_id,
      content: p.content || "",
      image_url: p.image_url || null,
      image_urls: imageUrls,
      privacy: p.privacy || "public",
      created_at: p.created_at,
      author_name: resolveName(p.user_id, profileMap.get(p.user_id)?.full_name ?? null, adminIds),
      author_avatar: profileMap.get(p.user_id)?.avatar_url || null,
      author_badges: resolveBadges(p.user_id, profileMap.get(p.user_id)?.badges || [], adminIds),
      like_count: p.likes_count || 0,
      comment_count: p.comments_count || 0,
      share_count: p.shares_count || 0,
      is_liked: !!userRx,
      user_reaction: userRx || null,
      top_reactions: topReactions,
      reaction_counts: typeCounts,
    };
  });

  const hasMore = postsData.length === PAGE_SIZE;
  const nextCursor = hasMore ? postsData[postsData.length - 1].created_at : null;

  return { posts, nextCursor };
}

export function useUserPostsQuery(targetUserId: string | undefined, currentUserId: string | undefined) {
  return useInfiniteQuery<UserPostsPage, Error>({
    queryKey: ["user-wall-posts", targetUserId],
    enabled: !!targetUserId,
    queryFn: async ({ pageParam }) => {
      const cursor = (pageParam as string | undefined) ?? null;
      return fetchAndEnrich(targetUserId!, currentUserId, cursor);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
  });
}

export function flattenUserPosts(pages: UserPostsPage[] | undefined): UnifiedPost[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const result: UnifiedPost[] = [];
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
