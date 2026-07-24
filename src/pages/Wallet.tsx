import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet as WalletIcon, Plus, ArrowDownLeft, ArrowUpRight, Download, CreditCard, Loader2, Banknote, IndianRupee, AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useWallet, WalletTransaction } from "@/hooks/wallet/useWallet";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useWalletPageData } from "@/hooks/wallet/useWalletPageData";
import { useWalletDeposits } from "@/hooks/wallet/useWalletDeposits";
import { useWalletWithdrawals } from "@/hooks/wallet/useWalletWithdrawals";
import { toast } from "@/hooks/core/use-toast";
import { motion } from "framer-motion";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { formatINR, formatUSD, formatUSDFixed, formatINRFixed, formatINRShort } from "@/lib/currencyFormat";
import { queryKeys } from "@/lib/queryKeys";
import { fireConversion } from "@/lib/adConversionContext";
import RewardedAdEntry from "@/components/ads/RewardedAdEntry";
import { useT } from "@/i18n/I18nContext";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }),
};

const txnTypeLabel: Record<string, string> = {
  deposit: "Deposit",
  competition_fee: "Competition Fee",
  course_purchase: "Course Purchase",
  prize_winning: "Prize Winnings",
  refund: "Refund",
  withdrawal: "Withdrawal",
  referral_earning: "Referral Reward",
  referral_bonus: "Referral Welcome Bonus",
  honorarium: "Judging Honorarium",
  gift: "Gift from Admin",
  gift_expiry: "Gift Expired",
  vote_reward: "Vote Reward",
  promo_credit: "Promo Credit",
};

const txnIcon = (type: string) => {
  const credit = ["deposit", "prize_winning", "refund", "referral_earning", "referral_bonus", "honorarium", "gift", "promo_credit", "vote_reward"];
  return credit.includes(type) ? (
    <ArrowDownLeft className="h-4 w-4 text-primary" />
  ) : (
    <ArrowUpRight className="h-4 w-4 text-destructive" />
  );
};

