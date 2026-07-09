import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { queryKeys } from "@/lib/queryKeys";
import { formatUSDFixed } from "@/lib/currencyFormat";

interface BankInfo {
  bank_name: string;
  account_name: string;
  account_number: string;
  ifsc: string;
}

interface WithdrawInput {
  amountUSD: number;
  bankInfo: BankInfo;
  saveBankDetails: boolean;
}

export function useWalletWithdrawals() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ amountUSD, bankInfo, saveBankDetails }: WithdrawInput) => {
      if (!user) throw new Error("Not authenticated");

      // Client-side validation (server enforces canonical bounds)
      if (amountUSD < 1) throw new Error("Minimum withdrawal is $1.00");
      if (amountUSD > 50000) throw new Error("Maximum withdrawal is $50,000");

      // Save bank details if requested (non-critical)
      if (saveBankDetails && bankInfo.account_number) {
        await supabase.from("bank_details" as any).upsert({
          user_id: user.id,
          bank_name: bankInfo.bank_name || null,
          bank_account_name: bankInfo.account_name || null,
          bank_account_number: bankInfo.account_number || null,
          bank_ifsc: bankInfo.ifsc || null,
        } as any, { onConflict: "user_id" });
      }

      // Phase 1 Mutation #3: single atomic server-side RPC
      // (insert withdrawal_request + debit wallet in one transaction)
      const { error } = await supabase.rpc("request_withdrawal" as any, {
        _amount: amountUSD,
        _bank_details: bankInfo as any,
      });
      if (error) throw error;

      return { amountUSD };
    },
    onSuccess: ({ amountUSD }) => {
      toast({
        title: "Withdrawal request submitted",
        description: `${formatUSDFixed(amountUSD)} will be transferred after admin review.`,
      });
      if (user) {
        qc.invalidateQueries({ queryKey: queryKeys.walletSummary(user.id) });
        qc.invalidateQueries({ queryKey: queryKeys.walletTransactions(user.id) });
        qc.invalidateQueries({ queryKey: queryKeys.walletPageData(user.id) });
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  return {
    submitWithdrawal: (input: WithdrawInput) => mutation.mutateAsync(input),
    isSubmitting: mutation.isPending,
  };
}
