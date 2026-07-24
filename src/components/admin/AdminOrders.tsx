/**
 * AdminOrders — Order tracking for paid competition entries.
 * Shows every row in `competition_orders` with filters + CSV export.
 * Uses high-density admin table styling (per memory style/admin-panel-ui).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { useT } from "@/i18n/I18nContext";

type OrderRow = {
  id: string;
  order_no: string;
  user_id: string;
  competition_id: string;
  entry_id: string | null;
  order_type: string;
  amount: number;
  wallet_txn_id: string | null;
  status: string;
  created_at: string;
};

type Profile = { id: string; full_name: string | null; custom_url: string | null };
type Competition = { id: string; title: string };

const HEAD = { fontFamily: "var(--font-heading)" } as const;
const BODY = { fontFamily: "var(--font-body)" } as const;

export default function AdminOrders() {
  const t = useT();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [comps, setComps] = useState<Record<string, Competition>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("competition_orders" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) { setLoading(false); return; }
    const rows = (data as any as OrderRow[]) ?? [];
    setOrders(rows);

    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const compIds = Array.from(new Set(rows.map((r) => r.competition_id)));

    const [pRes, cRes] = await Promise.all([
      userIds.length
        ? supabase.from("profiles").select("id, full_name, custom_url").in("id", userIds)
        : Promise.resolve({ data: [] as Profile[] }) as any,
      compIds.length
        ? supabase.from("competitions").select("id, title").in("id", compIds)
        : Promise.resolve({ data: [] as Competition[] }) as any,
    ]);
    const pMap: Record<string, Profile> = {};
    ((pRes.data ?? []) as Profile[]).forEach((p) => { pMap[p.id] = p; });
    setProfiles(pMap);
    const cMap: Record<string, Competition> = {};
    ((cRes.data ?? []) as Competition[]).forEach((c) => { cMap[c.id] = c; });
    setComps(cMap);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      const p = profiles[r.user_id];
      const c = comps[r.competition_id];
      const hay = `${r.order_no} ${p?.full_name ?? ""} ${p?.custom_url ?? ""} ${c?.title ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [orders, profiles, comps, statusFilter, search]);

  const exportCsv = () => {
    const rows = [
      ["order_no", "status", "user", "competition", "amount", "wallet_txn_id", "entry_id", "created_at"],
      ...filtered.map((r) => {
        const p = profiles[r.user_id];
        const c = comps[r.competition_id];
        return [
          r.order_no,
          r.status,
          p?.full_name ?? p?.custom_url ?? r.user_id,
          c?.title ?? r.competition_id,
          String(r.amount),
          r.wallet_txn_id ?? "",
          r.entry_id ?? "",
          r.created_at,
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `competition_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalAmount = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="space-y-4 px-3 md:px-0">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base md:text-lg font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            {t("ao.heading")} <em className="italic text-primary">{t("ao.headingSub")}</em>
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1" style={BODY}>
            {filtered.length} / {orders.length} {t("ao.ofOrders")} {formatUSDFixed(totalAmount)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} className="text-[11px]">
          <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder={t("ao.phSearch")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-xs"
          style={BODY}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs" style={BODY}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("ao.allStatuses")}</SelectItem>
            <SelectItem value="completed">{t("ao.completed")}</SelectItem>
            <SelectItem value="refunded">{t("ao.refunded")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 text-[10px] tracking-[0.15em] uppercase" style={HEAD}>{t("at.thOrderNo")}</TableHead>
                <TableHead className="h-9 text-[10px] tracking-[0.15em] uppercase" style={HEAD}>{t("ref.status")}</TableHead>
                <TableHead className="h-9 text-[10px] tracking-[0.15em] uppercase" style={HEAD}>{t("at.thUser")}</TableHead>
                <TableHead className="h-9 text-[10px] tracking-[0.15em] uppercase" style={HEAD}>{t("win.competition")}</TableHead>
                <TableHead className="h-9 text-[10px] tracking-[0.15em] uppercase text-right" style={HEAD}>{t("at.thAmount")}</TableHead>
                <TableHead className="h-9 text-[10px] tracking-[0.15em] uppercase" style={HEAD}>{t("ao.walletTxn")}</TableHead>
                <TableHead className="h-9 text-[10px] tracking-[0.15em] uppercase" style={HEAD}>{t("ao.dateUtc")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground" style={BODY}>
                    {t("ao.noOrders")}
                  </TableCell>
                </TableRow>
              ) : filtered.map((r) => {
                const p = profiles[r.user_id];
                const c = comps[r.competition_id];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="py-2 text-xs font-mono" style={BODY}>{r.order_no}</TableCell>
                    <TableCell className="py-2 text-xs" style={BODY}>
                      <span className={r.status === "refunded" ? "text-amber-500" : "text-primary"}>
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-xs" style={BODY}>
                      {p?.full_name || p?.custom_url || <span className="text-muted-foreground">{r.user_id.slice(0, 8)}…</span>}
                    </TableCell>
                    <TableCell className="py-2 text-xs" style={BODY}>{c?.title ?? "—"}</TableCell>
                    <TableCell className="py-2 text-xs text-right tabular-nums" style={BODY}>
                      {formatUSDFixed(Number(r.amount))}
                    </TableCell>
                    <TableCell className="py-2 text-[10px] font-mono text-muted-foreground" style={BODY}>
                      {r.wallet_txn_id ? `${r.wallet_txn_id.slice(0, 8)}…` : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-[10px] text-muted-foreground" style={BODY}>
                      {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
