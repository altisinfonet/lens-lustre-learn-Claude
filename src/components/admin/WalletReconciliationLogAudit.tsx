/**
 * WalletReconciliationLogAudit — Phase 1 minimal recon visibility.
 * Read-only surface over `wallet_reconciliation_log`.
 * No mutations. No actions. Latest 25 rows + aggregate header.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, ClipboardList } from "lucide-react";

interface LogRow {
  id: string;
  created_at: string;
  finding_type: string;
  amount: number | null;
  transaction_id: string | null;
  notes: string | null;
}

interface Aggregate {
  total: number;
  distinctTypes: number;
  latest: string | null;
}

const WalletReconciliationLogAudit = () => {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = async () => {
    setLoading(true);
    setError(null);
    try {
      // Latest 25 rows for the table
      const latest = await supabase
        .from("wallet_reconciliation_log" as any)
        .select("id, created_at, finding_type, amount, transaction_id, notes")
        .order("created_at", { ascending: false })
        .limit(25);
      if (latest.error) throw latest.error;

      // Full aggregate (distinct finding_types + total + latest ts)
      const allTypes = await supabase
        .from("wallet_reconciliation_log" as any)
        .select("finding_type, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (allTypes.error) throw allTypes.error;

      const list = (allTypes.data as unknown as Array<{ finding_type: string; created_at: string }>) || [];
      setAgg({
        total: list.length,
        distinctTypes: new Set(list.map((r) => r.finding_type)).size,
        latest: list[0]?.created_at ?? null,
      });
      setRows((latest.data as unknown as LogRow[]) || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load wallet reconciliation log");
    } finally {
      setLoading(false);
    }
  };

  const hasRun = rows !== null;

  return (
    <div className="border-2 border-amber-500/40 rounded-lg p-5 bg-amber-500/5">
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold text-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <ClipboardList className="h-3.5 w-3.5 text-amber-500" />
          Wallet Reconciliation Log (read-only)
        </h3>
        <button
          onClick={fetchLog}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-amber-500 text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Scanning…" : !hasRun ? "Run Scan" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2 mt-2">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      {hasRun && !error && agg && (
        <div className="mt-2 space-y-3">
          <div
            className={`flex flex-wrap items-center gap-3 text-[10px] tracking-[0.1em] uppercase ${
              agg.total === 0 ? "text-green-500" : "text-amber-500"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {agg.total === 0 ? (
              <>
                <ShieldCheck className="h-3 w-3" /> Clean — 0 reconciliation findings
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" />
                <span>{agg.total} findings</span>
                <span className="text-muted-foreground">·</span>
                <span>{agg.distinctTypes} distinct types</span>
                <span className="text-muted-foreground">·</span>
                <span>latest {agg.latest ? new Date(agg.latest).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—"}</span>
              </>
            )}
          </div>

          {rows && rows.length > 0 && (
            <div className="border border-border max-h-72 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="text-left p-2 font-medium">When (UTC)</th>
                    <th className="text-left p-2 font-medium">Finding Type</th>
                    <th className="text-right p-2 font-medium">Amount</th>
                    <th className="text-left p-2 font-medium">Txn</th>
                    <th className="text-left p-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="p-2 font-mono text-[9px] whitespace-nowrap">
                        {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
                      </td>
                      <td className="p-2 text-amber-500">{r.finding_type}</td>
                      <td className="p-2 text-right font-mono">{r.amount ?? "—"}</td>
                      <td className="p-2 font-mono text-[9px]" title={r.transaction_id ?? ""}>
                        {r.transaction_id ? r.transaction_id.slice(0, 8) : "—"}
                      </td>
                      <td
                        className="p-2 text-muted-foreground text-[9px] max-w-[260px] truncate"
                        title={r.notes ?? ""}
                      >
                        {r.notes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!hasRun && !loading && !error && (
        <p
          className="text-xs text-muted-foreground italic mt-2"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Shows latest 25 reconciliation findings recorded by the wallet reconciliation pipeline. Read-only.
        </p>
      )}
    </div>
  );
};

export default WalletReconciliationLogAudit;
