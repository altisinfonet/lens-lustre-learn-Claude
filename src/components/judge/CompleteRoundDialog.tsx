import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, Loader2, Trophy, ShieldAlert, RefreshCw, ScanSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CompleteRoundDialogProps {
  roundId: string;
  roundName: string;
  competitionId: string;
  roundNumber: number;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Optional UI-side eligible-photo map: { entryId → photoIndex[] }.
   *
   * When provided, the dialog runs a preflight check that compares this
   * UI-derived set against the canonical DB-side eligibility computed by
   * `complete-round` (preflight mode). On any drift, the declare button is
   * blocked until the judge contacts an admin and the issue is resolved.
   *
   * Pass `null` / omit for admin-side dialogs that don't have a judge-scoped
   * eligibility view — the preflight panel is hidden in that case.
   */
  uiEligiblePhotos?: Record<string, number[]> | null;
}

interface RoundSummary {
  total: number;
  qualified: number;
  rejected: number;
  needsReview: number;
  pending: number;
}

interface TopEntry {
  id: string;
  title: string;
  status: string;
  thumbnail: string | null;
  avgScore: number | null;
}

interface PreflightResult {
  drift_detected: boolean;
  ui_count: number;
  db_count: number;
  diff_count: number;
  ui_only: { entry_id: string; photo_index: number }[];
  db_only: { entry_id: string; photo_index: number }[];
  db_view: { entry_id: string; entry_title: string | null; ui_eligible_photos: number; my_decisions_missing: number; my_scores_missing: number }[];
  error?: string;
}

type Phase = "complete" | "resolve" | "declare";

const f = { fontFamily: "var(--font-heading)" };
const fb = { fontFamily: "var(--font-body)" };

