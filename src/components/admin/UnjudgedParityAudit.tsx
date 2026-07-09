/**
 * UnjudgedParityAudit — J-03 admin forensic widget.
 *
 * Calls get_unjudged_parity_admin(judge, competition, round) and visually
 * compares the two unjudged counters that drive the Judge Panel UI:
 *   - sidebar_unjudged = eligible − tagged
 *   - grid_unjudged    = eligible NOT IN tagged
 * They MUST be equal under the v5 tag-only rule. Any drift = bug.
 *
 * Read-only, admin-only (gated server-side). Single-judge scope by design.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, Tag } from "lucide-react";

interface ParityRow {
  judge_id: string;
  competition_id: string;
  round_number: number;
  eligible_count: number;
  tagged_count: number;
  sidebar_unjudged: number;
  grid_unjudged: number;
  drift: number;
  drift_photos: Array<{ entry_id: string; photo_index: number }>;
}

const inputCls =
  "w-full bg-secondary-foreground border border-border/50 px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60";
const labelCls =
  "block text-[9px] tracking-[0.15em] uppercase text-muted-foreground/70 mb-1";

const UnjudgedParityAudit = () => {
  const [judgeId, setJudgeId] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [round, setRound] = useState("1");
  const [row, setRow] = useState<ParityRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setRow(null);
    try {
      const r = parseInt(round, 10);
      if (!judgeId || !competitionId || Number.isNaN(r)) {
        throw new Error("Provide judge ID, competition ID, and a numeric round.");
      }
      const { data, error: rpcErr } = await supabase.rpc(
        "get_unjudged_parity_admin" as any,
        {
          p_judge_id: judgeId,
          p_competition_id: competitionId,
          p_round_number: r,
        },
      );
      if (rpcErr) throw rpcErr;
      const first = Array.isArray(data) ? (data[0] as ParityRow | undefined) : null;
      setRow(first ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to run parity check");
    } finally {
      setLoading(false);
    }
  };

  const ok = row && row.drift === 0;

  return (
    <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3
          className="text-sm font-semibold text-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <Tag className="h-3.5 w-3.5 text-primary" />
          J-03 Unjudged Parity Check (single judge · tag-only)
        </h3>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Checking…" : "Run Check"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
            Judge ID (uuid)
          </label>
          <input
            value={judgeId}
            onChange={(e) => setJudgeId(e.target.value.trim())}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
            Competition ID (uuid)
          </label>
          <input
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value.trim())}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
            Round (1–4)
          </label>
          <input
            value={round}
            onChange={(e) => setRound(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={inputCls}
          />
        </div>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2 mb-3">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      {row && (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase ${
              ok ? "text-green-500" : "text-destructive"
            }`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {ok ? (
              <>
                <ShieldCheck className="h-3 w-3" />
                Parity OK · sidebar={row.sidebar_unjudged} · grid={row.grid_unjudged}
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" />
                Drift detected · Δ {row.drift > 0 ? "+" : ""}
                {row.drift}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Eligible" value={row.eligible_count} />
            <Stat label="Tagged" value={row.tagged_count} />
            <Stat label="Sidebar Unjudged" value={row.sidebar_unjudged} />
            <Stat
              label="Grid Unjudged"
              value={row.grid_unjudged}
              tone={ok ? "ok" : "bad"}
            />
          </div>

          {!ok && row.drift_photos?.length > 0 && (
            <div className="border border-destructive/30 bg-destructive/5 p-3">
              <p
                className="text-[9px] tracking-[0.15em] uppercase text-destructive mb-2"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Untagged photos ({row.drift_photos.length})
              </p>
              <div className="max-h-40 overflow-auto space-y-0.5 font-mono text-[10px] text-muted-foreground">
                {row.drift_photos.slice(0, 200).map((p) => (
                  <div key={`${p.entry_id}-${p.photo_index}`}>
                    {p.entry_id} · #{p.photo_index}
                  </div>
                ))}
                {row.drift_photos.length > 200 && (
                  <div className="text-muted-foreground/50 italic">
                    …{row.drift_photos.length - 200} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Stat = ({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "ok" | "bad";
}) => (
  <div
    className={`border px-2 py-1.5 ${
      tone === "ok"
        ? "border-green-500/30 bg-green-500/5"
        : tone === "bad"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border/40 bg-card/40"
    }`}
  >
    <div
      className="text-[8px] tracking-[0.15em] uppercase text-muted-foreground/70"
      style={{ fontFamily: "var(--font-heading)" }}
    >
      {label}
    </div>
    <div className="text-foreground tabular-nums font-semibold">{value}</div>
  </div>
);

export default UnjudgedParityAudit;
