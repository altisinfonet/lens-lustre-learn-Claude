/**
 * N7 · "Also follows N people you know" on new-follower rows (SQL 0190).
 * One call for the whole page; asks nothing while the centre screens are off.
 * Any error means no counts — the row simply shows no extra line.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

const EMPTY = new Map<string, number>();

export function useMutualFollowCounts(actorIds: string[], enabled: boolean): Map<string, number> {
  const { user } = useAuth();
  const ids = Array.from(new Set(actorIds.filter(Boolean))).sort().slice(0, 50);
  const query = useQuery({
    queryKey: ["notif-mutual-follows", user?.id ?? "", ids.join(",")],
    enabled: enabled && !!user?.id && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("notif_mutual_follow_counts" as never, { _actors: ids } as never);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ actor_id: string; mutual: number }>;
      return new Map(rows.map((r) => [r.actor_id, r.mutual]));
    },
    staleTime: 60_000,
    retry: false,
  });
  return query.data ?? EMPTY;
}
