import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { formatUSDFixed, formatINRFixed } from "@/lib/currencyFormat";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { safeAdminExecute, assertSupabaseResult } from "@/lib/safeAdminExecute";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Gift, Banknote, IndianRupee, Settings } from "lucide-react";
import WalletReconciliationAudit from "@/components/admin/WalletReconciliationAudit";
import type { User } from "@supabase/supabase-js";
import { useT } from "@/i18n/I18nContext";

const PAGE_SIZE = 50;

const GatewayField = ({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) => (
  <div className="flex-1 min-w-[180px]">
    <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs" style={{ fontFamily: "var(--font-body)" }} />
  </div>
);

interface WithdrawalRow {
  id: string;
  user_id: string;
  amount: number;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
  bank_details: unknown;
  user_name: string;
}

interface ExchangeRateValue {
  rate: number;
  source: string;
  auto_fetch: boolean;
}

interface GatewayConfig {
  stripe: { enabled: boolean; publishable_key: string; secret_key: string };
  paypal: { enabled: boolean; client_id: string; secret: string; mode: string };
  razorpay: { enabled: boolean; key_id: string; key_secret: string };
  upi: { enabled: boolean; upi_id: string; merchant_name: string };
  bank: { enabled: boolean; account_name: string; account_number: string; ifsc: string; bank_name: string };
}

const AdminWalletTab = ({ user }: { user: User | null }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const [targetEmail, setTargetEmail] = useState("");
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditType, setCreditType] = useState("prize_winning");
  const [creditDesc, setCreditDesc] = useState("");
  const [processing, setProcessing] = useState(false);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [exchangeRate, setExchangeRate] = useState("83.5");
  const [autoFetch, setAutoFetch] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchWithdrawals = async (pageNum = 0) => {
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("withdrawal_requests")
      .select("id, user_id, amount, status, admin_note, created_at, updated_at, reviewed_by, bank_details")
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) {
      toast({ title: t("aw.loadWithdrawalsFailed"), description: error.message, variant: "destructive" });
      return;
    }
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map((w) => w.user_id))];
      const profileMap = await cachedFetchProfilesByIds(userIds);
      const mapped: WithdrawalRow[] = data.map((w) => ({ ...w, user_name: profileMap.get(w.user_id) || "Unknown" }));
      setWithdrawals(prev => pageNum === 0 ? mapped : [...prev, ...mapped]);
      setHasMore(data.length === PAGE_SIZE);
    } else {
      if (pageNum === 0) setWithdrawals([]);
      setHasMore(false);
    }
    setPage(pageNum);
  };

  const fetchRate = async () => {
    const { data } = await supabase.from("site_settings").select("value").eq("key", "usd_to_inr_rate").maybeSingle();
    if (data?.value) {
      const v = data.value as unknown as ExchangeRateValue;
      setExchangeRate(String(v.rate || 83.5));
      setAutoFetch(v.auto_fetch ?? true);
    }
  };

  useEffect(() => { fetchWithdrawals(0); fetchRate(); }, []);

  const lookupUser = async () => {
    if (!targetEmail.trim()) return;
    const { data } = await supabase.from("profiles").select("id, full_name").ilike("full_name", `%${targetEmail.trim()}%`).limit(1);
    if (data && data.length > 0) {
      setTargetUserId(data[0].id);
      setTargetName(data[0].full_name || "User");
      toast({ title: `${t("aw.found")} ${data[0].full_name}` });
    } else {
      toast({ title: t("aw.userNotFound"), variant: "destructive" });
    }
  };

  const creditWallet = async () => {
    if (!user || !targetUserId) return;
    const amt = parseFloat(creditAmount);
    if (!amt || amt <= 0) { toast({ title: t("aw.enterValidAmount"), variant: "destructive" }); return; }
    if (amt > 10000) { toast({ title: t("aw.maxCredit"), description: t("aw.maxCreditDesc"), variant: "destructive" }); return; }
    setProcessing(true);
    await safeAdminExecute("Credit wallet", async () => {
      const result = await supabase.rpc("admin_wallet_credit", {
        _admin_id: user.id,
        _target_user_id: targetUserId,
        _amount: amt,
        _type: creditType,
        _description: creditDesc.trim() || `${creditType} credit by admin`,
      });
      assertSupabaseResult(result, "Wallet credit RPC");
      setCreditAmount("");
      setCreditDesc("");
      setTargetUserId(null);
      setTargetEmail("");
    }, { successMessage: `${formatUSDFixed(amt)} credited to ${targetName}` });
    setProcessing(false);
  };

  const updateWithdrawal = async (id: string, status: string, note: string) => {
    await safeAdminExecute(`Withdrawal ${status}`, async () => {
      const { data, error } = await supabase.functions.invoke("admin-process-withdrawal", {
        body: { withdrawal_id: id, status, admin_note: note || null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      fetchWithdrawals(0);
    }, { successMessage: `Withdrawal ${status}` });
  };

  const saveRate = async () => {
    const rate = parseFloat(exchangeRate);
    if (!rate || rate <= 0) return;
    const { error } = await supabase.from("site_settings").upsert({
      key: "usd_to_inr_rate",
      value: { rate, source: "manual", auto_fetch: autoFetch },
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    }, { onConflict: "key" });
    if (error) {
      toast({ title: t("aw.saveRateFailed"), description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["site-setting", "usd_to_inr_rate"] });
      toast({ title: `Exchange rate set to ${formatINRFixed(Number(rate))}` });
    }
  };

  const [wNotes, setWNotes] = useState<Record<string, string>>({});

  // Payment Gateway Config
  const [gateways, setGateways] = useState<GatewayConfig>({
    stripe: { enabled: false, publishable_key: "", secret_key: "" },
    paypal: { enabled: false, client_id: "", secret: "", mode: "sandbox" },
    razorpay: { enabled: false, key_id: "", key_secret: "" },
    upi: { enabled: false, upi_id: "", merchant_name: "" },
    bank: { enabled: false, account_name: "", account_number: "", ifsc: "", bank_name: "" },
  });
  const [gatewaySaving, setGatewaySaving] = useState(false);

  const fetchGateways = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-secure-settings", {
        body: { action: "read", key: "payment_gateways" },
      });
      if (!error && data?.settings?.payment_gateways) {
        const v = data.settings.payment_gateways as unknown as Partial<GatewayConfig>;
        setGateways(prev => ({
          stripe: { ...prev.stripe, ...v.stripe },
          paypal: { ...prev.paypal, ...v.paypal },
          razorpay: { ...prev.razorpay, ...v.razorpay },
          upi: { ...prev.upi, ...v.upi },
          bank: { ...prev.bank, ...v.bank },
        }));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to load gateway settings", description: message, variant: "destructive" });
    }
  };

  const saveGateways = async () => {
    setGatewaySaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-secure-settings", {
        body: { action: "write", key: "payment_gateways", value: gateways },
      });
      if (error || data?.error) {
        toast({ title: "Failed to save", description: error?.message || data?.error, variant: "destructive" });
      } else {
        toast({ title: "Payment gateway settings saved" });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to save", description: message, variant: "destructive" });
    }
    setGatewaySaving(false);
  };

  useEffect(() => { fetchGateways(); }, []);

  return (
    <div className="space-y-10">
      {/* Wallet Phase 2.3 — Reconciliation Audit (gifts + referrals) */}
      <WalletReconciliationAudit />

      {/* Payment Gateway Configuration */}
      <div className="border border-border p-6 space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
            <Settings className="h-3.5 w-3.5 inline mr-2" />{t("aw.gatewayConfig")}
          </span>
          <button onClick={saveGateways} disabled={gatewaySaving}
            className="px-5 py-2 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}>
            {gatewaySaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("aw.saveAll")}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          Configure payment methods below. Only enabled gateways with valid keys will appear for users on the Add Money page.
        </p>

        {/* Stripe */}
        <div className={`border p-4 space-y-3 transition-colors ${gateways.stripe.enabled ? "border-primary/40 bg-primary/5" : "border-border"}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={gateways.stripe.enabled} onChange={e => setGateways(g => ({ ...g, stripe: { ...g.stripe, enabled: e.target.checked } }))} className="accent-primary" />
            <span className="text-xs tracking-[0.15em] uppercase font-medium" style={{ fontFamily: "var(--font-heading)" }}>Stripe</span>
            <span className="text-[9px] text-muted-foreground ml-auto" style={{ fontFamily: "var(--font-body)" }}>Cards, Apple Pay, Google Pay</span>
          </label>
          {gateways.stripe.enabled && (
            <div className="flex flex-wrap gap-4">
              <GatewayField label="Publishable Key" value={gateways.stripe.publishable_key} onChange={v => setGateways(g => ({ ...g, stripe: { ...g.stripe, publishable_key: v } }))} placeholder="pk_test_..." />
              <GatewayField label="Secret Key" value={gateways.stripe.secret_key} onChange={v => setGateways(g => ({ ...g, stripe: { ...g.stripe, secret_key: v } }))} placeholder="sk_test_..." type="password" />
            </div>
          )}
        </div>

        {/* PayPal */}
        <div className={`border p-4 space-y-3 transition-colors ${gateways.paypal.enabled ? "border-primary/40 bg-primary/5" : "border-border"}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={gateways.paypal.enabled} onChange={e => setGateways(g => ({ ...g, paypal: { ...g.paypal, enabled: e.target.checked } }))} className="accent-primary" />
            <span className="text-xs tracking-[0.15em] uppercase font-medium" style={{ fontFamily: "var(--font-heading)" }}>PayPal</span>
            <span className="text-[9px] text-muted-foreground ml-auto" style={{ fontFamily: "var(--font-body)" }}>PayPal Checkout</span>
          </label>
          {gateways.paypal.enabled && (
            <div className="flex flex-wrap gap-4">
              <GatewayField label="Client ID" value={gateways.paypal.client_id} onChange={v => setGateways(g => ({ ...g, paypal: { ...g.paypal, client_id: v } }))} placeholder="Client ID" />
              <GatewayField label="Secret" value={gateways.paypal.secret} onChange={v => setGateways(g => ({ ...g, paypal: { ...g.paypal, secret: v } }))} placeholder="Secret" type="password" />
              <div className="min-w-[120px]">
                <label className="block text-[9px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>Mode</label>
                <select value={gateways.paypal.mode} onChange={e => setGateways(g => ({ ...g, paypal: { ...g.paypal, mode: e.target.value } }))}
                  className="bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs" style={{ fontFamily: "var(--font-body)" }}>
                  <option value="sandbox">Sandbox</option>
                  <option value="live">Live</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Razorpay */}
        <div className={`border p-4 space-y-3 transition-colors ${gateways.razorpay.enabled ? "border-primary/40 bg-primary/5" : "border-border"}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={gateways.razorpay.enabled} onChange={e => setGateways(g => ({ ...g, razorpay: { ...g.razorpay, enabled: e.target.checked } }))} className="accent-primary" />
            <span className="text-xs tracking-[0.15em] uppercase font-medium" style={{ fontFamily: "var(--font-heading)" }}>Razorpay</span>
            <span className="text-[9px] text-muted-foreground ml-auto" style={{ fontFamily: "var(--font-body)" }}>UPI, Cards, NetBanking (India)</span>
          </label>
          {gateways.razorpay.enabled && (
            <div className="flex flex-wrap gap-4">
              <GatewayField label="Key ID" value={gateways.razorpay.key_id} onChange={v => setGateways(g => ({ ...g, razorpay: { ...g.razorpay, key_id: v } }))} placeholder="rzp_test_..." />
              <GatewayField label="Key Secret" value={gateways.razorpay.key_secret} onChange={v => setGateways(g => ({ ...g, razorpay: { ...g.razorpay, key_secret: v } }))} placeholder="Secret" type="password" />
            </div>
          )}
        </div>

        {/* UPI Direct */}
        <div className={`border p-4 space-y-3 transition-colors ${gateways.upi.enabled ? "border-primary/40 bg-primary/5" : "border-border"}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={gateways.upi.enabled} onChange={e => setGateways(g => ({ ...g, upi: { ...g.upi, enabled: e.target.checked } }))} className="accent-primary" />
            <span className="text-xs tracking-[0.15em] uppercase font-medium" style={{ fontFamily: "var(--font-heading)" }}>UPI Direct</span>
            <span className="text-[9px] text-muted-foreground ml-auto" style={{ fontFamily: "var(--font-body)" }}>Manual UPI payment with QR</span>
          </label>
          {gateways.upi.enabled && (
            <div className="flex flex-wrap gap-4">
              <GatewayField label="UPI ID" value={gateways.upi.upi_id} onChange={v => setGateways(g => ({ ...g, upi: { ...g.upi, upi_id: v } }))} placeholder="merchant@upi" />
              <GatewayField label="Merchant Name" value={gateways.upi.merchant_name} onChange={v => setGateways(g => ({ ...g, upi: { ...g.upi, merchant_name: v } }))} placeholder="Business Name" />
            </div>
          )}
        </div>

        {/* Bank Transfer */}
        <div className={`border p-4 space-y-3 transition-colors ${gateways.bank.enabled ? "border-primary/40 bg-primary/5" : "border-border"}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={gateways.bank.enabled} onChange={e => setGateways(g => ({ ...g, bank: { ...g.bank, enabled: e.target.checked } }))} className="accent-primary" />
            <span className="text-xs tracking-[0.15em] uppercase font-medium" style={{ fontFamily: "var(--font-heading)" }}>Bank Transfer</span>
            <span className="text-[9px] text-muted-foreground ml-auto" style={{ fontFamily: "var(--font-body)" }}>Manual NEFT/IMPS/Wire</span>
          </label>
          {gateways.bank.enabled && (
            <div className="flex flex-wrap gap-4">
              <GatewayField label="Account Name" value={gateways.bank.account_name} onChange={v => setGateways(g => ({ ...g, bank: { ...g.bank, account_name: v } }))} placeholder="Account holder name" />
              <GatewayField label="Account Number" value={gateways.bank.account_number} onChange={v => setGateways(g => ({ ...g, bank: { ...g.bank, account_number: v } }))} placeholder="Account number" />
              <GatewayField label="IFSC Code" value={gateways.bank.ifsc} onChange={v => setGateways(g => ({ ...g, bank: { ...g.bank, ifsc: v } }))} placeholder="IFSC code" />
              <GatewayField label="Bank Name" value={gateways.bank.bank_name} onChange={v => setGateways(g => ({ ...g, bank: { ...g.bank, bank_name: v } }))} placeholder="Bank name" />
            </div>
          )}
        </div>
      </div>

      {/* Exchange Rate */}
      <div className="border border-border p-6 space-y-4">
        <span className="text-xs tracking-[0.2em] uppercase text-primary block" style={{ fontFamily: "var(--font-heading)" }}>
          <IndianRupee className="h-3.5 w-3.5 inline mr-2" />{t("aw.exchangeRate")}
        </span>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>1 USD = ₹</label>
            <input type="number" min="1" step="0.01" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)}
              className="w-32 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" style={{ fontFamily: "var(--font-body)" }} />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer" style={{ fontFamily: "var(--font-body)" }}>
            <input type="checkbox" checked={autoFetch} onChange={e => setAutoFetch(e.target.checked)} className="accent-primary" />
            {t("aw.autoFetch")}
          </label>
          <button onClick={saveRate}
            className="px-5 py-2 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity"
            style={{ fontFamily: "var(--font-heading)" }}>{t("aw.saveRate")}</button>
        </div>
      </div>

      {/* Credit User Wallet */}
      <div className="border border-border p-6 space-y-4">
        <span className="text-xs tracking-[0.2em] uppercase text-primary block" style={{ fontFamily: "var(--font-heading)" }}>
          <Gift className="h-3.5 w-3.5 inline mr-2" />{t("aw.creditUserWallet")}
        </span>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{t("aw.searchByName")}</label>
            <div className="flex gap-2">
              <input type="text" value={targetEmail} onChange={e => setTargetEmail(e.target.value)} placeholder={t("aw.phUserName")}
                className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" style={{ fontFamily: "var(--font-body)" }} />
              <button onClick={lookupUser} className="px-4 py-2 border border-border text-xs tracking-[0.15em] uppercase hover:border-primary/50 transition-all" style={{ fontFamily: "var(--font-heading)" }}>{t("aw.find")}</button>
            </div>
            {targetUserId && <p className="text-xs text-primary mt-1" style={{ fontFamily: "var(--font-body)" }}>✓ {targetName}</p>}
          </div>
        </div>
        {targetUserId && (
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{t("aw.amountUsd")}</label>
              <input type="number" min="0.01" step="0.01" value={creditAmount} onChange={e => setCreditAmount(e.target.value)}
                className="w-32 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" style={{ fontFamily: "var(--font-body)" }} />
            </div>
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{t("aw.type")}</label>
              <select value={creditType} onChange={e => setCreditType(e.target.value)}
                className="bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" style={{ fontFamily: "var(--font-body)" }}>
                <option value="prize_winning">{t("wal.txn.prize_winning")}</option>
                <option value="gift">{t("wal.txn.gift")}</option>
                <option value="refund">{t("wal.txn.refund")}</option>
                <option value="honorarium">{t("wal.txn.honorarium")}</option>
                <option value="promo_credit">{t("wal.txn.promo_credit")}</option>
                <option value="referral_earning">{t("wal.txn.referral_earning")}</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{t("cm.description")}</label>
              <input type="text" value={creditDesc} onChange={e => setCreditDesc(e.target.value)} placeholder={t("aw.phCreditDesc")}
                className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm" style={{ fontFamily: "var(--font-body)" }} />
            </div>
            <button onClick={creditWallet} disabled={processing}
              className="px-5 py-2 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}>
              {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("aw.credit")}
            </button>
          </div>
        )}
      </div>

      {/* Withdrawal Requests */}
      <div>
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-heading)" }}>
          <Banknote className="h-3.5 w-3.5 inline mr-2" />{t("aw.withdrawalRequests")} ({withdrawals.length})
        </span>
        {withdrawals.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border">
            <Banknote className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>{t("aw.noWithdrawals")}</p>
          </div>
        ) : (
          <div className="border border-border divide-y divide-border">
            {withdrawals.map((w) => (
              <div key={w.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm" style={{ fontFamily: "var(--font-heading)" }}>{w.user_name} — {formatUSDFixed(Number(w.amount))}</p>
                    <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                      {new Date(w.created_at).toLocaleDateString()} · {t("wal.bank")} {w.bank_details ? t("aw.bankProvided") : "N/A"}
                    </p>
                  </div>
                  <span className={`text-[9px] tracking-[0.2em] uppercase px-3 py-1 border ${
                    w.status === "pending" ? "text-yellow-500 border-yellow-500" :
                    w.status === "approved" ? "text-primary border-primary" :
                    "text-destructive border-destructive"
                  }`} style={{ fontFamily: "var(--font-heading)" }}>{w.status}</span>
                </div>
                {w.status === "pending" && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <input type="text" placeholder={t("aw.phAdminNote")} value={wNotes[w.id] || ""} onChange={e => setWNotes(p => ({ ...p, [w.id]: e.target.value }))}
                      className="flex-1 bg-transparent border-b border-border focus:border-primary outline-none py-2 text-xs" style={{ fontFamily: "var(--font-body)" }} />
                    <button onClick={() => updateWithdrawal(w.id, "approved", wNotes[w.id] || "")}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-primary hover:opacity-70"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      <CheckCircle className="h-3.5 w-3.5" /> {t("aw.approve")}
                    </button>
                    <button onClick={() => updateWithdrawal(w.id, "rejected", wNotes[w.id] || "")}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-destructive hover:opacity-70"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      <XCircle className="h-3.5 w-3.5" /> {t("aw.reject")}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {hasMore && (
              <div className="p-4 text-center">
                <button onClick={() => fetchWithdrawals(page + 1)}
                  className="text-[10px] tracking-[0.15em] uppercase text-primary hover:opacity-70"
                  style={{ fontFamily: "var(--font-heading)" }}>
                  {t("aw.loadMore")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminWalletTab;
