import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchProfileMapDirect } from '@/lib/profileMapCache';

export interface TopContributor {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  badges: string[];
  roles: string[];
  score: number;
  posts_count: number;
  likes_received: number;
  comments_received: number;
}

export const useTopContributors = () => {
  return useQuery({
    queryKey: ['top-contributors-v1'],
    queryFn: async (): Promise<TopContributor[]> => {
      const { data, error } = await supabase.rpc('get_top_contributors_v1');
      if (error) throw error;
      if (!data || data.length === 0) return [];

      const userIds = data.map((d: any) => d.user_id);
      const profileMap = await fetchProfileMapDirect(userIds);

      return data.map((d: any) => {
        const profile = profileMap.get(d.user_id);
        return {
          id: d.user_id,
          full_name: profile?.full_name ?? 'Photographer',
          avatar_url: profile?.avatar_url ?? null,
          badges: profile?.badges ?? [],
          roles: profile?.roles ?? [],
          score: d.score,
          posts_count: d.posts_count,
          likes_received: d.likes_received,
          comments_received: d.comments_received,
        };
      });
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
