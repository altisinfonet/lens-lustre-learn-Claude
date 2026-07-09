import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

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

export interface ExchangeRate {
  rate: number;
  source: string;
  auto_fetch: boolean;
}

export const useWallet = () => {
  const { user, loading: authLoading } = useAuth();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate>({ rate: 83.5, source: "manual", auto_fetch: true });
  const [loading, setLoading] = useState(true);

  const fetchWallet = useCallback(async () => {
    if (!user) return;

    const [walletRes, txnRes, rateRes] = await Promise.all([
      supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("wallet_transactions")
        .select("id, type, amount, balance_after, description, reference_id, reference_type, status, created_at, metadata")
        .eq("user_id", user.id)
        .neq("status", "voided") // Phase 1 Mut #4: hide soft-voided rows from user-facing wallet
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("site_settings").select("value").eq("key", "usd_to_inr_rate").maybeSingle(),
    ]);

    setBalance(walletRes.data?.balance ?? 0);
    setTransactions((txnRes.data as WalletTransaction[]) || []);
    if (rateRes.data?.value) {
      setExchangeRate(rateRes.data.value as unknown as ExchangeRate);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    fetchWallet();
  }, [user, authLoading, fetchWallet]);

  const toINR = useCallback((usd: number) => {
    return usd * exchangeRate.rate;
  }, [exchangeRate.rate]);

  const addFunds = useCallback(async (amount: number, description?: string) => {
    if (!user) return null;
    const { data, error } = await supabase.rpc("wallet_transaction", {
      _user_id: user.id,
      _type: "deposit",
      _amount: amount,
      _description: description || "Wallet top-up",
    });
    if (error) throw error;
    await fetchWallet();
    return data;
  }, [user, fetchWallet]);

  const deductFunds = useCallback(async (amount: number, type: string, description: string, referenceId?: string, referenceType?: string) => {
    if (!user) return null;
    const { data, error } = await supabase.rpc("wallet_transaction", {
      _user_id: user.id,
      _type: type,
      _amount: -amount,
      _description: description,
      _reference_id: referenceId || null,
      _reference_type: referenceType || null,
    });
    if (error) throw error;
    await fetchWallet();
    return data;
  }, [user, fetchWallet]);

  return {
    balance,
    transactions,
    exchangeRate,
    loading: loading || authLoading,
    toINR,
    addFunds,
    deductFunds,
    refresh: fetchWallet,
  };
};
