/**
 * Phase K — Cross-Judge Collusion Detector
 * Calls get_judge_collusion_admin RPC and surfaces flagged judge pairs.
 * Respects judge anonymization (Phase H) — shows handles by default.
 */
import { useState } from "react";
import { ShieldAlert, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveJudgeDisplay, useJudgeReveal } from "@/lib/judgeAnonymizer";
import JudgeRevealToggle from "@/components/admin/JudgeRevealToggle";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";

interface Pair {
  competition_id: string;
  judge_a: string;
  judge_b: string;
  shared_entries: number;
  pearson_r: number;
  mean_diff: number;
  severity: "elevated" | "high" | "critical";
}

interface Props {
  competitionId?: string;
}

const sevColor: Record<Pair["severity"], string> = {
  elevated: "text-amber-500 border-amber-500/30 bg-amber-500/5",
  high: "text-orange-500 border-orange-500/30 bg-orange-500/5",
  critical: "text-destructive border-destructive/30 bg-destructive/5",
};

const CollusionAudit = ({ competitionId }: Props) => {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [nameMap, setNameMap] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minOverlap, setMinOverlap] = useState(10);
  const [minR, setMinR] = useState(0.9);
  const reveal = useJudgeReveal();

  const run = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("get_judge_collusion_admin" as any, {
      p_competition_id: competitionId || null,
      p_min_overlap: minOverlap,
      p_min_correlation: minR,
    });
    if (error) {
      setError(error.message);
      setPairs([]);
    } else {
      const rows = (data as Pair[]) || [];
      setPairs(rows);
      const ids = [...new Set(rows.flatMap((p) => [p.judge_a, p.judge_b]))];
      if (ids.length > 0) {
        const map = await cachedFetchProfilesByIds(ids);
        const m = new Map<string, string | null>();
        ids.forEach((id) => m.set(id, map.get(id) || null));
        setNameMap(m);
      }
    }
    setRan(true);
    setLoading(false);
  };

  return (
    <div className="border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5 text-primary" />
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
            Collusion Detector {ran && !error ? `(${pairs.length})` : ""}
          </span>
          <JudgeRevealToggle />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <label className="flex items-center gap-1">
            <span>min overlap</span>
            <input
              type="number"
              min={2}
              max={500}
              value={minOverlap}
              onChange={(e) => setMinOverlap(Math.max(2, Number(e.target.value) || 10))}
              className="w-12 bg-transparent border border-border px-1 py-0.5 text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1">
            <span>min |r|</span>
            <input
              type="number"
              min={0.5}
              max={1}
              step={0.01}
              value={minR}
              onChange={(e) => setMinR(Math.min(1, Math.max(0.5, Number(e.target.value) || 0.9)))}
              className="w-14 bg-transparent border border-border px-1 py-0.5 text-[10px]"
            />
          </label>
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
      </div>

      {error && (
        <div className="px-4 py-3 border-b border-destructive/30 bg-destructive/5 text-[11px] text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3 w-3" /> {error}
        </div>
      )}

      {!ran && !loading && (
        <div className="px-4 py-6 text-center text-[11px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          Run a scan to detect judge pairs with abnormally correlated scores.
        </div>
      )}

      {ran && pairs.length === 0 && !loading && !error && (
        <div className="px-4 py-6 text-center text-[11px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
          No collusion patterns detected at current thresholds.
        </div>
      )}

      {pairs.length > 0 && (
        <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
          {pairs.map((p, i) => (
            <div key={`${p.judge_a}-${p.judge_b}-${i}`} className="px-4 py-2.5 flex items-center gap-3 text-xs">
              <span className={`text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 border shrink-0 ${sevColor[p.severity]}`} style={{ fontFamily: "var(--font-heading)" }}>
                {p.severity}
              </span>
              <span className="text-foreground font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>
                {resolveJudgeDisplay(p.competition_id, p.judge_a, nameMap.get(p.judge_a) || null, reveal)}
              </span>
              <span className="text-muted-foreground/50 shrink-0">×</span>
              <span className="text-foreground font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>
                {resolveJudgeDisplay(p.competition_id, p.judge_b, nameMap.get(p.judge_b) || null, reveal)}
              </span>
              <span className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
                <span>n={p.shared_entries}</span>
                <span className="font-bold text-foreground">r={Number(p.pearson_r).toFixed(3)}</span>
                <span>Δμ={Number(p.mean_diff).toFixed(2)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CollusionAudit;
