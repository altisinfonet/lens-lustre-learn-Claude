import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

const PAGE_SIZE = 50;

export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  reference_id: string | null;
  reference_type: string | null;
  status: string;
  created_at: string;
  metadata: any;
}

export const useWalletTransactions = (userId: string | undefined) => {
  const query = useInfiniteQuery({
    queryKey: queryKeys.walletTransactions(userId!),
    queryFn: async ({ pageParam = 0 }): Promise<WalletTransaction[]> => {
      if (!userId) throw new Error("No user");

      const { data, error } = await supabase.functions.invoke("get-wallet-transactions", {
        body: { page: pageParam, pageSize: PAGE_SIZE },
      });

      if (error) throw error;
      return (data as WalletTransaction[]) ?? [];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!userId,
  });

  return {
    transactions: query.data?.pages.flat() ?? [],
    loadMore: () => query.fetchNextPage(),
    hasMore: query.hasNextPage ?? false,
    isLoading: query.isLoading,
  };
};
