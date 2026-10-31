import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { queryKeys } from "@/lib/queryKeys";

interface DepositInput {
  amountUSD: number;
  gateway: "upi" | "bank_transfer";
  reference: string;
  metadata: Record<string, any>;
}

export function useWalletDeposits() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ amountUSD, gateway, reference, metadata }: DepositInput) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("submit-deposit", {
        body: { amountUSD, gateway, reference, metadata },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return { gateway: data?.gateway || (gateway === "upi" ? "UPI" : "Bank Transfer") };
    },
    onSuccess: ({ gateway }) => {
      toast({
        title: "Deposit request submitted!",
        description: "Your payment will be verified by admin and credited to your wallet.",
      });
      if (user) {
        qc.invalidateQueries({ queryKey: queryKeys.walletSummary(user.id) });
        qc.invalidateQueries({ queryKey: queryKeys.walletTransactions(user.id) });
        qc.invalidateQueries({ queryKey: queryKeys.walletPageData(user.id) });
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed to submit", description: err.message, variant: "destructive" });
    },
  });

  return {
    submitDeposit: (input: DepositInput) => mutation.mutateAsync(input),
    isSubmitting: mutation.isPending,
  };
}
