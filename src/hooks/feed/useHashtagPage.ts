import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { enrichPostRows } from "@/hooks/feed/useUserPostsQuery";
import type { UnifiedPost } from "@/types/post";

/**
 * H1 (Owner plan 2026-11-09) — the hashtag page reads the hashtag STORE
 * (hashtags + post_hashtags), never a caption text search: #land must not
 * return #landscape, and the page must stay fast at a million posts.
 *
 * The server decides who may see which post (public, friends-only for a
 * friend, own posts); the page only shows what comes back.
 */
export type HashtagSort = "top" | "recent";

export interface HashtagInfo {
  tag: string;
  display_tag: string;
  people_count: number;
  post_count: number;
  is_following: boolean;
  related: Array<{ tag: string; display_tag: string; post_count: number }>;
}

export const HASHTAG_PAGE_SIZE = 30;

export function useHashtagInfo(tag: string, viewerId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["hashtag-info", tag, viewerId ?? ""],
    enabled: !!tag && enabled,
    queryFn: async (): Promise<HashtagInfo | null> => {
      const { data, error } = await supabase.rpc("hashtag_page_info" as never, { _tag: tag } as never);
      if (error) throw error;
      const raw = data as unknown;
      const row = (Array.isArray(raw) ? raw[0] : raw) as HashtagInfo | null | undefined;
      return row ?? null;
    },
  });
}

interface HashtagPostsPage {
  posts: UnifiedPost[];
  nextCursor: string | null;
}

export function useHashtagPosts(tag: string, sort: HashtagSort, viewerId: string | undefined, enabled: boolean) {
  return useInfiniteQuery<HashtagPostsPage, Error>({
    queryKey: ["hashtag-posts", tag, sort, viewerId ?? ""],
    enabled: !!tag && enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("hashtag_page_posts" as never, {
        _tag: tag, _sort: sort, _cursor: pageParam ?? null, _limit: HASHTAG_PAGE_SIZE,
      } as never);
      if (error) throw error;
      const rows = (data as Array<Record<string, unknown> & { page_cursor?: string }>) ?? [];
      const nextCursor = rows.length === HASHTAG_PAGE_SIZE ? String(rows[rows.length - 1].page_cursor ?? "") || null : null;
      return { posts: rows.length ? await enrichPostRows(rows, viewerId) : [], nextCursor };
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Follow / unfollow a hashtag (Owner YES 2026-11-09). Optimistic on the info row. */
export function useFollowHashtag(tag: string, viewerId: string | undefined) {
  const qc = useQueryClient();
  const key = ["hashtag-info", tag, viewerId ?? ""];
  return useMutation({
    mutationFn: async (follow: boolean) => {
      const { error } = await supabase.rpc((follow ? "follow_hashtag" : "unfollow_hashtag") as never, { _tag: tag } as never);
      if (error) throw error;
    },
    onMutate: (follow: boolean) => {
      const prev = qc.getQueryData<HashtagInfo | null>(key);
      if (prev) qc.setQueryData<HashtagInfo>(key, { ...prev, is_following: follow });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
  });
}
