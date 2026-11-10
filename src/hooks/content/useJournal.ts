import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { fetchProfilesDetailByIds } from "@/lib/profileBatch";

export interface JournalArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  tags: string[];
  published_at: string | null;
  created_at: string;
  author_id: string;
  profiles?: { full_name: string | null; custom_url?: string | null } | null;
}

export const useJournal = () => {
  return useQuery({
    queryKey: queryKeys.journal(),
    queryFn: async (): Promise<JournalArticle[]> => {
      const { data, error } = await supabase
        .from("journal_articles")
        .select("id, title, slug, excerpt, cover_image_url, tags, published_at, created_at, author_id")
        .eq("status", "published")
        .order("published_at", { ascending: false });

      if (error) throw error;
      if (!data) return [];

      // Owner 2026-11-10: signed out, every byline read "Unknown". This read the
      // base `profiles` table, which RLS locks to self/admins — so a visitor got
      // no rows. Names come from the public view, through the one shared helper
      // (F-95: the handle arrives on the same row as the name).
      const authorIds = [...new Set(data.map((a) => a.author_id))].sort();
      const authors = await fetchProfilesDetailByIds(authorIds);
      return data.map((a) => ({
        ...a,
        profiles: {
          full_name: authors.get(a.author_id)?.full_name || null,
          custom_url: authors.get(a.author_id)?.custom_url ?? null,
        },
      }));
    },
  });
};
