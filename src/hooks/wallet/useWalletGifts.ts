import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

export interface GiftAnnouncement {
  id: string;
  gift_credit_id: string;
  amount: number;
  reason: string;
  expires_at: string | null;
  is_expired: boolean;
  is_read: boolean;
  created_at: string;
}

export const useWalletGifts = (userId: string | undefined) => {
  const query = useQuery({
    queryKey: queryKeys.walletGifts(userId || ""),
    queryFn: async (): Promise<GiftAnnouncement[]> => {
      if (!userId) throw new Error("No user");
      const { data, error } = await supabase
        .from("gift_announcements")
        .select("id, gift_credit_id, amount, reason, expires_at, is_expired, is_read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as GiftAnnouncement[]) || [];
    },
    enabled: !!userId,
  });

  const gifts = query.data ?? [];

  return {
    gifts,
    activeGifts: gifts.filter((g) => !g.is_expired),
    expiredGifts: gifts.filter((g) => g.is_expired),
    isLoading: query.isLoading,
  };
};
