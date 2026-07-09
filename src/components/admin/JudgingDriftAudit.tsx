/**
 * JudgingDriftAudit — Phase 2.3 admin widget.
 * Calls the security-definer RPC `get_progression_drift_admin` to surface entries
 * where stored `progression_decision` ≠ deterministic SOW recomputation.
 *
 * Two modes:
 *  - global (no competitionId): shows all drift across the platform
 *  - scoped (competitionId set):  filters to that single competition
 *
 * Re-used by AdminHealth and AdminCompetitions.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";

interface DriftRow {
  entry_id: string;
  competition_id: string;
  title: string | null;
  status: string | null;
  stored_decision: string | null;
  expected_decision: string | null;
  total_decisions: number | null;
  has_drift: boolean;
  updated_at: string | null;
}

interface Props {
  competitionId?: string;
  compact?: boolean;
}

const JudgingDriftAudit = ({ competitionId, compact = false }: Props) => {
  const [rows, setRows] = useState<DriftRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);

  const fetchDrift = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("get_progression_drift_admin" as any);
      if (rpcErr) throw rpcErr;
      let result = (data as DriftRow[]) || [];
      if (competitionId) result = result.filter((r) => r.competition_id === competitionId);
      setRows(result);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load drift report");
    } finally {
      setLoading(false);
    }
  };

  const fixRow = async (row: DriftRow) => {
    if (!row.expected_decision) {
      toast({ title: "Cannot auto-fix", description: "Expected decision is NULL.", variant: "destructive" });
      return;
    }
    setFixingId(row.entry_id);
    try {
      const { error: updErr } = await supabase
        .from("competition_entries")
        .update({ progression_decision: row.expected_decision, updated_at: new Date().toISOString() })
        .eq("id", row.entry_id);
      if (updErr) throw updErr;
      await supabase.from("db_audit_logs").insert({
        table_name: "competition_entries",
        operation: "DRIFT_FIX_ADMIN",
        row_id: row.entry_id,
        old_data: { progression_decision: row.stored_decision } as any,
        new_data: { progression_decision: row.expected_decision, source: "JudgingDriftAudit" } as any,
      });
      toast({ title: "Drift corrected", description: `${row.title ?? row.entry_id.slice(0, 8)}` });
      await fetchDrift();
    } catch (e: any) {
      toast({ title: "Fix failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setFixingId(null);
    }
  };

  const driftCount = rows?.length ?? 0;

  return (
    <div className={compact ? "border border-border/50 p-3 space-y-2" : "border-2 border-primary/40 rounded-lg p-5 bg-primary/5"}>
      <div className="flex items-center justify-between">
        <h3 className={compact ? "flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase text-muted-foreground" : "text-sm font-semibold text-foreground flex items-center gap-2"} style={{ fontFamily: "var(--font-heading)" }}>
          <ShieldCheck className={compact ? "h-3 w-3 text-primary" : "h-3.5 w-3.5"} />
          {compact ? `Progression Drift${competitionId ? "" : " (Global)"}` : "Judging Progression Drift Audit"}
        </h3>
        <button
          onClick={fetchDrift}
          disabled={loading}
          className={
            compact
              ? "inline-flex items-center gap-1 text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-primary/50 text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
              : "inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          }
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"} ${loading ? "animate-spin" : ""}`} />
          {loading ? "Scanning…" : rows === null ? "Run Scan" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2 mt-2">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      {rows !== null && !error && (
        <div className="mt-2 space-y-2">
          <div className={`flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase ${driftCount === 0 ? "text-green-500" : "text-yellow-500"}`} style={{ fontFamily: "var(--font-heading)" }}>
            {driftCount === 0 ? (
              <><ShieldCheck className="h-3 w-3" /> Clean — 0 drifted entries{competitionId ? " in this competition" : ""}</>
            ) : (
              <><AlertTriangle className="h-3 w-3" /> {driftCount} drifted {driftCount === 1 ? "entry" : "entries"}</>
            )}
          </div>

          {driftCount > 0 && (
            <div className="border border-border max-h-72 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="text-left p-2 font-medium">Entry</th>
                    <th className="text-left p-2 font-medium">Status</th>
                    <th className="text-left p-2 font-medium">Stored</th>
                    <th className="text-left p-2 font-medium">Expected</th>
                    <th className="text-right p-2 font-medium">Decisions</th>
                    <th className="text-right p-2 font-medium w-20">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.entry_id} className="hover:bg-muted/40">
                      <td className="p-2 truncate max-w-[180px]" title={r.title ?? r.entry_id}>{r.title ?? r.entry_id.slice(0, 8)}</td>
                      <td className="p-2 text-muted-foreground">{r.status ?? "—"}</td>
                      <td className="p-2"><span className="text-yellow-500">{r.stored_decision ?? "NULL"}</span></td>
                      <td className="p-2"><span className="text-primary">{r.expected_decision ?? "NULL"}</span></td>
                      <td className="p-2 text-right text-muted-foreground">{r.total_decisions ?? 0}</td>
                      <td className="p-2 text-right">
                        <button
                          onClick={() => fixRow(r)}
                          disabled={fixingId === r.entry_id || !r.expected_decision}
                          className="inline-flex items-center gap-1 text-[9px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-primary/50 text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors"
                          style={{ fontFamily: "var(--font-heading)" }}
                          title={r.expected_decision ? `Set to ${r.expected_decision}` : "No expected value"}
                        >
                          <Wrench className="h-2.5 w-2.5" />
                          {fixingId === r.entry_id ? "…" : "Fix"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {rows === null && !loading && !error && (
        <p className={`${compact ? "text-[8px]" : "text-xs"} text-muted-foreground italic mt-2`} style={{ fontFamily: "var(--font-body)" }}>
          Click {rows === null ? "\"Run Scan\"" : "\"Refresh\""} to compare stored vs deterministic recomputation.
        </p>
      )}
    </div>
  );
};

export default JudgingDriftAudit;
