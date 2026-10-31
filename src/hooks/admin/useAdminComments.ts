import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";

export interface AdminComment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  article_id: string | null;
  entry_id: string | null;
  parent_id: string | null;
  profile_name: string | null;
  context_title: string | null;
}

const fetchAdminComments = async (): Promise<AdminComment[]> => {
  const [commentsRes, postCommentsRes] = await Promise.all([
    supabase
      .from("comments")
      .select("id, user_id, content, created_at, article_id, entry_id, parent_id")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("post_comments")
      .select("id, user_id, content, created_at, parent_id")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const legacyComments = commentsRes.data ?? [];
  const postComments = (postCommentsRes.data ?? []).map((c) => ({
    id: c.id,
    user_id: c.user_id,
    content: c.content,
    created_at: c.created_at,
    article_id: null,
    entry_id: null,
    parent_id: c.parent_id,
  }));

  const allComments = [...legacyComments, ...postComments].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  if (allComments.length === 0) return [];

  const userIds = [...new Set(allComments.map((c) => c.user_id))];
  const articleIds = [...new Set(allComments.filter((c) => c.article_id).map((c) => c.article_id!))];
  const entryIds = [...new Set(allComments.filter((c) => c.entry_id).map((c) => c.entry_id!))];

  const profileMap = await cachedFetchProfilesByIds(userIds);

  let articleMap = new Map<string, string>();
  if (articleIds.length > 0) {
    const { data: articles } = await supabase.from("journal_articles").select("id, title").in("id", articleIds);
    articleMap = new Map(articles?.map((a: any) => [a.id, a.title]) || []);
  }

  let entryMap = new Map<string, string>();
  if (entryIds.length > 0) {
    const { data: entries } = await supabase.from("competition_entries").select("id, title").in("id", entryIds);
    entryMap = new Map(entries?.map((e: any) => [e.id, e.title]) || []);
  }

  const result = allComments.map((c) => ({
    ...c,
    profile_name: profileMap.get(c.user_id) ?? null,
    context_title: c.article_id
      ? articleMap.get(c.article_id) || "Article"
      : c.entry_id
      ? entryMap.get(c.entry_id) || "Entry"
      : null,
  }));
  return result;
};

export const useAdminComments = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.adminComments(),
    queryFn: fetchAdminComments,
  });

  return {
    comments: data ?? [],
    isLoading,
    error,
  };
};