const CompleteRoundDialog = ({ roundId, roundName, competitionId, roundNumber, onConfirm, onCancel, uiEligiblePhotos }: CompleteRoundDialogProps) => {
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [topEntries, setTopEntries] = useState<TopEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<Phase>("complete");
  const [doubleConfirm, setDoubleConfirm] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const fetchSummary = async () => {
    setLoading(true);

    // P-1: Single RPC call replaces 6 round-trips (4 counts + entries fetch + score cache fetch).
    // SECURITY DEFINER function gates by judge/admin role server-side.
    const { data, error } = await supabase.rpc("get_round_summary", {
      p_competition_id: competitionId,
      p_round_number: roundNumber,
    });

    if (error || !data) {
      console.error("get_round_summary failed:", error);
      setSummary({ total: 0, qualified: 0, rejected: 0, needsReview: 0, pending: 0 });
      setTopEntries([]);
      setLoading(false);
      return;
    }

    const payload = data as unknown as {
      total: number;
      qualified: number;
      rejected: number;
      needs_review: number;
      pending: number;
      top_entries: Array<{ id: string; title: string; status: string; thumbnail: string | null; avg_score: number | null }>;
    };

    setSummary({
      total: payload.total ?? 0,
      qualified: payload.qualified ?? 0,
      rejected: payload.rejected ?? 0,
      needsReview: payload.needs_review ?? 0,
      pending: payload.pending ?? 0,
    });

    setTopEntries(
      (payload.top_entries ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        thumbnail: e.thumbnail,
        avgScore: e.avg_score,
      }))
    );

    setLoading(false);
  };

  useEffect(() => {
    fetchSummary();
  }, [competitionId]);

  // Preflight: when the judge opened the dialog with a UI eligibility map,
  // call complete-round in `preflight` mode and compare against the canonical
  // DB-side eligibility. Drift blocks the declare button.
  const runPreflight = async () => {
    if (!uiEligiblePhotos) return;
    setPreflightLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("complete-round", {
        body: {
          competition_id: competitionId,
          round_number: roundNumber,
          preflight: true,
          ui_eligible: uiEligiblePhotos,
        },
      });
      if (error) {
        setPreflight({ drift_detected: true, ui_count: 0, db_count: 0, diff_count: -1, ui_only: [], db_only: [], db_view: [], error: error.message });
      } else {
        setPreflight(data as PreflightResult);
      }
    } catch (e: any) {
      setPreflight({ drift_detected: true, ui_count: 0, db_count: 0, diff_count: -1, ui_only: [], db_only: [], db_view: [], error: e?.message ?? "Preflight failed" });
    } finally {
      setPreflightLoading(false);
    }
  };

  useEffect(() => {
    if (uiEligiblePhotos) void runPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, roundNumber]);

  // Spec V3: 'Needs Review' is R1-only. R2/R3/R4 never block on NR — DB
  // guard rejects new NR rows for those rounds, and any orphan rows are
  // ignored by complete-round.
  const hasNeedsReview = roundNumber === 1 && summary && summary.needsReview > 0;

  const handleCompletePhase = () => {
    // Phase 1: "Complete" → Soft-lock, transition to resolve phase if needs_review exist
    if (hasNeedsReview) {
      setPhase("resolve");
    } else {
      setPhase("declare");
    }
  };

  const handleRefreshAfterResolve = () => {
    // Re-fetch summary after judge resolved needs_review entries
    fetchSummary().then(() => {
      // Auto-check if needs_review is now 0
    });
  };

  const handleDeclare = async () => {
    if (hasNeedsReview) return;
    if (!doubleConfirm) {
      setDoubleConfirm(true);
      return;
    }
    setConfirming(true);
    onConfirm();
  };

  const phaseTitle = phase === "complete" ? `Complete ${roundName}?`
    : phase === "resolve" ? `Resolve Needs Review — ${roundName}`
    : `Declare ${roundName} Final?`;

  const phaseIcon = phase === "resolve" ? <ShieldAlert className="h-6 w-6 text-amber-500" />
    : <AlertTriangle className="h-6 w-6 text-destructive" />;

  const phaseIconBg = phase === "resolve" ? "bg-amber-500/10" : "bg-destructive/10";

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="text-center">
          <div className={`w-14 h-14 rounded-full ${phaseIconBg} flex items-center justify-center mx-auto mb-3`}>
            {phaseIcon}
          </div>
          <h2 className="text-lg font-medium" style={{ fontFamily: "var(--font-display)" }}>
            {phaseTitle}
          </h2>
          {/* Phase indicator */}
          <div className="flex items-center justify-center gap-2 mt-2">
            {["complete", "resolve", "declare"].map((p, i) => (
              <div key={p} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full transition-colors ${
                  p === phase ? "bg-primary" : i < ["complete", "resolve", "declare"].indexOf(phase) ? "bg-primary/40" : "bg-muted"
                }`} />
                <span className={`text-[8px] uppercase tracking-wider ${p === phase ? "text-primary font-bold" : "text-muted-foreground/40"}`} style={f}>
                  {p === "complete" ? "Review" : p === "resolve" ? "Resolve" : "Declare"}
                </span>
                {i < 2 && <span className="text-muted-foreground/20 text-[8px] mx-1">→</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Warning */}
        {phase === "declare" && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <p className="text-[11px] text-destructive font-semibold" style={fb}>
              ⚠️ This action will PERMANENTLY finalize the round. No further scoring or changes will be allowed.
            </p>
          </div>
        )}

        {phase === "resolve" && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2">
            <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold" style={fb}>
              ⚠️ <strong>{summary?.needsReview}</strong> entries are marked as "Needs Review". You must resolve ALL of them before declaring the round final.
            </p>
            <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80" style={fb}>
              Go back to the judging panel, review the flagged entries, and change their status. Then click "Refresh & Check" below.
            </p>
          </div>
        )}

        {/* Summary */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading round summary…
          </div>
        ) : summary && (
          <>
            {uiEligiblePhotos && (
              <div
                className={`border rounded-lg p-3 space-y-2 mb-2 ${
                  preflightLoading
                    ? "bg-muted/30 border-border"
                    : preflight?.drift_detected
                      ? "bg-destructive/10 border-destructive/40"
                      : preflight
                        ? "bg-emerald-500/10 border-emerald-500/40"
                        : "bg-muted/30 border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <ScanSearch className="h-3 w-3" />
                    <p className="text-[9px] tracking-[0.15em] uppercase font-semibold" style={f}>
                      Preflight — UI ↔ DB Parity
                    </p>
                  </div>
                  <button
                    onClick={runPreflight}
                    disabled={preflightLoading}
                    className="text-[9px] tracking-[0.1em] uppercase px-2 py-0.5 border border-border/60 hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1"
                    style={f}
                  >
                    <RefreshCw className={`h-2.5 w-2.5 ${preflightLoading ? "animate-spin" : ""}`} />
                    Recheck
                  </button>
                </div>
                {preflightLoading ? (
                  <p className="text-[10px] text-muted-foreground" style={fb}>Comparing UI eligibility to database…</p>
                ) : preflight?.error ? (
                  <p className="text-[10px] text-destructive" style={fb}>{preflight.error}</p>
                ) : preflight ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-[10px]" style={f}>
                      <div className="bg-background/50 px-2 py-1 rounded border border-border/50">
                        <span className="text-muted-foreground">UI</span>{" "}
                        <span className="font-bold">{preflight.ui_count}</span>
                      </div>
                      <div className="bg-background/50 px-2 py-1 rounded border border-border/50">
                        <span className="text-muted-foreground">DB</span>{" "}
                        <span className="font-bold">{preflight.db_count}</span>
                      </div>
                      <div className="bg-background/50 px-2 py-1 rounded border border-border/50">
                        <span className="text-muted-foreground">Diff</span>{" "}
                        <span className={`font-bold ${preflight.drift_detected ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {preflight.diff_count}
                        </span>
                      </div>
                    </div>
                    {preflight.drift_detected ? (
                      <div className="space-y-1">
                        <p className="text-[10px] text-destructive font-semibold" style={fb}>
                          ⚠ Drift detected — UI and database disagree on which photos this judge is responsible for. Completing the round is blocked. Contact an admin (Competition Health → Judge UI vs DB Gate).
                        </p>
                        {preflight.ui_only.length > 0 && (
                          <p className="text-[9px] text-destructive/80" style={fb}>
                            UI-only ({preflight.ui_only.length}): {preflight.ui_only.slice(0, 3).map((d) => `${d.entry_id.slice(0, 8)}/p${d.photo_index + 1}`).join(", ")}{preflight.ui_only.length > 3 ? "…" : ""}
                          </p>
                        )}
                        {preflight.db_only.length > 0 && (
                          <p className="text-[9px] text-destructive/80" style={fb}>
                            DB-only ({preflight.db_only.length}): {preflight.db_only.slice(0, 3).map((d) => `${d.entry_id.slice(0, 8)}/p${d.photo_index + 1}`).join(", ")}{preflight.db_only.length > 3 ? "…" : ""}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold" style={fb}>
                        ✓ Eligibility matches — UI and database are in sync.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            )}

            <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
              <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold" style={f}>
                Impact Summary
              </p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {[
                  { label: "Total Entries", value: summary.total, color: "text-foreground" },
                  { label: "Qualified", value: summary.qualified, color: "text-primary" },
                  { label: "Rejected", value: summary.rejected, color: "text-destructive" },
                  { label: "Needs Review", value: summary.needsReview, color: summary.needsReview > 0 ? "text-amber-500" : "text-muted-foreground" },
                  { label: "Pending", value: summary.pending, color: "text-muted-foreground" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-[11px] px-2 py-1.5 bg-background/50 rounded border border-border/50" style={f}>
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={`font-bold ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Entries Preview */}
            {topEntries.length > 0 && phase !== "resolve" && (
              <div className="bg-muted/20 border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-3 w-3 text-primary" />
                  <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold" style={f}>
                    Top Entries Preview
                  </p>
                </div>
                <div className="space-y-1 max-h-[180px] overflow-y-auto">
                  {topEntries.map((entry, idx) => (
                    <div key={entry.id} className="flex items-center gap-2 text-[10px] py-1">
                      <span className="text-muted-foreground w-4 text-right shrink-0" style={f}>
                        #{idx + 1}
                      </span>
                      {entry.thumbnail && (
                        <img loading="lazy" decoding="async" src={entry.thumbnail} alt="" className="w-6 h-6 object-cover rounded-sm border border-border shrink-0" />
                      )}
                      <span className="flex-1 truncate text-foreground" style={fb}>
                        {entry.title}
                      </span>
                      <span className={`text-[9px] tracking-[0.1em] uppercase px-1 py-0.5 border shrink-0 ${
                        entry.status === "rejected" ? "text-destructive border-destructive/30"
                        : entry.status === "needs_review" ? "text-amber-500 border-amber-500/30"
                        : "text-primary border-primary/30"
                      }`} style={f}>
                        {entry.status.replace(/_/g, " ")}
                      </span>
                      {entry.avgScore != null && (
                        <span className="text-muted-foreground shrink-0 font-bold" style={f}>
                          {entry.avgScore.toFixed(1)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={confirming}
            className="flex-1 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            style={f}
          >
            Cancel
          </button>

          {phase === "complete" && (
            <button
              onClick={handleCompletePhase}
              disabled={loading}
              className="flex-1 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 rounded-lg transition-colors font-semibold flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              style={f}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Review & Complete
            </button>
          )}

          {phase === "resolve" && (
            <button
              onClick={handleRefreshAfterResolve}
              disabled={loading}
              className="flex-1 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 rounded-lg transition-colors font-semibold flex items-center justify-center gap-2 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
              style={f}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh & Check
            </button>
          )}

          {phase === "resolve" && !hasNeedsReview && (
            <button
              onClick={() => setPhase("declare")}
              className="flex-1 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 rounded-lg transition-colors font-semibold flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              style={f}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Proceed to Declare
            </button>
          )}

          {phase === "declare" && (() => {
            const driftBlock = !!preflight?.drift_detected;
            const blocked = !!hasNeedsReview || driftBlock || preflightLoading;
            return (
              <button
                onClick={handleDeclare}
                disabled={loading || confirming || blocked}
                className={`flex-1 text-[11px] tracking-[0.1em] uppercase px-4 py-2.5 rounded-lg transition-colors font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${
                  blocked
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                }`}
                style={f}
                title={hasNeedsReview ? "Resolve all needs_review entries first" : driftBlock ? "Preflight drift — contact admin" : preflightLoading ? "Preflight running…" : undefined}
              >
                {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                {hasNeedsReview ? "Resolve Needs Review First" : driftBlock ? "Preflight Drift — Blocked" : preflightLoading ? "Preflight…" : doubleConfirm ? "Yes, Declare Final" : `Declare ${roundName}`}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default CompleteRoundDialog;
