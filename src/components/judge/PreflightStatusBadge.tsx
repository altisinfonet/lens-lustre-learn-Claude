import { useEffect, useState } from "react";
import { ScanSearch, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PreflightRow {
  drift_detected: boolean;
  ui_count: number;
  db_count: number;
  diff_count: number;
  created_at: string;
}

interface Props {
  competitionId: string;
  roundNumber: number;
}

/**
 * Compact pill that surfaces the latest preflight (UI ↔ DB parity) result for
 * the current judge / competition / round, BEFORE they open Complete Round.
 *
 * Reads from `judging_preflight_log` (RLS already scopes rows to caller_id).
 * Subscribes to realtime INSERTs so a fresh dialog preflight updates the pill
 * without a full reload.
 */
const PreflightStatusBadge = ({ competitionId, roundNumber }: Props) => {
  const [row, setRow] = useState<PreflightRow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLatest = async () => {
    const { data } = await supabase
      .from("judging_preflight_log")
      .select("drift_detected, ui_count, db_count, diff_count, created_at")
      .eq("competition_id", competitionId)
      .eq("round_number", roundNumber)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRow((data as PreflightRow | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void fetchLatest();
    const ch = supabase
      .channel(`preflight-${competitionId}-${roundNumber}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "judging_preflight_log",
          filter: `competition_id=eq.${competitionId}`,
        },
        (payload: any) => {
          if (payload?.new?.round_number === roundNumber) {
            void fetchLatest();
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, roundNumber]);

  const f = { fontFamily: "var(--font-heading)" };

  if (loading) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground bg-muted/20 shrink-0"
        style={f}
        title="Checking preflight history…"
      >
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Preflight
      </span>
    );
  }

  if (!row) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground bg-muted/20 shrink-0"
        style={f}
        title="No preflight has been run yet for this round. Open Complete Round to run one."
      >
        <ScanSearch className="h-2.5 w-2.5" />
        Preflight: Never
      </span>
    );
  }

  const drift = row.drift_detected;
  const when = new Date(row.created_at);
  const ago = relativeTime(when);
  const tip = `Last preflight ${when.toLocaleString()} — UI ${row.ui_count} / DB ${row.db_count} / Diff ${row.diff_count}`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded border shrink-0 ${
        drift
          ? "text-destructive border-destructive/40 bg-destructive/10"
          : "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
      }`}
      style={f}
      title={tip}
    >
      {drift ? <AlertTriangle className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
      {drift ? `Drift ${row.diff_count}` : "Preflight OK"}
      <span className="opacity-60 normal-case tracking-normal ml-0.5">· {ago}</span>
    </span>
  );
};

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default PreflightStatusBadge;
