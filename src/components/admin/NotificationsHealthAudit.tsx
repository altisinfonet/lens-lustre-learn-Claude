/**
 * NotificationsHealthAudit — Phase 4 admin widget.
 *
 * Surfaces drift between entry status changes and the notification_emit_log
 * audit trail. Provides idempotent "dry-run" and "execute" backfill via:
 *   - get_notification_drift_admin(_window_days)
 *   - get_notification_health_stats_admin()
 *   - backfill_judging_notifications(_window_days, _dry_run)
 *
 * (Spec v3: the verification workflow has been deleted; the former
 * "stuck verifications" panel has been removed accordingly.)
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, Bell, Mail, PlayCircle } from "lucide-react";

interface DriftRow { expected_template: string; total_entries: number; missing_emit: number; }
interface StatsRow {
  emits_today: number; emits_total: number; distinct_templates: number;
  failures_today: number; dlq_count: number;
}
interface BackfillResult { scanned: number; would_emit: number; emitted: number; }

const labelCls = "text-[8px] tracking-[0.15em] uppercase text-muted-foreground/70";

const NotificationsHealthAudit = ({ compact = false }: { compact?: boolean }) => {
  const [windowDays, setWindowDays] = useState(90);
  const [drift, setDrift] = useState<DriftRow[]>([]);
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ label: string; result: BackfillResult } | null>(null);

  const loadAll = async () => {
    setLoading(true); setError(null);
    try {
      const [d, h] = await Promise.all([
        supabase.rpc("get_notification_drift_admin" as any, { _window_days: windowDays }),
        supabase.rpc("get_notification_health_stats_admin" as any),
      ]);
      if (d.error) throw d.error;
      if (h.error) throw h.error;
      setDrift((d.data as DriftRow[]) ?? []);
      setStats(((h.data as StatsRow[])?.[0]) ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load notification health");
    } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const runBackfill = async (dryRun: boolean) => {
    const label = `entries-${dryRun ? "dryrun" : "execute"}`;
    setRunning(label); setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("backfill_judging_notifications" as any, {
        _window_days: windowDays, _dry_run: dryRun,
      });
      if (rpcErr) throw rpcErr;
      const row = ((data as BackfillResult[])?.[0]) ?? { scanned: 0, would_emit: 0, emitted: 0 };
      setLastRun({ label, result: row });
      if (!dryRun) await loadAll();
    } catch (e: any) {
      setError(e?.message ?? "Backfill failed");
    } finally { setRunning(null); }
  };

  const totalMissing = drift.reduce((acc, r) => acc + Number(r.missing_emit ?? 0), 0);
  const allClean = totalMissing === 0;

  if (compact) {
    return (
      <div className="border border-border/40 bg-card/40 p-4 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
            <Bell className="h-3.5 w-3.5 text-primary" /> Notification Health
          </h3>
          <a href="/admin/notifications_health" className="text-[10px] tracking-[0.1em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
            Open full audit →
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <Stat label="Emits today" value={stats?.emits_today ?? 0} />
          <Stat label="Failures today" value={stats?.failures_today ?? 0} tone={Number(stats?.failures_today ?? 0) > 0 ? "bad" : "default"} />
          <Stat label="DLQ" value={stats?.dlq_count ?? 0} tone={Number(stats?.dlq_count ?? 0) > 0 ? "bad" : "default"} />
          <Stat label="Missing emits" value={totalMissing} tone={allClean ? "ok" : "bad"} />
        </div>
        {allClean && !loading && (
          <p className="text-[10px] text-green-500 flex items-center gap-1.5 mt-3" style={{ fontFamily: "var(--font-heading)" }}>
            <ShieldCheck className="h-3 w-3" /> 0 missed notifications
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-heading)" }}>
          <Bell className="h-3.5 w-3.5 text-primary" />
          Notification Backfill & Drift Audit (Phase 4)
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="number" min={1} max={365}
            value={windowDays}
            onChange={(e) => setWindowDays(Math.max(1, Math.min(365, parseInt(e.target.value || "90", 10))))}
            className="w-20 bg-secondary-foreground border border-border/50 px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary/60"
          />
          <span className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>days</span>
          <button
            onClick={loadAll} disabled={loading}
            className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
        <Stat label="Emits today" value={stats?.emits_today ?? 0} />
        <Stat label="Total emits" value={stats?.emits_total ?? 0} />
        <Stat label="Templates used" value={stats?.distinct_templates ?? 0} />
        <Stat label="Failures today" value={stats?.failures_today ?? 0} tone={Number(stats?.failures_today ?? 0) > 0 ? "bad" : "default"} />
        <Stat label="DLQ" value={stats?.dlq_count ?? 0} tone={Number(stats?.dlq_count ?? 0) > 0 ? "bad" : "default"} />
      </div>

      {allClean && !loading && (
        <div className="border border-green-500/30 bg-green-500/5 p-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-green-500" />
          <p className="text-[11px] text-green-500" style={{ fontFamily: "var(--font-heading)" }}>
            PROOF: 0 missed notifications.
          </p>
        </div>
      )}

      <div>
        <h4 className="text-[11px] font-semibold mb-2 flex items-center gap-1.5" style={{ fontFamily: "var(--font-heading)" }}>
          <Mail className="h-3 w-3 text-primary" /> Entry status → email drift (last {windowDays} days)
        </h4>
        {drift.length === 0 ? (
          <p className="text-[10px] text-muted-foreground italic">No status changes in window.</p>
        ) : (
          <div className="border border-border/40 overflow-hidden">
            <table className="w-full text-[10px]">
              <thead className="bg-secondary-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5">Template</th>
                  <th className="text-right px-2 py-1.5">Total entries</th>
                  <th className="text-right px-2 py-1.5">Missing emit</th>
                </tr>
              </thead>
              <tbody>
                {drift.map((r) => (
                  <tr key={r.expected_template} className="border-t border-border/20">
                    <td className="px-2 py-1.5 font-mono">{r.expected_template}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.total_entries}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${Number(r.missing_emit) > 0 ? "text-destructive font-semibold" : "text-green-500"}`}>
                      {r.missing_emit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => runBackfill(true)} disabled={running !== null}
            className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border border-primary/40 hover:bg-primary/10 disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <PlayCircle className="h-3 w-3" /> {running === "entries-dryrun" ? "Scanning…" : "Dry-run"}
          </button>
          <button
            onClick={() => runBackfill(false)} disabled={running !== null || totalMissing === 0}
            className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {running === "entries-execute" ? "Emitting…" : `Execute (${totalMissing})`}
          </button>
        </div>
      </div>

      {lastRun && (
        <div className="border border-border/40 bg-card/40 p-2">
          <p className="text-[10px]" style={{ fontFamily: "var(--font-heading)" }}>
            Last run · <span className="font-mono">{lastRun.label}</span> · scanned {lastRun.result.scanned}
            {" · "}would_emit {lastRun.result.would_emit}{" · "}emitted {lastRun.result.emitted}
          </p>
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "ok" | "bad"; }) => (
  <div className={`border px-2 py-1.5 ${
    tone === "ok" ? "border-green-500/30 bg-green-500/5"
      : tone === "bad" ? "border-destructive/30 bg-destructive/5"
      : "border-border/40 bg-card/40"
  }`}>
    <div className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>{label}</div>
    <div className="text-foreground tabular-nums font-semibold">{value}</div>
  </div>
);

export default NotificationsHealthAudit;
