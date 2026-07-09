/**
 * AwardsIntegrityAudit — Phase 2.4 admin widget.
 * Surfaces two forensic checks for Round 4 awards:
 *   F2 — placement drift (winner not top-ranked, status≠placement, etc.)
 *   F3 — certificate readiness drift (awarded/finalist entries missing certificate_ready)
 *
 * Both call security-definer RPCs (admin-only). Re-used by AdminHealth (global)
 * and CompetitionsModule (scoped via competitionId prop).
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, Wrench, Trophy, Award } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";

interface PlacementRow {
  entry_id: string;
  competition_id: string;
  competition_title: string | null;
  status: string | null;
  placement: string | null;
  rank_score: number | null;
  expected_rank: number | null;
  actual_award_rank: number | null;
  drift_reason: string | null;
}

interface CertRow {
  entry_id: string;
  competition_id: string;
  competition_title: string | null;
  competition_phase: string | null;
  status: string | null;
  certificate_ready: boolean;
  reason: string | null;
}

interface Props {
  competitionId?: string;
  compact?: boolean;
}

const AwardsIntegrityAudit = ({ competitionId, compact = false }: Props) => {
  const [placementRows, setPlacementRows] = useState<PlacementRow[] | null>(null);
  const [certRows, setCertRows] = useState<CertRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);

  const fetchAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const arg = competitionId ? { _competition_id: competitionId } : {};
      const [pl, cr] = await Promise.all([
        supabase.rpc("get_placement_drift_admin" as any, arg),
        supabase.rpc("get_certificate_readiness_drift_admin" as any, arg),
      ]);
      if (pl.error) throw pl.error;
      if (cr.error) throw cr.error;
      setPlacementRows((pl.data as PlacementRow[]) || []);
      setCertRows((cr.data as CertRow[]) || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load awards integrity report");
    } finally {
      setLoading(false);
    }
  };

  const fixCert = async (row: CertRow) => {
    setFixingId(row.entry_id);
    try {
      const { error: rpcErr } = await supabase.rpc("fix_certificate_readiness_admin" as any, { _entry_id: row.entry_id });
      if (rpcErr) throw rpcErr;
      toast({ title: "Certificate flag set", description: row.competition_title ?? row.entry_id.slice(0, 8) });
      await fetchAudit();
    } catch (e: any) {
      toast({ title: "Fix failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setFixingId(null);
    }
  };

  const placementCount = placementRows?.length ?? 0;
  const certCount = certRows?.length ?? 0;
  const totalCount = placementCount + certCount;
  const hasRun = placementRows !== null || certRows !== null;

  return (
    <div className={compact ? "border border-border/50 p-3 space-y-2" : "border-2 border-amber-500/40 rounded-lg p-5 bg-amber-500/5"}>
      <div className="flex items-center justify-between">
        <h3 className={compact ? "flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase text-muted-foreground" : "text-sm font-semibold text-foreground flex items-center gap-2"} style={{ fontFamily: "var(--font-heading)" }}>
          <Trophy className={compact ? "h-3 w-3 text-amber-500" : "h-3.5 w-3.5 text-amber-500"} />
          {compact ? `R4 Awards Integrity${competitionId ? "" : " (Global)"}` : "Round 4 Awards Integrity Audit"}
        </h3>
        <button
          onClick={fetchAudit}
          disabled={loading}
          className={
            compact
              ? "inline-flex items-center gap-1 text-[8px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-amber-500/50 text-amber-500 hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
              : "inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-amber-500 text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
          }
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"} ${loading ? "animate-spin" : ""}`} />
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

      {hasRun && !error && (
        <div className="mt-2 space-y-3">
          <div className={`flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase ${totalCount === 0 ? "text-green-500" : "text-yellow-500"}`} style={{ fontFamily: "var(--font-heading)" }}>
            {totalCount === 0 ? (
              <><ShieldCheck className="h-3 w-3" /> Clean — 0 awards/certificate issues{competitionId ? " in this competition" : ""}</>
            ) : (
              <><AlertTriangle className="h-3 w-3" /> {placementCount} placement drift · {certCount} certificate issue{certCount === 1 ? "" : "s"}</>
            )}
          </div>

          {placementCount > 0 && (
            <div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1" style={{ fontFamily: "var(--font-heading)" }}>F2 — Placement Drift</p>
              <div className="border border-border max-h-60 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="text-left p-2 font-medium">Competition</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Placement</th>
                      <th className="text-right p-2 font-medium">Expected Rank</th>
                      <th className="text-left p-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {placementRows!.map((r) => (
                      <tr key={r.entry_id} className="hover:bg-muted/40">
                        <td className="p-2 truncate max-w-[160px]" title={r.competition_title ?? ""}>{r.competition_title ?? r.competition_id.slice(0, 8)}</td>
                        <td className="p-2"><span className="text-yellow-500">{r.status ?? "—"}</span></td>
                        <td className="p-2"><span className="text-muted-foreground">{r.placement ?? "NULL"}</span></td>
                        <td className="p-2 text-right text-primary">#{r.expected_rank ?? "—"}</td>
                        <td className="p-2 text-destructive text-[9px]">{r.drift_reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {certCount > 0 && (
            <div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-1 flex items-center gap-1" style={{ fontFamily: "var(--font-heading)" }}>
                <Award className="h-2.5 w-2.5" /> F3 — Certificate Readiness
              </p>
              <div className="border border-border max-h-60 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="text-left p-2 font-medium">Competition</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Reason</th>
                      <th className="text-right p-2 font-medium w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {certRows!.map((r) => (
                      <tr key={r.entry_id} className="hover:bg-muted/40">
                        <td className="p-2 truncate max-w-[160px]" title={r.competition_title ?? ""}>{r.competition_title ?? r.competition_id.slice(0, 8)}</td>
                        <td className="p-2"><span className="text-yellow-500">{r.status ?? "—"}</span></td>
                        <td className="p-2 text-destructive text-[9px]">{r.reason ?? "—"}</td>
                        <td className="p-2 text-right">
                          <button
                            onClick={() => fixCert(r)}
                            disabled={fixingId === r.entry_id}
                            className="inline-flex items-center gap-1 text-[9px] tracking-[0.1em] uppercase px-1.5 py-0.5 border border-amber-500/50 text-amber-500 hover:bg-amber-500/10 disabled:opacity-40 transition-colors"
                            style={{ fontFamily: "var(--font-heading)" }}
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
            </div>
          )}
        </div>
      )}

      {!hasRun && !loading && !error && (
        <p className={`${compact ? "text-[8px]" : "text-xs"} text-muted-foreground italic mt-2`} style={{ fontFamily: "var(--font-body)" }}>
          Scans Round 4 placements vs deterministic SOW ranking and verifies certificate flags.
        </p>
      )}
    </div>
  );
};

export default AwardsIntegrityAudit;
