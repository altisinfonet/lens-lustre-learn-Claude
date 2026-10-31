/**
 * WalletLedgerV2DiffAudit
 *
 * Phase-1A Step B (DRY-RUN MONITORING ONLY).
 * Reads the last N rows of public.wallet_ledger_v2_diff_log (RLS admin-read).
 * Renders a compact health card. NO mutations. NO actions besides "Refresh".
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, RefreshCw, Activity } from "lucide-react";

type DiffRow = {
  id: string;
  ran_at: string;
  live_wallet_transactions_total: number;
  shadow_log_total: number;
  matched: number;
  unmatched_live: number;
  unmatched_shadow: number;
  mismatch_count: number;
  error_count: number;
  alert_fired: boolean;
  wallets_checksum: string | null;
};

export default function WalletLedgerV2DiffAudit() {
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("wallet_ledger_v2_diff_log" as any)
      .select(
        "id, ran_at, live_wallet_transactions_total, shadow_log_total, matched, unmatched_live, unmatched_shadow, mismatch_count, error_count, alert_fired, wallets_checksum",
      )
      .order("ran_at", { ascending: false })
      .limit(24);
    if (error) setErr(error.message);
    setRows(((data as unknown) as DiffRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = rows[0];
  const anyAlert = rows.some((r) => r.alert_fired);

  return (
    <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3
          className="text-sm font-semibold text-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Activity className="h-3.5 w-3.5 inline mr-2" />
          Wallet Ledger v2 — Hourly Diff Monitor (DRY-RUN)
        </h3>
        <button
          onClick={() => void load()}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          disabled={loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {err ? (
        <div className="text-xs text-destructive">Error: {err}</div>
      ) : loading && rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !latest ? (
        <div className="text-xs text-muted-foreground">
          No snapshots yet. First cron tick at minute 7 of the next hour.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            {anyAlert ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-destructive/10 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Drift detected in last 24 snapshots
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                Clean — last 24 snapshots quiet
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              Latest: {new Date(latest.ran_at).toLocaleString()}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-4">
            <Stat label="Live (1h)" value={latest.live_wallet_transactions_total} />
            <Stat label="Shadow (1h)" value={latest.shadow_log_total} />
            <Stat label="Matched" value={latest.matched} />
            <Stat label="Mismatch" value={latest.mismatch_count} alert={latest.mismatch_count > 0} />
            <Stat label="Unmatched live" value={latest.unmatched_live} />
            <Stat label="Unmatched shadow" value={latest.unmatched_shadow} />
            <Stat label="Errors" value={latest.error_count} alert={latest.error_count > 0} />
            <Stat label="Wallets md5" value={latest.wallets_checksum?.slice(0, 8) ?? "—"} mono />
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Recent snapshots ({rows.length})
            </summary>
            <div className="mt-2 max-h-48 overflow-auto border border-border/50 rounded">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1">When</th>
                    <th className="text-right px-2 py-1">L</th>
                    <th className="text-right px-2 py-1">S</th>
                    <th className="text-right px-2 py-1">M</th>
                    <th className="text-right px-2 py-1">Mis</th>
                    <th className="text-right px-2 py-1">Err</th>
                    <th className="text-center px-2 py-1">Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/30">
                      <td className="px-2 py-1">{new Date(r.ran_at).toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{r.live_wallet_transactions_total}</td>
                      <td className="px-2 py-1 text-right">{r.shadow_log_total}</td>
                      <td className="px-2 py-1 text-right">{r.matched}</td>
                      <td className={`px-2 py-1 text-right ${r.mismatch_count > 0 ? "text-destructive" : ""}`}>
                        {r.mismatch_count}
                      </td>
                      <td className={`px-2 py-1 text-right ${r.error_count > 0 ? "text-destructive" : ""}`}>
                        {r.error_count}
                      </td>
                      <td className="px-2 py-1 text-center">{r.alert_fired ? "🚨" : "·"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  alert,
  mono,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="border border-border/50 rounded px-2 py-1.5 bg-background/50">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`text-sm font-semibold ${alert ? "text-destructive" : "text-foreground"} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
