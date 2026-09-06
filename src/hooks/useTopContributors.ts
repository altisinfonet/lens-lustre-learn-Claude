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
 * WHY THIS NOW CALLS v3
 *
 * OWNER-RULING-2026-09-03-02, frozen in docs/gates/TC-v3-interface.md. v2 ranked
 * by the rolling 30-day score and returned only the LIFETIME score, so the card
 * showed a rank derived from a number nobody could see. Measured on production
 * 2026-09-03, ranks 1/2/3 read 9,551 / 8,888 / 11,546 — the bronze medal holding
 * the largest figure. Nothing was computed wrongly; the card was ranking on one
 * number and displaying another.
 *
 * v3 adds `recent_score` and changes nothing else: same ranking rule, same
 * tie-break, same top three, same admin exclusion. No member's position moves.
 *
 * This SUPERSEDES the note that stood here, which said the 30-day score is
 * "NEVER returned, so it cannot reach the UI by accident" (Owner, 2026-08-11).
 * The reason behind that note is NOT superseded — no counts, no minutes, no
 * engagement figures, no formula internals cross the wire. Owner: "The ranking
 * should feel like recognition, not a 'time spent on app' competition." Only the
 * visibility of recent_score changed.
 *
 * v2 IS STILL THERE and is the rollback, exactly as v1 was for v2.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchProfileMapDirect } from '@/lib/profileMapCache';

/** The frozen v3 return shape — docs/gates/TC-v3-interface.md §2.2. */
interface TopContributorRowV3 {
  user_id: string;
  rank_position: number;
  contributor_score: number;
  recent_score: number;
}

export interface TopContributor {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  /** F-95 — the name-URL handle, carried beside the name it belongs to. */
  custom_url: string | null;
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
  /**
   * The rolling 30-UTC-day score the ranking is computed from — the number the
   * Home card and the signed-out sidebar card now display as their primary
   * figure. Strictly descending by rank_position, by construction: the bar
   * scales by rank 1's value and would overflow if that ever stopped holding.
   */
  recent_score: number;
  /** 1, 2 or 3. */
  rank_position: number;
}

export const useTopContributors = () => {
  return useQuery({
    // The key moved with the function. Reusing 'top-contributors-v1' would let a
    // member who already had the page open be served v2-shaped rows through the
    // new field names, blanking the 30-day figure until they reloaded.
    queryKey: ['top-contributors-v3'],
    queryFn: async (): Promise<TopContributor[]> => {
      // NO `as any` ON THE ROWS, deliberately. The previous call passed the v2
      // function name through an `as any` cast, and that cast is why a component
      // reading the wrong column type-checked cleanly and shipped — the known
      // coupling recorded in the frozen interface §3.5. Typing the ROWS is the
      // half that catches that bug.
      //
      // (The old call is described rather than quoted: the guard in
      //  src/__tests__/topContributorsV3.home.test.ts scans this file's text for
      //  a v2 rpc call, and it caught the quoted version. The comment moved
      //  rather than the check.)
      //
      // ⚠ CALLED AS A METHOD, never through a stored reference. Detaching it —
      // `const rpc = supabase.rpc as …` — loses the receiver and throws at
      // runtime; that bug has appeared twice in this codebase and RED-1 in
      // src/__tests__/mediaWritePath.test.ts walks every file under src/ to
      // stop it recurring. It caught this hook during TC-v3. Leave it a method
      // call.
      //
      // The function name still needs a narrow cast because
      // src/integrations/supabase/types.ts is generated and predates v3.
      // Regenerating it is D1's lane and two sessions regenerating it conflict
      // silently, so it is NOT touched here.
      const { data, error } = await supabase.rpc(
        'get_top_contributors_v3' as Parameters<typeof supabase.rpc>[0],
      );
      if (error) throw error;
      if (!data || (data as unknown[]).length === 0) return [];

      const rows = data as unknown as TopContributorRowV3[];
      const userIds = rows.map((d) => d.user_id);
      const profileMap = await fetchProfileMapDirect(userIds);

      return rows.map((d) => {
        const profile = profileMap.get(d.user_id);
        return {
          id: d.user_id,
          full_name: profile?.full_name ?? 'Photographer',
          avatar_url: profile?.avatar_url ?? null,
          custom_url: profile?.custom_url ?? null,
          badges: profile?.badges ?? [],
          roles: profile?.roles ?? [],
          contributor_score: Number(d.contributor_score) || 0,
          recent_score: Number(d.recent_score) || 0,
          rank_position: Number(d.rank_position) || 0,
        };
      });
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
