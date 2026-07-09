import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import { awaitDashboardBootstrap } from "@/lib/dashboardInitGate";

async function checkAdmin(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

export const useIsAdmin = () => {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();

  const { data: isAdmin = false, isLoading } = useQuery({
    queryKey: queryKeys.isAdmin(user?.id ?? ""),
    queryFn: async () => {
      // U-04: dashboard-init seeds isAdmin via preSeedCaches. Wait for the
      // shared bootstrap before falling through to an independent
      // user_roles query (eliminates duplicate fetches per page load).
      await awaitDashboardBootstrap();
      if (!user) return false;
      const seeded = qc.getQueryData<boolean>(queryKeys.isAdmin(user.id));
      if (seeded !== undefined) return seeded;
      return checkAdmin(user.id);
    },
    enabled: !!user && !authLoading,
    staleTime: 5 * 60_000,
  });

  return { isAdmin, loading: authLoading || (!!user && isLoading) };
};
