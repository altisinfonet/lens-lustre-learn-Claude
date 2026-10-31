/**
 * EntryStatusDriftAudit — Phase B1.7 admin widget.
 *
 * Read-only surface comparing competition_entries.status (stored) against
 * the SOW-canonical derivation in entry_public_status.public_status.
 *
 * Three buckets:
 *  - match: stored == derived (and placement matches)
 *  - expected_pre_publish: stored ∈ {submitted,rejected,needs_review}
 *      while derived = 'judging_in_progress' — legitimate privacy gate
 *      before R1 publish, NOT drift.
 *  - DRIFT: anything else — the only actionable bucket.
 *
 * Zero writes. Diagnostic only.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, GitCompareArrows } from "lucide-react";

interface DriftRow {
  entry_id: string;
  competition_id: string;
  stored_status: string;
  derived_status: string | null;
  stored_placement: string | null;
  derived_placement: string | null;
  progression_decision: string | null;
  current_round: string | null;
  drift_kind: string;
}

interface SummaryRow {
  bucket: string;
  count: number;
}

const EntryStatusDriftAudit = () => {
  const [rows, setRows] = useState<DriftRow[] | null>(null);
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDrift = async () => {
    setLoading(true);
    setError(null);
    try {
      const [driftRes, sumRes] = await Promise.all([
        supabase.rpc("get_entry_status_drift_admin" as any),
        supabase.rpc("get_entry_status_drift_summary_admin" as any),
      ]);
      if (driftRes.error) throw driftRes.error;
      if (sumRes.error) throw sumRes.error;
      setRows((driftRes.data as DriftRow[]) || []);
      setSummary((sumRes.data as SummaryRow[]) || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load entry status drift");
    } finally {
      setLoading(false);
    }
  };

  const total = rows?.length ?? 0;
  const bucketCount = (b: string) =>
    summary?.find((s) => s.bucket === b)?.count ?? 0;

  return (
    <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5 space-y-3">
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold text-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          Entry Status Drift (Phase B1.7 — stored vs derived)
        </h3>
        <button
          onClick={fetchDrift}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Scanning…" : rows === null ? "Run Scan" : "Refresh"}
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
        Compares <code className="text-[9px]">competition_entries.status</code> vs{" "}
        <code className="text-[9px]">entry_public_status.public_status</code> (SOW canonical).
        The pre-publish privacy gate is excluded from DRIFT.
      </p>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      {summary !== null && !error && (
        <>
          <div
            className={`flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase ${
              total === 0 ? "text-green-500" : "text-yellow-500"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {total === 0 ? (
              <>
                <ShieldCheck className="h-3 w-3" /> Clean — 0 actionable drift rows
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" /> {total} actionable drift{" "}
                {total === 1 ? "row" : "rows"}
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { key: "match", label: "Match", tone: "green" },
              { key: "expected_pre_publish", label: "Pre-publish gate", tone: "muted" },
              { key: "DRIFT", label: "Drift", tone: "yellow" },
            ].map((b) => {
              const c = bucketCount(b.key);
              const isDrift = b.key === "DRIFT" && c > 0;
              return (
                <div
                  key={b.key}
                  className={`border p-2 ${
                    isDrift
                      ? "border-yellow-500/40 bg-yellow-500/5"
                      : "border-border/50 bg-muted/20"
                  }`}
                >
                  <div
                    className="text-[9px] tracking-[0.1em] uppercase text-muted-foreground"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {b.label}
                  </div>
                  <div
                    className={`text-lg font-semibold ${
                      isDrift
                        ? "text-yellow-500"
                        : b.tone === "green"
                        ? "text-green-500"
                        : "text-foreground"
                    }`}
                  >
                    {c}
                  </div>
                </div>
              );
            })}
          </div>

          {rows && rows.length > 0 && (
            <div className="border border-border max-h-72 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="text-left p-2 font-medium">Entry</th>
                    <th className="text-left p-2 font-medium">Competition</th>
                    <th className="text-left p-2 font-medium">Stored</th>
                    <th className="text-left p-2 font-medium">Derived</th>
                    <th className="text-left p-2 font-medium">Stored Placement</th>
                    <th className="text-left p-2 font-medium">Derived Placement</th>
                    <th className="text-left p-2 font-medium">Progression</th>
                    <th className="text-center p-2 font-medium">Round</th>
                    <th className="text-left p-2 font-medium">Kind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.entry_id} className="hover:bg-muted/40">
                      <td className="p-2 font-mono text-[9px]" title={r.entry_id}>
                        {r.entry_id.slice(0, 8)}
                      </td>
                      <td className="p-2 font-mono text-[9px]" title={r.competition_id}>
                        {r.competition_id.slice(0, 8)}
                      </td>
                      <td className="p-2 text-yellow-500">{r.stored_status}</td>
                      <td className="p-2 text-primary">{r.derived_status ?? "—"}</td>
                      <td className="p-2">{r.stored_placement ?? "—"}</td>
                      <td className="p-2">{r.derived_placement ?? "—"}</td>
                      <td className="p-2">{r.progression_decision ?? "—"}</td>
                      <td className="p-2 text-center">{r.current_round ?? "—"}</td>
                      <td className="p-2 text-[9px] tracking-[0.1em] uppercase text-muted-foreground">
                        {r.drift_kind}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {summary === null && !loading && !error && (
        <p className="text-xs text-muted-foreground italic" style={{ fontFamily: "var(--font-body)" }}>
          Click "Run Scan" to compare stored vs derived entry status across all competitions.
        </p>
      )}
    </div>
  );
};

export default EntryStatusDriftAudit;
