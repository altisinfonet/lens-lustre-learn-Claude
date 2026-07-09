import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { queryKeys } from "@/lib/queryKeys";

export interface SearchUser {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

export interface SearchPost {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
}

export interface SearchResults {
  users: SearchUser[];
  posts: SearchPost[];
}

async function fetchSearchResults(query: string): Promise<SearchResults> {
  const term = `%${query}%`;

  const [usersRes, postsRes] = await Promise.all([
    profilesPublic()
      .select("id, full_name, avatar_url, bio")
      .eq("is_suspended", false)
      .ilike("full_name", term)
      .limit(10),
    supabase
      .from("posts")
      .select("id, content, user_id, created_at")
      .eq("privacy", "public")
      .ilike("content", term)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    users: (usersRes.data ?? []) as SearchUser[],
    posts: (postsRes.data ?? []) as SearchPost[],
  };
}

export function useSearch(input: string) {
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const enabled = debouncedQuery.length >= 2;

  const { data, isLoading, error } = useQuery<SearchResults>({
    queryKey: queryKeys.search(debouncedQuery),
    queryFn: () => fetchSearchResults(debouncedQuery),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000, // short-lived, never shared with profile cache
  });

  return {
    results: data ?? { users: [], posts: [] },
    isLoading: enabled && isLoading,
    error,
    debouncedQuery,
  };
}