const Wallet = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const { balance, transactions, exchangeRate, loading, toINR, refresh } = useWallet();
  const t = useT();
  const tr = t; // alias — the transaction list below shadows `t` as its map variable
  const { data: walletPageData } = useWalletPageData(user?.id);
  const { submitDeposit, isSubmitting: depositSubmitting } = useWalletDeposits();
  const { submitWithdrawal, isSubmitting: withdrawalSubmitting } = useWalletWithdrawals();

  const expiringBalance = walletPageData?.expiringBalance || { amount: 0, soonest: null, count: 0 };
  const paymentGateways = walletPageData?.paymentGateways as any;
  const [savedBankDetails, setSavedBankDetails] = useState<any>(null);
  const pendingWithdrawals = walletPageData?.pendingWithdrawals || [];

  // Sync saved bank details from query
  useEffect(() => {
    if (walletPageData?.savedBankDetails) {
      setSavedBankDetails(walletPageData.savedBankDetails);
    }
  }, [walletPageData?.savedBankDetails]);

  const [showAddMoney, setShowAddMoney] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const [addCurrency, setAddCurrency] = useState<"usd" | "inr">("usd");
  
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawCurrency, setWithdrawCurrency] = useState<"usd" | "inr">("usd");
  const [currencyDisplay, setCurrencyDisplay] = useState<"usd" | "inr">("usd");
  const [ledgerYears, setLedgerYears] = useState(1);
  const [upiStep, setUpiStep] = useState<"idle" | "details" | "submitting">("idle");
  const [upiTxnRef, setUpiTxnRef] = useState("");
  const [bankStep, setBankStep] = useState<"idle" | "details" | "submitting">("idle");
  const [bankTxnRef, setBankTxnRef] = useState("");
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [wBankName, setWBankName] = useState("");
  const [wAccountName, setWAccountName] = useState("");
  const [wAccountNumber, setWAccountNumber] = useState("");
  const [wIfsc, setWIfsc] = useState("");
  const [gatewayLoading, setGatewayLoading] = useState<string | null>(null);
  const [returnBanner, setReturnBanner] = useState<
    | { kind: "success"; gateway: string; amount?: number }
    | { kind: "cancelled"; gateway: string }
    | { kind: "error"; gateway: string; message: string }
    | { kind: "processing"; gateway: string }
    | null
  >(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  // Handle gateway return (PayPal capture, Stripe success/cancel)
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const paypalToken = params.get("token"); // PayPal returns ?token=<order_id>&PayerID=...
    const payerId = params.get("PayerID");

    const cleanUrl = () => {
      const url = new URL(window.location.href);
      ["payment", "token", "PayerID"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, "", url.pathname + (url.search ? "?" + url.searchParams.toString() : ""));
    };

    // PayPal return — capture the order
    if (paypalToken && payerId) {
      setReturnBanner({ kind: "processing", gateway: "PayPal" });
      (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("paypal-capture-order", {
            body: { order_id: paypalToken },
          });
          if (error || data?.error) {
            setReturnBanner({ kind: "error", gateway: "PayPal", message: data?.error || error?.message || "Capture failed" });
          } else {
            setReturnBanner({ kind: "success", gateway: "PayPal", amount: data?.amount });
            fireConversion("payment_success", { gateway: "paypal", amount: data?.amount });
            await refresh();
          }
        } catch (err: any) {
          setReturnBanner({ kind: "error", gateway: "PayPal", message: err.message || "Capture failed" });
        } finally {
          cleanUrl();
        }
      })();
      return;
    }

    // Stripe (and PayPal cancel) return banner
    if (payment === "success") {
      setReturnBanner({ kind: "success", gateway: "Stripe" });
      fireConversion("payment_success", { gateway: "stripe" });
      refresh();
      cleanUrl();
    } else if (payment === "cancelled") {
      setReturnBanner({ kind: "cancelled", gateway: "Payment" });
      cleanUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>{t("common.loading")}</div>
      </main>
    );
  }

  if (!user) { navigate("/login"); return null; }

  const formatCurrency = (amount: number) => {
    if (currencyDisplay === "inr") {
      return formatINR(toINR(amount));
    }
    return formatUSD(amount);
  };

  // Check which gateways are enabled
  const hasAnyGateway = paymentGateways && (
    paymentGateways.stripe?.enabled ||
    paymentGateways.paypal?.enabled ||
    paymentGateways.razorpay?.enabled ||
    paymentGateways.upi?.enabled ||
    paymentGateways.bank?.enabled
  );

  // Convert entered amount to USD regardless of input currency
  const getAmountInUSD = (raw?: string): number => {
    const val = parseFloat(raw || addAmount);
    if (!val || val <= 0) return 0;
    return addCurrency === "inr" ? val / exchangeRate.rate : val;
  };

  const handleGatewayPayment = async (gateway: string) => {
    const amtUSD = getAmountInUSD();
    if (!amtUSD || amtUSD <= 0) {
      toast({ title: t("wal.enterValidAmount"), variant: "destructive" });
      return;
    }
    if (gateway === "UPI") {
      setUpiStep("details");
      return;
    }
    if (gateway === "Bank Transfer") {
      setBankStep("details");
      return;
    }

    const gatewayKey = gateway.toLowerCase() as "stripe" | "razorpay" | "paypal";
    setGatewayLoading(gateway);

    try {
      const { data, error } = await supabase.functions.invoke("create-payment-session", {
        body: { amount: amtUSD, currency: "usd", gateway: gatewayKey },
      });

      if (error || data?.error) {
        toast({ title: t("wal.paymentFailedTitle"), description: data?.error || error?.message || t("wal.noSession"), variant: "destructive" });
        setGatewayLoading(null);
        return;
      }

      if (gatewayKey === "stripe" && data?.url) {
        // Conversion tracked on return via useGlobalConversionTracker
        window.location.href = data.url;
        return;
      }

      if (gatewayKey === "razorpay" && data?.order_id) {
        // Load Razorpay script dynamically
        if (!(window as any).Razorpay) {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.async = true;
          await new Promise<void>((resolve, reject) => {
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load Razorpay SDK"));
            document.body.appendChild(script);
          });
        }
        const rzp = new (window as any).Razorpay({
          key: data.key_id,
          amount: data.amount,
          currency: data.currency,
          order_id: data.order_id,
          name: "50mm Retina World",
          description: "Wallet Top-up",
          handler: async (resp: any) => {
            setReturnBanner({ kind: "processing", gateway: "Razorpay" });
            try {
              const { data: vData, error: vErr } = await supabase.functions.invoke("razorpay-verify-payment", {
                body: {
                  razorpay_order_id: resp.razorpay_order_id,
                  razorpay_payment_id: resp.razorpay_payment_id,
                  razorpay_signature: resp.razorpay_signature,
                },
              });
              if (vErr || vData?.error) {
                setReturnBanner({ kind: "error", gateway: "Razorpay", message: vData?.error || vErr?.message || "Verification failed" });
                return;
              }
              setReturnBanner({ kind: "success", gateway: "Razorpay", amount: vData?.amount });
              fireConversion("payment_success", { gateway: "razorpay", amount: vData?.amount });
              await refresh();
            } catch (e: any) {
              setReturnBanner({ kind: "error", gateway: "Razorpay", message: e.message || "Verification failed" });
            } finally {
              setShowAddMoney(false);
              setAddAmount("");
            }
          },
          modal: {
            ondismiss: () => setGatewayLoading(null),
          },
        });
        rzp.open();
        setGatewayLoading(null);
        return;
      }

      if (gatewayKey === "paypal" && data?.url) {
        // Conversion tracked on return via useGlobalConversionTracker
        window.location.href = data.url;
        return;
      }

      toast({ title: t("wal.unexpectedResponse"), variant: "destructive" });
    } catch (err: any) {
      toast({ title: t("wal.paymentError"), description: err.message || t("common.somethingWrong"), variant: "destructive" });
    }
    setGatewayLoading(null);
  };

  const handleUpiConfirm = async () => {
    const amt = getAmountInUSD();
    if (!amt || amt <= 0) {
      toast({ title: t("wal.enterValidAmount"), variant: "destructive" });
      return;
    }
    if (!upiTxnRef.trim()) {
      toast({ title: t("wal.enterUpiRef"), variant: "destructive" });
      return;
    }
    setUpiStep("submitting");
    try {
      await submitDeposit({
        amountUSD: amt,
        gateway: "upi",
        reference: upiTxnRef.trim(),
        metadata: {
          upi_reference: upiTxnRef.trim(),
          upi_id: paymentGateways?.upi?.upi_id || "",
          amount_inr: toINR(amt),
        },
      });
      setUpiStep("idle");
      setUpiTxnRef("");
      setAddAmount("");
      setShowAddMoney(false);
      await refresh();
    } catch {
      setUpiStep("details");
    }
  };

  const handleBankConfirm = async () => {
    const amt = getAmountInUSD();
    if (!amt || amt <= 0) {
      toast({ title: t("wal.enterValidAmount"), variant: "destructive" });
      return;
    }
    if (!bankTxnRef.trim()) {
      toast({ title: t("wal.enterBankRef"), variant: "destructive" });
      return;
    }
    setBankStep("submitting");
    try {
      await submitDeposit({
        amountUSD: amt,
        gateway: "bank_transfer",
        reference: bankTxnRef.trim(),
        metadata: {
          bank_reference: bankTxnRef.trim(),
          bank_name: paymentGateways?.bank?.bank_name || "",
          amount_inr: toINR(amt),
        },
      });
      setBankStep("idle");
      setBankTxnRef("");
      setAddAmount("");
      setShowAddMoney(false);
      await refresh();
    } catch {
      setBankStep("details");
    }
  };

  const getWithdrawAmountUSD = (): number => {
    const val = parseFloat(withdrawAmount);
    if (!val || val <= 0) return 0;
    return withdrawCurrency === "inr" ? val / exchangeRate.rate : val;
  };

  const handleWithdraw = async () => {
    const amt = getWithdrawAmountUSD();
    if (!amt || amt < 1) {
      toast({ title: `${t("wal.minWithdrawal")} ${formatUSD(1)}`, variant: "destructive" });
      return;
    }
    if (amt > balance) {
      toast({ title: t("wal.insufficientBalance"), description: `${t("wal.yourBalanceIs")} ${formatUSDFixed(balance)}`, variant: "destructive" });
      return;
    }
    const bankInfo = savedBankDetails?.bank_account_number?.trim()
      ? {
          bank_name: savedBankDetails.bank_name,
          account_name: savedBankDetails.bank_account_name,
          account_number: savedBankDetails.bank_account_number,
          ifsc: savedBankDetails.bank_ifsc,
        }
      : {
          bank_name: wBankName.trim(),
          account_name: wAccountName.trim(),
          account_number: wAccountNumber.trim(),
          ifsc: wIfsc.trim(),
        };
    if (!bankInfo.account_number) {
      toast({ title: t("wal.enterAccountNumber"), variant: "destructive" });
      return;
    }
    if (!bankInfo.account_name) {
      toast({ title: t("wal.enterAccountHolder"), variant: "destructive" });
      return;
    }
    if (pendingWithdrawals.length > 0) {
      toast({ title: t("wal.alreadyPending"), description: t("wal.waitForAdmin"), variant: "destructive" });
      return;
    }
    setWithdrawSubmitting(true);
    try {
      const needsSave = !savedBankDetails?.bank_account_number?.trim() && !!bankInfo.account_number;
      await submitWithdrawal({
        amountUSD: amt,
        bankInfo,
        saveBankDetails: needsSave,
      });
      if (needsSave) {
        setSavedBankDetails({
          bank_name: bankInfo.bank_name,
          bank_account_name: bankInfo.account_name,
          bank_account_number: bankInfo.account_number,
          bank_ifsc: bankInfo.ifsc,
        });
      }
      setShowWithdraw(false);
      setWithdrawAmount("");
      await refresh();
    } catch {
      // error handled by hook
    }
    setWithdrawSubmitting(false);
  };

  const generateLedgerPDF = () => {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - ledgerYears);
    const filtered = transactions.filter(t => new Date(t.created_at) >= cutoff);

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Wallet Transaction Ledger", 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);
    doc.text(`Period: Last ${ledgerYears} year(s) | ${filtered.length} transactions`, 14, 36);
    doc.text(`Exchange Rate: 1 USD = ${formatINRFixed(exchangeRate.rate)}`, 14, 42);

    let y = 52;
    doc.setFontSize(8);
    doc.text("Date", 14, y);
    doc.text("Type", 50, y);
    doc.text("USD", 110, y);
    doc.text("INR", 140, y);
    doc.text("Balance (USD)", 165, y);
    y += 2;
    doc.line(14, y, 196, y);
    y += 6;

    for (const t of filtered) {
      if (y > 280) { doc.addPage(); y = 20; }
      const date = new Date(t.created_at).toLocaleDateString();
      doc.text(date, 14, y);
      doc.text(txnTypeLabel[t.type] || t.type, 50, y);
      doc.text(formatUSDFixed(Number(t.amount)), 110, y);
      doc.text(formatINRFixed(Number(t.amount) * exchangeRate.rate), 140, y);
      doc.text(formatUSDFixed(Number(t.balance_after)), 165, y);
      y += 6;
    }

    doc.save(`wallet-ledger-${ledgerYears}yr.pdf`);
    toast({ title: t("wal.ledgerDownloaded") });
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-20 max-w-4xl">

        <div className="flex items-center gap-4 mb-2">
          <div className="w-12 h-px bg-primary" />
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.eWallet")}</span>
        </div>
        <h1 className="text-2xl md:text-5xl font-light tracking-tight mb-4 md:mb-10" style={{ fontFamily: "var(--font-display)" }}>
          {t("wal.my")} <em className="italic text-primary">{t("wal.walletWord")}</em>
        </h1>

        {/* Rewarded ad — opt-in earn (self-hides until an admin sets amount + creative) */}
        <RewardedAdEntry onCredited={refresh} />

        {/* Payment return banner */}
        {returnBanner && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className={
              "border p-4 md:p-5 mb-6 rounded-md flex flex-col md:flex-row md:items-center md:justify-between gap-3 " +
              (returnBanner.kind === "success"
                ? "border-primary/40 bg-primary/5"
                : returnBanner.kind === "processing"
                ? "border-border bg-muted/30"
                : returnBanner.kind === "cancelled"
                ? "border-yellow-500/40 bg-yellow-500/5"
                : "border-destructive/40 bg-destructive/5")
            }
          >
            <div className="flex items-start gap-3">
              {returnBanner.kind === "processing" ? (
                <Loader2 className="h-5 w-5 text-muted-foreground animate-spin shrink-0 mt-0.5" />
              ) : returnBanner.kind === "success" ? (
                <ArrowDownLeft className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              ) : returnBanner.kind === "cancelled" ? (
                <Clock className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-medium" style={{ fontFamily: "var(--font-heading)" }}>
                  {returnBanner.kind === "success"
                    ? `${returnBanner.gateway} — ${t("wal.paymentReceived")}`
                    : returnBanner.kind === "processing"
                    ? `${returnBanner.gateway} — ${t("wal.confirmingPayment")}`
                    : returnBanner.kind === "cancelled"
                    ? `${returnBanner.gateway} — ${t("wal.paymentCancelled")}`
                    : `${returnBanner.gateway} — ${t("wal.paymentFailed")}`}
                </p>
                <p className="text-xs text-muted-foreground mt-1" style={{ fontFamily: "var(--font-body)" }}>
                  {returnBanner.kind === "success"
                    ? `${t("wal.credited")}${returnBanner.amount ? ` · ${formatUSDFixed(returnBanner.amount)}` : ""}`
                    : returnBanner.kind === "processing"
                    ? t("wal.dontClose")
                    : returnBanner.kind === "cancelled"
                    ? t("wal.noCharge")
                    : returnBanner.message}
                </p>
              </div>
            </div>
            {returnBanner.kind !== "processing" && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setReturnBanner(null)}
                  className="text-[10px] tracking-[0.2em] uppercase border border-border px-3 py-2 hover:bg-muted/50 transition-colors"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {t("wallet.dismiss")}
                </button>
                <button
                  onClick={() => navigate("/")}
                  className="text-[10px] tracking-[0.2em] uppercase bg-primary text-primary-foreground px-3 py-2 hover:bg-primary/90 transition-colors"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {t("wal.returnHome")}
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Balance Card */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}
          className="border border-border p-4 md:p-10 mb-4 md:mb-8 rounded-xl md:rounded-none"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>{t("wallet.availableBalance")}</span>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl md:text-5xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                  {formatUSDFixed(Number(balance))}
                </span>
                <span className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                  ≈ {formatINR(toINR(balance))}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2" style={{ fontFamily: "var(--font-body)" }}>
                1 USD ≈ {formatINRFixed(exchangeRate.rate)}
              </p>
              {expiringBalance.amount > 0 && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2 border border-yellow-500/40 bg-yellow-500/5 rounded-sm">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-medium text-yellow-700 dark:text-yellow-400" style={{ fontFamily: "var(--font-heading)" }}>
                      {formatUSDFixed(expiringBalance.amount)} {t("wal.expiringSoon")}
                    </p>
                    <p className="text-[9px] text-yellow-600/80 dark:text-yellow-500/80" style={{ fontFamily: "var(--font-body)" }}>
                      {expiringBalance.count} {t("wal.giftCreditsExpiry")}
                      {expiringBalance.soonest && (
                        <> · {t("wal.next")} {new Date(expiringBalance.soonest).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowAddMoney(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Plus className="h-3.5 w-3.5" /> {t("wallet.addMoney")}
              </button>
              <button
                onClick={() => setShowWithdraw(true)}
                className="inline-flex items-center gap-2 px-6 py-3 border border-border text-xs tracking-[0.2em] uppercase hover:border-primary/50 transition-all duration-500"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Banknote className="h-3.5 w-3.5" /> {t("wallet.withdraw")}
              </button>
              <button
                onClick={() => setCurrencyDisplay(c => c === "usd" ? "inr" : "usd")}
                className="inline-flex items-center gap-2 px-4 py-3 border border-border text-xs tracking-[0.2em] uppercase hover:border-primary/50 transition-all duration-500"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {currencyDisplay === "usd" ? <IndianRupee className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                {currencyDisplay === "usd" ? t("wal.showInr") : t("wal.showUsd")}
              </button>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-border/40 flex justify-center">
            <span
              className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {t("wal.poweredBy")} <span className="text-primary">Payeliana</span>
            </span>
          </div>
        </motion.div>

        {/* Add Money Form */}
        {showAddMoney && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="border border-primary/30 p-6 md:p-8 mb-8 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{t("wallet.addMoney")}</span>
              <button onClick={() => setShowAddMoney(false)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
            </div>
            {/* Currency Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.enterAmountIn")}</span>
              <div className="inline-flex border border-border rounded-sm overflow-hidden">
                <button onClick={() => { setAddCurrency("usd"); setAddAmount(""); }}
                  className={`px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase transition-all duration-300 ${addCurrency === "usd" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  style={{ fontFamily: "var(--font-heading)" }}>
                  $ USD
                </button>
                <button onClick={() => { setAddCurrency("inr"); setAddAmount(""); }}
                  className={`px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase transition-all duration-300 ${addCurrency === "inr" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  style={{ fontFamily: "var(--font-heading)" }}>
                  ₹ INR
                </button>
              </div>
            </div>

            {/* Quick Amount Buttons */}
            <div className="flex flex-wrap gap-2">
              {addCurrency === "usd"
                ? [10, 25, 50, 100].map(amt => (
                    <button key={amt} onClick={() => setAddAmount(String(amt))}
                      className={`px-4 py-2 border text-xs tracking-[0.15em] uppercase transition-all duration-300 ${addAmount === String(amt) ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-foreground/50"}`}
                      style={{ fontFamily: "var(--font-heading)" }}>
                      {formatUSDFixed(amt, 0)}
                    </button>
                  ))
                : [500, 1000, 2500, 5000].map(amt => (
                    <button key={amt} onClick={() => setAddAmount(String(amt))}
                      className={`px-4 py-2 border text-xs tracking-[0.15em] uppercase transition-all duration-300 ${addAmount === String(amt) ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-foreground/50"}`}
                      style={{ fontFamily: "var(--font-heading)" }}>
                      {formatINRShort(amt)}
                    </button>
                  ))
              }
            </div>
            <input
              type="number" min="1" step="0.01"
              placeholder={addCurrency === "usd" ? `${t("wal.customAmount")} ($)` : `${t("wal.customAmount")} (₹)`}
              value={addAmount} onChange={e => setAddAmount(e.target.value)}
              className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500"
              style={{ fontFamily: "var(--font-body)" }}
            />
            {addAmount && parseFloat(addAmount) > 0 && (
              <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {addCurrency === "usd"
                  ? <>≈ {formatINR(toINR(parseFloat(addAmount)))}</>
                  : <>≈ {formatUSD(parseFloat(addAmount) / exchangeRate.rate)}</>
                }
              </p>
            )}
            {/* Payment Methods */}
            {!hasAnyGateway ? (
              <div className="border border-dashed border-border p-4 text-center">
                <AlertTriangle className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                  {t("wal.noGateways")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
                  {t("wallet.choosePayment")}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {paymentGateways?.stripe?.enabled && (
                    <button onClick={() => handleGatewayPayment("Stripe")}
                      disabled={gatewayLoading === "Stripe"}
                      className="flex items-center gap-3 px-4 py-3 border border-border hover:border-primary/50 transition-all duration-300 text-left disabled:opacity-50"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      {gatewayLoading === "Stripe" ? <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" /> : <CreditCard className="h-4 w-4 text-primary shrink-0" />}
                      <div>
                        <span className="text-xs tracking-[0.1em] uppercase block">Stripe</span>
                        <span className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>Cards, Apple Pay, Google Pay</span>
                      </div>
                    </button>
                  )}
                  {paymentGateways?.paypal?.enabled && (
                    <button onClick={() => handleGatewayPayment("PayPal")}
                      disabled={gatewayLoading === "PayPal"}
                      className="flex items-center gap-3 px-4 py-3 border border-border hover:border-primary/50 transition-all duration-300 text-left disabled:opacity-50"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      {gatewayLoading === "PayPal" ? <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" /> : <ExternalLink className="h-4 w-4 text-primary shrink-0" />}
                      <div>
                        <span className="text-xs tracking-[0.1em] uppercase block">PayPal</span>
                        <span className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>PayPal Checkout</span>
                      </div>
                    </button>
                  )}
                  {paymentGateways?.razorpay?.enabled && (
                    <button onClick={() => handleGatewayPayment("Razorpay")}
                      disabled={gatewayLoading === "Razorpay"}
                      className="flex items-center gap-3 px-4 py-3 border border-border hover:border-primary/50 transition-all duration-300 text-left disabled:opacity-50"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      {gatewayLoading === "Razorpay" ? <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" /> : <IndianRupee className="h-4 w-4 text-primary shrink-0" />}
                      <div>
                        <span className="text-xs tracking-[0.1em] uppercase block">Razorpay</span>
                        <span className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>UPI, Cards, NetBanking</span>
                      </div>
                    </button>
                  )}
                  {paymentGateways?.upi?.enabled && upiStep === "idle" && (
                    <button onClick={() => handleGatewayPayment("UPI")}
                      className="flex items-center gap-3 px-4 py-3 border border-border hover:border-primary/50 transition-all duration-300 text-left"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      <Banknote className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <span className="text-xs tracking-[0.1em] uppercase block">UPI</span>
                        <span className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                          {paymentGateways.upi.upi_id || t("wal.directUpi")}
                        </span>
                      </div>
                    </button>
                  )}
                  {paymentGateways?.upi?.enabled && upiStep !== "idle" && (
                    <div className="sm:col-span-2 border border-primary/40 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.payViaUpi")}</span>
                        <button onClick={() => { setUpiStep("idle"); setUpiTxnRef(""); }} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
                      </div>
                      <div className="bg-muted/30 border border-border p-4 space-y-2">
                        <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.sendToUpi")}</p>
                        <p className="text-lg font-medium text-foreground tracking-wide" style={{ fontFamily: "var(--font-display)" }}>
                          {paymentGateways.upi.upi_id || "—"}
                        </p>
                        <p className="text-xs text-primary font-medium" style={{ fontFamily: "var(--font-body)" }}>
                          {t("wal.amount")} {formatINR(toINR(getAmountInUSD()))} ({formatUSDFixed(getAmountInUSD())})
                        </p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
                          {t("wal.upiRefLabel")}
                        </label>
                        <input
                          type="text"
                          value={upiTxnRef}
                          onChange={e => setUpiTxnRef(e.target.value)}
                          placeholder="e.g. 412345678901"
                          maxLength={50}
                          className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500"
                          style={{ fontFamily: "var(--font-body)" }}
                        />
                      </div>
                      <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                        {t("wal.upiInstructions")}
                      </p>
                      <button
                        onClick={handleUpiConfirm}
                        disabled={upiStep === "submitting" || depositSubmitting || !upiTxnRef.trim()}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {upiStep === "submitting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
                        {t("wal.confirmPayment")}
                      </button>
                    </div>
                  )}
                  {paymentGateways?.bank?.enabled && bankStep === "idle" && (
                    <button onClick={() => handleGatewayPayment("Bank Transfer")}
                      className="flex items-center gap-3 px-4 py-3 border border-border hover:border-primary/50 transition-all duration-300 text-left sm:col-span-2"
                      style={{ fontFamily: "var(--font-heading)" }}>
                      <Banknote className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <span className="text-xs tracking-[0.1em] uppercase block">Bank Transfer</span>
                        <span className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                          {paymentGateways.bank.bank_name ? `${paymentGateways.bank.bank_name} — NEFT/IMPS` : t("wal.manualBank")}
                        </span>
                      </div>
                    </button>
                  )}
                  {paymentGateways?.bank?.enabled && bankStep !== "idle" && (
                    <div className="sm:col-span-2 border border-primary/40 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.payViaBank")}</span>
                        <button onClick={() => { setBankStep("idle"); setBankTxnRef(""); }} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
                      </div>
                      <div className="bg-muted/30 border border-border p-4 space-y-2">
                        <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.transferToBank")}</p>
                        {paymentGateways.bank.bank_name && (
                          <p className="text-sm text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                            <strong>Bank:</strong> {paymentGateways.bank.bank_name}
                          </p>
                        )}
                        {paymentGateways.bank.account_number && (
                          <p className="text-sm text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                            <strong>Account:</strong> {paymentGateways.bank.account_number}
                          </p>
                        )}
                        {paymentGateways.bank.ifsc && (
                          <p className="text-sm text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                            <strong>IFSC:</strong> {paymentGateways.bank.ifsc}
                          </p>
                        )}
                        {paymentGateways.bank.account_name && (
                          <p className="text-sm text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                            <strong>Name:</strong> {paymentGateways.bank.account_name}
                          </p>
                        )}
                        <p className="text-xs text-primary font-medium" style={{ fontFamily: "var(--font-body)" }}>
                          {t("wal.amount")} {formatINR(toINR(parseFloat(addAmount) || 0))} ({formatUSDFixed(parseFloat(addAmount || "0"))})
                        </p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
                          {t("wal.bankRefLabel")}
                        </label>
                        <input
                          type="text"
                          value={bankTxnRef}
                          onChange={e => setBankTxnRef(e.target.value)}
                          placeholder="e.g. NEFT/IMPS reference number"
                          maxLength={50}
                          className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500"
                          style={{ fontFamily: "var(--font-body)" }}
                        />
                      </div>
                      <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                        {t("wal.bankInstructions")}
                      </p>
                      <button
                        onClick={handleBankConfirm}
                        disabled={bankStep === "submitting" || depositSubmitting || !bankTxnRef.trim()}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {bankStep === "submitting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
                        {t("wal.confirmPayment")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Pending Withdrawals */}
        {pendingWithdrawals.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="border border-yellow-500/30 bg-yellow-500/5 p-4 md:p-6 mb-4 space-y-3">
            <span className="text-[9px] tracking-[0.3em] uppercase text-yellow-600 dark:text-yellow-400 flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
              <Clock className="h-3.5 w-3.5" /> {t("wal.pendingWithdrawals")}
            </span>
            {pendingWithdrawals.map(w => (
              <div key={w.id} className="flex items-center justify-between text-xs border-t border-yellow-500/20 pt-2">
                <span style={{ fontFamily: "var(--font-body)" }}>
                  {formatUSDFixed(Number(w.amount))} · {new Date(w.created_at).toLocaleDateString()}
                </span>
                <span className="text-[9px] tracking-[0.15em] uppercase text-yellow-600 dark:text-yellow-400 px-2 py-0.5 border border-yellow-500/30 rounded-sm" style={{ fontFamily: "var(--font-heading)" }}>
                  {w.status}
                </span>
              </div>
            ))}
          </motion.div>
        )}

        {/* Withdraw Form */}
        {showWithdraw && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="border border-primary/30 p-6 md:p-8 mb-8 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.withdrawToBank")}</span>
              <button onClick={() => setShowWithdraw(false)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
            </div>

            {/* Currency Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.enterAmountIn")}</span>
              <div className="inline-flex border border-border rounded-sm overflow-hidden">
                <button onClick={() => { setWithdrawCurrency("usd"); setWithdrawAmount(""); }}
                  className={`px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase transition-all duration-300 ${withdrawCurrency === "usd" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  style={{ fontFamily: "var(--font-heading)" }}>
                  $ USD
                </button>
                <button onClick={() => { setWithdrawCurrency("inr"); setWithdrawAmount(""); }}
                  className={`px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase transition-all duration-300 ${withdrawCurrency === "inr" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  style={{ fontFamily: "var(--font-heading)" }}>
                  ₹ INR
                </button>
              </div>
            </div>

            <input
              type="number" min="1" step="0.01"
              placeholder={withdrawCurrency === "usd" ? `${t("wal.amount")} ($) — min $1.00` : `${t("wal.amount")} (₹)`}
              value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)}
              className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500"
              style={{ fontFamily: "var(--font-body)" }}
            />
            {withdrawAmount && parseFloat(withdrawAmount) > 0 && (
              <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {withdrawCurrency === "usd"
                  ? <>≈ {formatINR(toINR(parseFloat(withdrawAmount)))}</>
                  : <>≈ {formatUSD(parseFloat(withdrawAmount) / exchangeRate.rate)}</>
                }
                {" "}· {t("wal.available")} {formatUSDFixed(balance)}
              </p>
            )}

            {/* Saved Bank Details Preview */}
            {savedBankDetails?.bank_account_number ? (
              <div className="bg-muted/30 border border-border p-4 space-y-1">
                <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.withdrawingTo")}</p>
                {savedBankDetails.bank_name && (
                  <p className="text-xs text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    <strong>Bank:</strong> {savedBankDetails.bank_name}
                  </p>
                )}
                <p className="text-xs text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                  <strong>Account:</strong> ••••{savedBankDetails.bank_account_number.slice(-4)}
                </p>
                {savedBankDetails.bank_account_name && (
                  <p className="text-xs text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    <strong>Name:</strong> {savedBankDetails.bank_account_name}
                  </p>
                )}
                {savedBankDetails.bank_ifsc && (
                  <p className="text-xs text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    <strong>IFSC:</strong> {savedBankDetails.bank_ifsc}
                  </p>
                )}
              </div>
            ) : (
              <div className="border border-border p-4 space-y-3">
                <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.enterBankDetails")}</p>
                <input type="text" placeholder={t("wal.phAccountHolder")} value={wAccountName} onChange={e => setWAccountName(e.target.value)} maxLength={150}
                  className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm transition-colors" style={{ fontFamily: "var(--font-body)" }} />
                <input type="text" placeholder={t("wal.phAccountNumber")} value={wAccountNumber} onChange={e => setWAccountNumber(e.target.value)} maxLength={30}
                  className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm transition-colors" style={{ fontFamily: "var(--font-body)" }} />
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" placeholder={t("wal.phBankName")} value={wBankName} onChange={e => setWBankName(e.target.value)} maxLength={100}
                    className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm transition-colors" style={{ fontFamily: "var(--font-body)" }} />
                  <input type="text" placeholder={t("wal.phIfsc")} value={wIfsc} onChange={e => setWIfsc(e.target.value)} maxLength={20}
                    className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 text-sm transition-colors" style={{ fontFamily: "var(--font-body)" }} />
                </div>
                <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                  {t("wal.detailsSaved")}
                </p>
              </div>
            )}

            {pendingWithdrawals.length > 0 && (
              <div className="border border-yellow-500/30 bg-yellow-500/5 p-3 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-yellow-600 shrink-0" />
                <p className="text-[10px] text-yellow-700 dark:text-yellow-400" style={{ fontFamily: "var(--font-body)" }}>
                  {t("wal.pendingNote")}
                </p>
              </div>
            )}

            <button onClick={handleWithdraw} disabled={withdrawSubmitting || withdrawalSubmitting || pendingWithdrawals.length > 0}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {withdrawSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
              {t("wallet.submitWithdrawal")}
            </button>
          </motion.div>
        )}

        {/* Ledger Download */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={1}
          className="flex flex-wrap items-center gap-4 mb-8 p-4 border border-border"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("wal.downloadLedger")}</span>
          <div className="flex gap-2">
            {[1, 2, 3, 5].map(yr => (
              <button key={yr} onClick={() => setLedgerYears(yr)}
                className={`px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase border transition-all duration-300 ${ledgerYears === yr ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {yr}yr
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={generateLedgerPDF}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Download className="h-3 w-3" /> PDF (USD)
            </button>
            <button onClick={() => { setCurrencyDisplay("inr"); generateLedgerPDF(); setCurrencyDisplay("usd"); }}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 border border-border text-[10px] tracking-[0.15em] uppercase hover:border-primary/50 transition-all"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <IndianRupee className="h-3 w-3" /> PDF (INR)
            </button>
          </div>
        </motion.div>

        {/* Transaction History */}
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={2}>
          <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-heading)" }}>
            {t("wal.txnHistory")} ({transactions.length})
          </span>

          {transactions.length === 0 ? (
            <div className="border border-border p-10 text-center">
              <WalletIcon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>{t("wal.noTxns")}</p>
            </div>
          ) : (
            <div className="border border-border divide-y divide-border">
              {transactions.map(t => (
                <div key={t.id} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors duration-300">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    {txnIcon(t.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-light truncate" style={{ fontFamily: "var(--font-heading)" }}>
                      {tr("wal.txn." + t.type, txnTypeLabel[t.type] || t.type)}
                    </p>
                    {t.description && (
                      <p className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>{t.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                        {new Date(t.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {t.type === "gift" && t.metadata?.expires_at && (
                        <span className={`text-[9px] px-1.5 py-0.5 border rounded-sm ${t.status === "expired" || t.metadata?.is_expired ? "border-destructive/40 text-destructive bg-destructive/5" : "border-yellow-500/40 text-yellow-600 bg-yellow-500/5"}`}>
                          {t.status === "expired" || t.metadata?.is_expired ? tr("wal.expired") : <>{tr("wal.expires")} {new Date(t.metadata.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>}
                        </span>
                      )}
                      {t.type === "gift" && !t.metadata?.expires_at && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-primary/30 text-primary bg-primary/5 rounded-sm">{tr("wal.noExpiry")}</span>
                      )}
                      {t.status === "pending" && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-yellow-500/40 text-yellow-600 bg-yellow-500/5 rounded-sm flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" /> {tr("wal.pendingApproval")}
                        </span>
                      )}
                      {t.status === "rejected" && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-destructive/40 text-destructive bg-destructive/5 rounded-sm">{tr("dash.status.rejected")}</span>
                      )}
                      {t.status === "approved" && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-primary/40 text-primary bg-primary/5 rounded-sm">{tr("dash.status.approved")}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-medium ${Number(t.amount) >= 0 ? "text-primary" : "text-destructive"}`} style={{ fontFamily: "var(--font-heading)" }}>
                      {Number(t.amount) >= 0 ? "+" : ""}{formatCurrency(Number(t.amount))}
                    </p>
                    <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                      {tr("wal.bal")} {formatCurrency(Number(t.balance_after))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </main>
  );
};

export default Wallet;
