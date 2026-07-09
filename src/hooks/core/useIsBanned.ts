import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { queryKeys } from "@/lib/queryKeys";

export function useIsBanned() {
  const { user } = useAuth();

  const { data: isBanned = false, isLoading } = useQuery({
    queryKey: queryKeys.isBanned(user?.id ?? ""),
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("profiles")
        .select("is_banned")
        .eq("id", user.id)
        .maybeSingle();
      return data?.is_banned ?? false;
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  return { isBanned, isLoading };
}
