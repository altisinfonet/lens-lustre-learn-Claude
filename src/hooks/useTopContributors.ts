/**
 * Top Contributors — the Home page top 3, and the Contributor Score.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS CALLS v2
 *
 * Owner, 2026-08-11. get_top_contributors_v1 ranked members by the likes and
 * comments their OWN photographs received, which means a member who comments
 * generously on everyone else's work scored nothing for it. It also selected
 * FROM posts, so a member with no posts could not appear at all however much
 * they engaged.
 *
 * get_top_contributors_v2 ranks by what a member CONTRIBUTES — photographs
 * posted and comments WRITTEN — over a rolling 30 UTC days, and returns the
 * lifetime Contributor Score for display. The maths, the tiers and the
 * eligibility rule all live in the database; nothing here calculates anything.
 *
 * v1 IS STILL THERE, unchanged. If this needs to be undone, point the rpc call
 * back at it and restore the three count fields below — that is the whole
 * rollback. See supabase/migrations/20260811160000_top_contributors_v2.sql.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT v2 DELIBERATELY DOES NOT RETURN
 *
 * The 30-day score that decides the ranking, and any activity or engagement
 * figure. Owner: "The ranking should feel like recognition, not a 'time spent
 * on app' competition." Only a member id, a position and one public number
 * cross the wire, so none of it can reach the UI by accident.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchProfileMapDirect } from '@/lib/profileMapCache';

export interface TopContributor {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  badges: string[];
  roles: string[];
  /**
   * The public Contributor Score, shown under the member's name.
   *
   * Calculated live from the activity that currently exists, so it rises with
   * new photographs and comments and falls when they are deleted. There is no
   * stored score anywhere — a deleted profile simply stops being returned.
   */
  contributor_score: number;
  /** 1, 2 or 3. */
  rank_position: number;
}

export const useTopContributors = () => {
  return useQuery({
    // The key moved with the function. Reusing 'top-contributors-v1' would let a
    // member who already had the page open be served v1-shaped rows through the
    // new field names, blanking the score until they reloaded.
    queryKey: ['top-contributors-v2'],
    queryFn: async (): Promise<TopContributor[]> => {
      // `as any`: the generated Supabase types are from before this function
      // existed. Same pattern as the other post-generation RPCs in this codebase.
      const { data, error } = await supabase.rpc('get_top_contributors_v2' as any);
      if (error) throw error;
      if (!data || (data as any[]).length === 0) return [];

      const rows = data as any[];
      const userIds = rows.map((d) => d.user_id);
      const profileMap = await fetchProfileMapDirect(userIds);

      return rows.map((d) => {
        const profile = profileMap.get(d.user_id);
        return {
          id: d.user_id,
          full_name: profile?.full_name ?? 'Photographer',
          avatar_url: profile?.avatar_url ?? null,
          badges: profile?.badges ?? [],
          roles: profile?.roles ?? [],
          contributor_score: Number(d.contributor_score) || 0,
          rank_position: Number(d.rank_position) || 0,
        };
      });
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
