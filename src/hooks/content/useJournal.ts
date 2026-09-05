import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

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

      const authorIds = [...new Set(data.map((a) => a.author_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, custom_url")
        .in("id", authorIds);

      const profileMap = new Map(profiles?.map((p) => [p.id, p.full_name]) || []);
      // F-95 — the handle comes back on the same row as the name, so the
      // article byline can link to /<handle> without a second lookup.
      const handleMap = new Map(profiles?.map((p) => [p.id, p.custom_url]) || []);
      return data.map((a) => ({
        ...a,
        profiles: {
          full_name: profileMap.get(a.author_id) || null,
          custom_url: handleMap.get(a.author_id) ?? null,
        },
      }));
    },
  });
};
