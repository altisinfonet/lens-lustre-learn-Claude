import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Download, Search, Calendar, FileText, Table2, Globe, Loader2, ArrowDownLeft, ArrowUpRight, Filter, CheckCircle, XCircle } from "lucide-react";
import jsPDF from "jspdf";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";
import { useT } from "@/i18n/I18nContext";

interface Transaction {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  status: string;
  created_at: string;
  metadata: Json | null;
  reference_id: string | null;
  reference_type: string | null;
  user_name: string | null;
  user_email: string | null;
  order_no: string | null;
}

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
  platform_revenue: "Platform Revenue",
  course_revenue: "Course Revenue",
};

const creditTypes = ["deposit", "prize_winning", "refund", "referral_earning", "referral_bonus", "honorarium", "gift", "promo_credit", "vote_reward"];

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 1 year", days: 365 },
  { label: "Last 3 years", days: 365 * 3 },
  { label: "Last 5 years", days: 365 * 5 },
];

const TXN_PAGE_SIZE = 100;

const AdminTransactions = ({ user }: { user: User | null }) => {
  const t = useT();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [showHtml, setShowHtml] = useState(false);
  const [txnPage, setTxnPage] = useState(0);
  const [txnHasMore, setTxnHasMore] = useState(true);

  useEffect(() => {
    fetchTransactions(0);
  }, []);

  const fetchTransactions = async (pageNum = 0) => {
    setLoading(true);
    const from = pageNum * TXN_PAGE_SIZE;
    const to = from + TXN_PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, user_id, type, amount, balance_after, description, status, created_at, metadata, reference_id, reference_type")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      toast({ title: t("at.loadTxnsFailed"), description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(t => t.user_id))];
      const txnIds = data.map(t => t.id);

      const [profileMap, ordersRes] = await Promise.all([
        cachedFetchProfilesByIds(userIds),
        supabase
          .from("competition_orders")
          .select("order_no, wallet_txn_id")
          .in("wallet_txn_id", txnIds),
      ]);

      const orderMap = new Map<string, string>();
      (ordersRes.data || []).forEach((o: any) => {
        if (o.wallet_txn_id) orderMap.set(o.wallet_txn_id, o.order_no);
      });

      const mapped = data.map(t => ({
        ...t,
        user_name: profileMap.get(t.user_id) || null,
        user_email: null,
        order_no: orderMap.get(t.id) || null,
      }));
      setTransactions(prev => pageNum === 0 ? mapped : [...prev, ...mapped]);
      setTxnHasMore(data.length === TXN_PAGE_SIZE);
    } else {
      if (pageNum === 0) setTransactions([]);
      setTxnHasMore(false);
    }
    setTxnPage(pageNum);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (dateFrom && new Date(t.created_at) < dateFrom) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (new Date(t.created_at) > end) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const name = (t.user_name || "").toLowerCase();
        const desc = (t.description || "").toLowerCase();
        const type = (txnTypeLabel[t.type] || t.type).toLowerCase();
        if (!name.includes(q) && !desc.includes(q) && !type.includes(q) && !t.user_id.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, search, typeFilter, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const credits = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const debits = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    return { credits, debits, net: credits - debits };
  }, [filtered]);

  const applyPreset = (days: number) => {
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from);
    setDateTo(new Date());
  };

  const allTypes = useMemo(() => {
    const types = new Set(transactions.map(t => t.type));
    return Array.from(types).sort();
  }, [transactions]);

  const generateCSV = () => {
    const headers = ["Date", "Order No", "User", "Type", "Amount (USD)", "Balance After", "Description", "Status"];
    const rows = filtered.map(t => [
      new Date(t.created_at).toLocaleString(),
      t.order_no || "",
      t.user_name || t.user_id,
      txnTypeLabel[t.type] || t.type,
      Number(t.amount).toFixed(2),
      Number(t.balance_after).toFixed(2),
      (t.description || "").replace(/,/g, ";"),
      t.status,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: t("at.csvDownloaded") });
  };

  const generatePDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("All User Transactions — Admin Ledger", 14, 18);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 25);
    doc.text(`Period: ${dateFrom ? format(dateFrom, "PP") : "All"} to ${dateTo ? format(dateTo, "PP") : "Now"} | ${filtered.length} transactions`, 14, 31);
    doc.text(`Credits: ${formatUSDFixed(totals.credits)} | Debits: ${formatUSDFixed(totals.debits)} | Net: ${formatUSDFixed(totals.net)}`, 14, 37);

    let y = 47;
    doc.setFontSize(7);
    doc.text("Date", 14, y);
    doc.text("User", 55, y);
    doc.text("Type", 110, y);
    doc.text("Amount", 155, y);
    doc.text("Balance", 180, y);
    doc.text("Description", 205, y);
    y += 2;
    doc.line(14, y, 282, y);
    y += 5;

    for (const t of filtered) {
      if (y > 195) { doc.addPage(); y = 20; }
      doc.text(new Date(t.created_at).toLocaleDateString(), 14, y);
      doc.text((t.user_name || t.user_id.slice(0, 8)).slice(0, 30), 55, y);
      doc.text((txnTypeLabel[t.type] || t.type).slice(0, 25), 110, y);
      doc.text(formatUSDFixed(Number(t.amount)), 155, y);
      doc.text(formatUSDFixed(Number(t.balance_after)), 180, y);
      doc.text((t.description || "—").slice(0, 40), 205, y);
      y += 5;
    }

    doc.save(`transactions-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({ title: t("at.pdfDownloaded") });
  };

  const htmlContent = useMemo(() => {
    if (!showHtml) return "";
    return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Transaction Ledger</title>
<style>
body{font-family:system-ui;padding:20px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
th{background:#f5f5f5;font-weight:600}
.credit{color:green}.debit{color:red}
h1{font-size:18px;margin-bottom:4px}
.meta{color:#666;margin-bottom:12px}
</style></head><body>
<h1>All User Transactions — Admin Ledger</h1>
<p class="meta">Generated: ${new Date().toLocaleString()} | ${filtered.length} transactions<br/>
Credits: ${formatUSDFixed(totals.credits)} | Debits: ${formatUSDFixed(totals.debits)} | Net: ${formatUSDFixed(totals.net)}</p>
<table>
<thead><tr><th>Date</th><th>Order No</th><th>User</th><th>Type</th><th>Amount</th><th>Balance</th><th>Description</th><th>Status</th></tr></thead>
<tbody>
${filtered.map(t => `<tr>
<td>${new Date(t.created_at).toLocaleString()}</td>
<td>${t.order_no || "—"}</td>
<td>${t.user_name || t.user_id.slice(0, 8)}</td>
<td>${txnTypeLabel[t.type] || t.type}</td>
<td class="${Number(t.amount) >= 0 ? "credit" : "debit"}">${formatUSDFixed(Number(t.amount))}</td>
<td>${formatUSDFixed(Number(t.balance_after))}</td>
<td>${t.description || "—"}</td>
<td>${t.status}</td>
</tr>`).join("")}
</tbody></table></body></html>`;
  }, [showHtml, filtered, totals]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <div className="w-12 h-px bg-primary" />
        <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
          {t("at.allTransactions")}
        </span>
      </div>
      <h2 className="text-2xl font-light tracking-tight mb-6" style={{ fontFamily: "var(--font-display)" }}>
        {t("at.ledgerHeading")} <em className="italic text-primary">{t("at.ledgerWord")}</em>
      </h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="border border-border p-4">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>{t("at.totalTxns")}</span>
          <span className="text-2xl font-light" style={{ fontFamily: "var(--font-display)" }}>{filtered.length}</span>
        </div>
        <div className="border border-border p-4">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>{t("at.credits")}</span>
          <span className="text-2xl font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{formatUSDFixed(totals.credits)}</span>
        </div>
        <div className="border border-border p-4">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>{t("at.debits")}</span>
          <span className="text-2xl font-light text-destructive" style={{ fontFamily: "var(--font-display)" }}>{formatUSDFixed(totals.debits)}</span>
        </div>
        <div className="border border-border p-4">
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>Net</span>
          <span className="text-2xl font-light" style={{ fontFamily: "var(--font-display)" }}>{formatUSDFixed(totals.net)}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="border border-border p-4 mb-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("at.filters")}</span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("at.phSearch")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2.5 pl-9 pr-3 text-sm transition-colors duration-300"
            style={{ fontFamily: "var(--font-body)" }}
          />
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {/* Type filter */}
          <div>
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>{t("aw.type")}</span>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-transparent border border-border px-3 py-2 text-xs outline-none focus:border-primary transition-colors"
              style={{ fontFamily: "var(--font-body)" }}
            >
              <option value="all">{t("at.allTypes")}</option>
              {allTypes.map(t => (
                <option key={t} value={t}>{txnTypeLabel[t] || t}</option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>{t("at.from")}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("inline-flex items-center gap-2 border border-border px-3 py-2 text-xs transition-colors hover:border-primary/50", dateFrom ? "text-foreground" : "text-muted-foreground")} style={{ fontFamily: "var(--font-body)" }}>
                  <Calendar className="h-3 w-3" />
                  {dateFrom ? format(dateFrom, "PP") : "Start date"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarUI mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          </div>

          {/* Date To */}
          <div>
            <span className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>{t("at.to")}</span>
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("inline-flex items-center gap-2 border border-border px-3 py-2 text-xs transition-colors hover:border-primary/50", dateTo ? "text-foreground" : "text-muted-foreground")} style={{ fontFamily: "var(--font-body)" }}>
                  <Calendar className="h-3 w-3" />
                  {dateTo ? format(dateTo, "PP") : "End date"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarUI mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button key={p.days} onClick={() => applyPreset(p.days)}
                className="px-2.5 py-2 border border-border text-[9px] tracking-[0.1em] uppercase text-muted-foreground hover:border-primary/50 hover:text-foreground transition-all"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {p.label}
              </button>
            ))}
            <button onClick={() => { setDateFrom(undefined); setDateTo(undefined); setSearch(""); setTypeFilter("all"); }}
              className="px-2.5 py-2 border border-border text-[9px] tracking-[0.1em] uppercase text-destructive/70 hover:border-destructive/50 transition-all"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {t("ast.clear")}
            </button>
          </div>
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button onClick={generatePDF}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Download className="h-3 w-3" /> PDF
        </button>
        <button onClick={generateCSV}
          className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-[10px] tracking-[0.15em] uppercase hover:border-primary/50 transition-all"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Table2 className="h-3 w-3" /> CSV
        </button>
        <button onClick={() => setShowHtml(!showHtml)}
          className={cn("inline-flex items-center gap-2 px-5 py-2.5 border text-[10px] tracking-[0.15em] uppercase transition-all", showHtml ? "border-primary text-primary" : "border-border hover:border-primary/50")}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Globe className="h-3 w-3" /> {showHtml ? t("at.hideHtml") : t("at.viewHtml")}
        </button>
      </div>

      {/* HTML Preview */}
      {showHtml && (
        <div className="border border-border mb-6">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{t("at.htmlPreview")}</span>
            <button onClick={() => {
              const blob = new Blob([htmlContent], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `transactions-${format(new Date(), "yyyy-MM-dd")}.html`;
              a.click();
              URL.revokeObjectURL(url);
              toast({ title: t("at.htmlDownloaded") });
            }}
              className="text-[9px] tracking-[0.15em] uppercase text-primary hover:opacity-70 transition-opacity"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {t("at.downloadHtml")}
            </button>
          </div>
          <iframe srcDoc={htmlContent} className="w-full h-96 bg-background" title="Transaction Ledger HTML" />
        </div>
      )}

      {/* Transaction Table */}
      <div className="border border-border divide-y divide-border">
        <div className="hidden md:grid grid-cols-[1fr_0.9fr_1.1fr_0.9fr_0.7fr_0.7fr_1.1fr_0.7fr] gap-2 px-4 py-2.5 bg-muted/30">
          {[t("at.thDate"), t("at.thOrderNo"), t("at.thUser"), t("aw.type"), t("at.thAmount"), t("at.thBalance"), t("cm.description"), t("ref.status")].map(h => (
            <span key={h} className="text-[8px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>{h}</span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>{t("at.noTxns")}</p>
          </div>
        ) : (
          filtered.slice(0, 500).map(t => (
            <div key={t.id} className="grid grid-cols-1 md:grid-cols-[1fr_0.9fr_1.1fr_0.9fr_0.7fr_0.7fr_1.1fr_0.7fr] gap-1 md:gap-2 px-4 py-3 hover:bg-muted/20 transition-colors duration-200">
              <span className="text-[11px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {new Date(t.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                <span className="block text-[9px] opacity-60">{new Date(t.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
              </span>
              <span className="text-[10px] font-mono text-muted-foreground truncate" style={{ fontFamily: "var(--font-heading)" }} title={t.order_no || ""}>
                {t.order_no || <span className="opacity-40">—</span>}
              </span>
              <span className="text-[11px] truncate" style={{ fontFamily: "var(--font-body)" }}>
                {t.user_name || <span className="text-muted-foreground">{t.user_id.slice(0, 12)}…</span>}
              </span>
              <span className="text-[11px] flex items-center gap-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                {creditTypes.includes(t.type)
                  ? <ArrowDownLeft className="h-3 w-3 text-primary shrink-0" />
                  : <ArrowUpRight className="h-3 w-3 text-destructive shrink-0" />}
                {txnTypeLabel[t.type] || t.type}
              </span>
              <span className={cn("text-[11px] font-medium", Number(t.amount) >= 0 ? "text-primary" : "text-destructive")} style={{ fontFamily: "var(--font-heading)" }}>
                {Number(t.amount) >= 0 ? "+" : ""}{formatUSDFixed(Number(t.amount))}
              </span>
              <span className="text-[11px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                {formatUSDFixed(Number(t.balance_after))}
              </span>
              <span className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>
                {t.description || "—"}
              </span>
              <span className="text-[10px] flex items-center gap-1">
                {t.status === "pending" ? (
                  <span className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 border border-yellow-500/40 text-yellow-600 bg-yellow-500/5 rounded-sm text-[9px]">{t("fr.pending")}</span>
                    <button
                      onClick={async () => {
                        try {
                          const { data: result, error: rpcErr } = await supabase.rpc("approve_deposit" as any, {
                            _admin_id: user?.id,
                            _txn_id: t.id,
                          });
                          if (rpcErr) throw rpcErr;
                          // Notify user via Edge Function
                          await supabase.functions.invoke("manage-notifications", {
                            body: {
                              action: "insert_user_notification",
                              targetUserId: t.user_id,
                              type: "deposit_approved",
                              title: "Deposit Approved",
                              message: `Your deposit of ${formatUSDFixed(Number(t.amount))} has been approved and credited to your wallet.`,
                            },
                          });
                          toast({ title: t("at.depositApproved") });
                          fetchTransactions();
                        } catch (err: any) {
                          toast({ title: t("at.approveFailed"), description: err.message, variant: "destructive" });
                        }
                      }}
                      className="p-1 hover:text-primary transition-colors" title="Approve & credit wallet"
                    >
                      <CheckCircle className="h-3.5 w-3.5 text-primary" />
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const { error: rejectError } = await supabase.rpc("admin_reject_wallet_transaction", {
                            _admin_id: user?.id,
                            _txn_id: t.id,
                            _reason: null,
                          });
                          if (rejectError) throw rejectError;
                          // Notify user via Edge Function
                          await supabase.functions.invoke("manage-notifications", {
                            body: {
                              action: "insert_user_notification",
                              targetUserId: t.user_id,
                              type: "deposit_rejected",
                              title: "Deposit Rejected",
                              message: `Your deposit request of ${formatUSDFixed(Number(t.amount))} was rejected. Please contact support for details.`,
                            },
                          });
                          toast({ title: t("at.depositRejected") });
                          fetchTransactions(0);
                        } catch (err: any) {
                          toast({ title: t("at.rejectFailed"), description: err.message, variant: "destructive" });
                        }
                      }}
                      className="p-1 hover:text-destructive transition-colors" title="Reject"
                    >
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </span>
                ) : t.status === "rejected" ? (
                  <span className="px-1.5 py-0.5 border border-destructive/40 text-destructive bg-destructive/5 rounded-sm text-[9px]">{t("dash.status.rejected")}</span>
                ) : t.status === "approved" ? (
                  <span className="px-1.5 py-0.5 border border-primary/40 text-primary bg-primary/5 rounded-sm text-[9px]">{t("dash.status.approved")}</span>
                ) : (
                  <span className="text-muted-foreground text-[9px]">{t.status}</span>
                )}
              </span>
            </div>
          ))
        )}

        {txnHasMore && (
          <div className="px-4 py-3 text-center">
            <button
              onClick={() => fetchTransactions(txnPage + 1)}
              className="text-[10px] tracking-[0.15em] uppercase px-4 py-2 border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {t("at.loadMoreTxns")}
            </button>
          </div>
        )}

        {filtered.length > 500 && (
          <div className="px-4 py-3 text-center">
            <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              {t("at.showing500")} {filtered.length} {t("at.downloadFull")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminTransactions;
