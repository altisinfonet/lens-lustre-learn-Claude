import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";

export interface ExpiringBalance {
  amount: number;
  soonest: string | null;
  count: number;
}

export const useWalletPageData = (userId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.walletPageData(userId || ""),
    queryFn: async () => {
      if (!userId) throw new Error("No user");

      const [expiringRes, gatewaysRes, bankRes, withdrawalsRes] = await Promise.all([
        supabase
          .from("gift_announcements")
          .select("amount, expires_at")
          .eq("user_id", userId)
          .eq("is_expired", false)
          .not("expires_at", "is", null),
        // Public sanitized payment-gateway flags (RLS blocks direct read of payment_gateways)
        supabase.functions.invoke("get-payment-gateways-public"),
        supabase
          .from("bank_details" as any)
          .select("bank_account_name, bank_account_number, bank_name, bank_ifsc")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("withdrawal_requests")
          .select("id, amount, status, created_at")
          .eq("user_id", userId)
          .in("status", ["pending", "processing"])
          .order("created_at", { ascending: false }),
      ]);

      // Process expiring balance — uses is_expired=false filter from query, trust DB flag
      let expiringBalance: ExpiringBalance = { amount: 0, soonest: null, count: 0 };
      if (expiringRes.data && expiringRes.data.length > 0) {
        const active = expiringRes.data;
        expiringBalance = {
          amount: active.reduce((sum, g) => sum + Number(g.amount), 0),
          soonest: active.length > 0
            ? active.sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())[0].expires_at
            : null,
          count: active.length,
        };
      }

      return {
        expiringBalance,
        paymentGateways: (gatewaysRes as any)?.data?.payment_gateways || null,
        savedBankDetails: (bankRes.data as any) || null,
        pendingWithdrawals: (withdrawalsRes.data as any[]) || [],
      };
    },
    enabled: !!userId,
  });
};
