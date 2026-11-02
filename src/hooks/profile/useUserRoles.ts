import { useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { awaitDashboardBootstrap } from "@/lib/dashboardInitGate";

/** The ONE cache entry for a member's roles (dashboard-init seeds it). */
export const userRolesKey = (userId: string | null | undefined) => ["user-roles", userId ?? "none"] as const;

/** The ONE read of a member's roles — shared by useUserRoles and the photo-download policy (U3). */
export async function fetchUserRoles(qc: QueryClient, userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  // U-04: dashboard-init seeds ["user-roles", userId]. Wait for the
  // shared bootstrap so we don't fire a duplicate user_roles fetch.
  await awaitDashboardBootstrap();
  const seeded = qc.getQueryData<string[]>(userRolesKey(userId));
  if (seeded) return seeded;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return data?.map((r) => r.role) ?? [];
}

export const useUserRoles = () => {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: userRolesKey(user?.id),
    queryFn: () => fetchUserRoles(qc, user?.id),
    enabled: !!user && !authLoading,
    staleTime: 5 * 60_000,
  });

  const hasRole = useMemo(
    () => (role: string) => roles.includes(role),
    [roles]
  );

  return { roles, loading: isLoading || authLoading, hasRole };
};
