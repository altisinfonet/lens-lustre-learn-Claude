import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { useLocation } from "react-router-dom";

export interface WalletSummary {
  balance: number;
  pendingDeposits: { id: string; amount: number; status: string; created_at: string }[];
  pendingWithdrawals: { id: string; amount: number; status: string; created_at: string }[];
}

/**
 * Wallet summary — LAZY LOADED.
 * Only fetches on wallet-related pages to prevent concurrency spikes on initial load.
 */
export const useWalletSummary = (userId: string | undefined) => {
  const { pathname } = useLocation();
  const isWalletPage = pathname === "/wallet" || pathname.startsWith("/wallet/");

  const query = useQuery({
    queryKey: queryKeys.walletSummary(userId ?? "none"),
    queryFn: async (): Promise<WalletSummary> => {
      if (!userId) throw new Error("No user");

      const { data, error } = await supabase.functions.invoke("get-wallet-summary");

      if (error) throw error;
      if (!data) throw new Error("No data returned");

      return {
        balance: data.balance ?? 0,
        pendingDeposits: data.pendingDeposits ?? [],
        pendingWithdrawals: data.pendingWithdrawals ?? [],
      };
    },
    // LAZY: only fetch on wallet page — NOT on every navbar render
    enabled: !!userId && isWalletPage,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  return {
    balance: query.data?.balance ?? 0,
    pendingDeposits: query.data?.pendingDeposits ?? [],
    pendingWithdrawals: query.data?.pendingWithdrawals ?? [],
    isLoading: query.isLoading,
  };
};
