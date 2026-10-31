/**
 * JudgingForensicDriftAudit — Phase B0 admin widget.
 *
 * Read-only surface for the five forensic findings (F1..F5) exposed by the
 * `v_judging_drift` view. Calls the security-definer RPC
 * `get_judging_drift_admin` and groups results by finding_code.
 *
 * Zero writes, zero mutations — purely diagnostic. No "Fix" buttons.
 *
 * Mirrors the visual pattern of UnjudgedParityAudit / JudgingDriftAudit
 * already present on /admin/health.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, Search } from "lucide-react";

interface DriftRow {
  finding_code: string;
  source_table: string;
  source_row_id: string;
  entry_id: string | null;
  judge_id: string | null;
  round_number: number | null;
  photo_index: number | null;
  detail_label: string | null;
  expected_value: string | null;
  actual_value: string | null;
  occurred_at: string | null;
}

const FINDING_DESCRIPTIONS: Record<string, string> = {
  F1_TAG_WITHOUT_DECISION: "Judge tag assignments with no matching judge_decisions row",
  F2_DECISION_WITHOUT_ALIAS: "judge_decisions rows whose label is missing from v3_tag_label_alias",
  F3_TAG_LABEL_NO_ALIAS: "Tag labels used in assignments with no canonical alias entry for that round",
  F4_MIRROR_LOG_ERROR: "v3_mirror_log error rows in the last 30 days",
  F5_CURRENT_ROUND_INVALID: "competition_entries.current_round text not normalizing to 1..4",
};

const ALL_FINDINGS = [
  "F1_TAG_WITHOUT_DECISION",
  "F2_DECISION_WITHOUT_ALIAS",
  "F3_TAG_LABEL_NO_ALIAS",
  "F4_MIRROR_LOG_ERROR",
  "F5_CURRENT_ROUND_INVALID",
];

const JudgingForensicDriftAudit = () => {
  const [rows, setRows] = useState<DriftRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchDrift = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("get_judging_drift_admin" as any);
      if (rpcErr) throw rpcErr;
      setRows((data as DriftRow[]) || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load forensic drift");
    } finally {
      setLoading(false);
    }
  };

  const counts: Record<string, number> = {};
  ALL_FINDINGS.forEach((f) => (counts[f] = 0));
  rows?.forEach((r) => {
    counts[r.finding_code] = (counts[r.finding_code] ?? 0) + 1;
  });
  const total = rows?.length ?? 0;

  return (
    <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5 space-y-3">
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold text-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Search className="h-3.5 w-3.5" />
          Judging Forensic Drift (Phase B0 — F1..F5)
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
        Read-only surface from <code className="text-[9px]">v_judging_drift</code>. No writes,
        no fixes — diagnostic only.
      </p>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      {rows !== null && !error && (
        <>
          <div
            className={`flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase ${
              total === 0 ? "text-green-500" : "text-yellow-500"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {total === 0 ? (
              <>
                <ShieldCheck className="h-3 w-3" /> Clean — 0 drift rows across F1..F5
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" /> {total} total drift{" "}
                {total === 1 ? "row" : "rows"}
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {ALL_FINDINGS.map((code) => {
              const c = counts[code];
              const active = expanded === code;
              return (
                <button
                  key={code}
                  onClick={() => setExpanded(active ? null : code)}
                  className={`text-left border p-2 transition-colors ${
                    c === 0
                      ? "border-border/50 bg-muted/20"
                      : active
                      ? "border-primary bg-primary/10"
                      : "border-yellow-500/40 bg-yellow-500/5 hover:bg-yellow-500/10"
                  }`}
                >
                  <div
                    className="text-[9px] tracking-[0.1em] uppercase text-muted-foreground"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {code.split("_")[0]}
                  </div>
                  <div className={`text-lg font-semibold ${c === 0 ? "text-green-500" : "text-yellow-500"}`}>
                    {c}
                  </div>
                  <div className="text-[9px] text-muted-foreground line-clamp-2">
                    {FINDING_DESCRIPTIONS[code]}
                  </div>
                </button>
              );
            })}
          </div>

          {expanded && counts[expanded] > 0 && (
            <div className="border border-border max-h-72 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="text-left p-2 font-medium">Source Row</th>
                    <th className="text-left p-2 font-medium">Entry</th>
                    <th className="text-left p-2 font-medium">Judge</th>
                    <th className="text-center p-2 font-medium">Round</th>
                    <th className="text-center p-2 font-medium">Photo</th>
                    <th className="text-left p-2 font-medium">Label / Detail</th>
                    <th className="text-left p-2 font-medium">Expected</th>
                    <th className="text-left p-2 font-medium">Actual</th>
                    <th className="text-left p-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows
                    .filter((r) => r.finding_code === expanded)
                    .map((r) => (
                      <tr key={`${r.finding_code}-${r.source_row_id}`} className="hover:bg-muted/40">
                        <td className="p-2 font-mono text-[9px]" title={r.source_row_id}>
                          {r.source_row_id?.slice(0, 8) ?? "—"}
                        </td>
                        <td className="p-2 font-mono text-[9px]" title={r.entry_id ?? ""}>
                          {r.entry_id ? r.entry_id.slice(0, 8) : "—"}
                        </td>
                        <td className="p-2 font-mono text-[9px]" title={r.judge_id ?? ""}>
                          {r.judge_id ? r.judge_id.slice(0, 8) : "—"}
                        </td>
                        <td className="p-2 text-center">{r.round_number ?? "—"}</td>
                        <td className="p-2 text-center">{r.photo_index ?? "—"}</td>
                        <td className="p-2 truncate max-w-[180px]" title={r.detail_label ?? ""}>
                          {r.detail_label ?? "—"}
                        </td>
                        <td className="p-2 text-primary truncate max-w-[120px]" title={r.expected_value ?? ""}>
                          {r.expected_value ?? "—"}
                        </td>
                        <td className="p-2 text-yellow-500 truncate max-w-[160px]" title={r.actual_value ?? ""}>
                          {r.actual_value ?? "—"}
                        </td>
                        <td className="p-2 text-muted-foreground whitespace-nowrap">
                          {r.occurred_at ? new Date(r.occurred_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {rows === null && !loading && !error && (
        <p className="text-xs text-muted-foreground italic" style={{ fontFamily: "var(--font-body)" }}>
          Click "Run Scan" to query the live forensic drift view.
        </p>
      )}
    </div>
  );
};

export default JudgingForensicDriftAudit;
