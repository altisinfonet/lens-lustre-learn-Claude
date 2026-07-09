import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { awaitDashboardBootstrap } from "@/lib/dashboardInitGate";

export const useUserRoles = () => {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["user-roles", user?.id ?? "none"],
    queryFn: async () => {
      if (!user) return [];
      // U-04: dashboard-init seeds ["user-roles", userId]. Wait for the
      // shared bootstrap so we don't fire a duplicate user_roles fetch.
      await awaitDashboardBootstrap();
      const seeded = qc.getQueryData<string[]>(["user-roles", user.id]);
      if (seeded) return seeded;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      return data?.map((r) => r.role) ?? [];
    },
    enabled: !!user && !authLoading,
    staleTime: 5 * 60_000,
  });

  const hasRole = useMemo(
    () => (role: string) => roles.includes(role),
    [roles]
  );

  return { roles, loading: isLoading || authLoading, hasRole };
};
