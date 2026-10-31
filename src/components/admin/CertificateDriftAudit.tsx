/**
 * Phase L — Certificate Forensic Audit
 * Calls get_certificate_drift_admin RPC and surfaces issued certificates
 * with integrity drift across four dimensions:
 *   - orphan_entry      (referenced entry deleted)
 *   - wrong_recipient   (cert.user_id ≠ entry.user_id)
 *   - stale_eligibility (cert exists, entry no longer certificate_ready)
 *   - type_mismatch     (cert type doesn't match current entry standing)
 */
import { useState } from "react";
import { FileWarning, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface DriftRow {
  certificate_id: string;
  cert_title: string;
  cert_type: string;
  cert_user_id: string;
  reference_id: string | null;
  entry_id: string | null;
  entry_user_id: string | null;
  entry_status: string | null;
  entry_placement: string | null;
  entry_certificate_ready: boolean | null;
  competition_id: string | null;
  issued_at: string;
  drift_type: "orphan_entry" | "wrong_recipient" | "stale_eligibility" | "type_mismatch";
  severity: "elevated" | "high" | "critical";
  reason: string;
}

interface Props {
  competitionId?: string;
}

const sevColor: Record<DriftRow["severity"], string> = {
  elevated: "text-amber-500 border-amber-500/30 bg-amber-500/5",
  high: "text-orange-500 border-orange-500/30 bg-orange-500/5",
  critical: "text-destructive border-destructive/30 bg-destructive/5",
};

const driftLabel: Record<DriftRow["drift_type"], string> = {
  orphan_entry: "orphan",
  wrong_recipient: "wrong recipient",
  stale_eligibility: "stale",
  type_mismatch: "type mismatch",
};

const CertificateDriftAudit = ({ competitionId }: Props) => {
  const [rows, setRows] = useState<DriftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("get_certificate_drift_admin" as any, {
      p_competition_id: competitionId || null,
    });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data as DriftRow[]) || []);
    }
    setRan(true);
    setLoading(false);
  };

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FileWarning className="h-3.5 w-3.5 text-primary" />
          <span
            className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Certificate Drift {ran ? `(${rows.length})` : ""}
          </span>
          {ran && rows.length > 0 && (
            <span className="text-[9px] text-muted-foreground tracking-[0.1em] uppercase">
              {counts.critical ? `${counts.critical} critical · ` : ""}
              {counts.high ? `${counts.high} high · ` : ""}
              {counts.elevated ? `${counts.elevated} elevated` : ""}
            </span>
          )}
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 border border-primary/40 text-primary text-[9px] tracking-[0.1em] uppercase hover:bg-primary/10 transition-colors disabled:opacity-50"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Scan
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 border-b border-destructive/30 bg-destructive/5 text-[11px] text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3 w-3" /> {error}
        </div>
      )}

      {!ran && !loading && (
        <div
          className="px-4 py-6 text-center text-[11px] text-muted-foreground"
          style={{ fontFamily: "var(--font-body)" }}
        >
          Run a scan to detect issued certificates that have drifted from their underlying entry state.
        </div>
      )}

      {ran && rows.length === 0 && !loading && !error && (
        <div
          className="px-4 py-6 text-center text-[11px] text-muted-foreground"
          style={{ fontFamily: "var(--font-body)" }}
        >
          No certificate drift detected. All issued certificates align with current entry standings.
        </div>
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.certificate_id + r.drift_type} className="px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 border shrink-0 ${sevColor[r.severity]}`}
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {r.severity}
                </span>
                <span
                  className="text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 border border-border text-muted-foreground shrink-0"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {driftLabel[r.drift_type]}
                </span>
                <span
                  className="text-foreground font-medium truncate"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {r.cert_title}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                  {new Date(r.issued_at).toLocaleDateString()}
                </span>
              </div>
              <div
                className="mt-1 text-[10px] text-muted-foreground pl-1"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {r.reason}
              </div>
              <div className="mt-1 flex items-center gap-3 text-[9px] text-muted-foreground/70 font-mono pl-1">
                <span>cert {r.certificate_id.slice(0, 8)}</span>
                {r.reference_id && <span>→ entry {r.reference_id.slice(0, 8)}</span>}
                <span className="uppercase">type: {r.cert_type}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CertificateDriftAudit;
