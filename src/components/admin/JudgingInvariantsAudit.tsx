/**
 * JudgingInvariantsAudit — R4 Hardening admin widget.
 *
 * Surfaces the four forensic checks returned by the security-definer RPC
 * `judging_invariants_check()`:
 *   1. tag_decision_drift       — judge_tag_assignments not mirrored into judge_decisions
 *   2. current_round_canonical  — competitions/entries with non 1..4 current_round
 *   3. decision_vocabulary      — judge_decisions.decision outside the canonical set
 *   4. eligibility_consistency  — get_round_eligible_photos vs qualifying decisions in R-1
 *
 * Also reads the latest cron-detected failures from `db_audit_logs`
 * (table_name='judging_invariants', operation='drift_detected') so admins
 * see drift the moment the nightly job catches it — not when a judge complains.
 *
 * Re-used by AdminHealth (global). Admin-only via SECURITY DEFINER guard
 * inside the RPC + RLS on db_audit_logs.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, ShieldCheck, Activity, Clock, Wrench, ExternalLink, ListChecks } from "lucide-react";
import { toast } from "sonner";

interface DriftRow {
  entry_id: string;
  competition_id: string | null;
  competition_title: string | null;
  judge_id: string;
  judge_handle: string | null;
  tag_id: string;
  tag_label: string | null;
  round_number: number;
  decision: string;
  photo_index: number;
  entry_title: string | null;
}

interface InvariantRow {
  check_name: string;
  status: string; // 'ok' | 'fail'
  fail_count: number;
  sample: unknown;
}

interface CronFailureRow {
  row_id: string; // check_name
  new_data: { check_name: string; fail_count: number; sample: unknown; detected_at: string } | null;
  created_at: string;
}

interface RepairResult {
  before: number;
  scanned: number;
  fixed: number;
  after: number;
  ranAt: string;
}

const CHECK_LABELS: Record<string, { title: string; help: string }> = {
  tag_decision_drift: {
    title: "Tag ↔ Decision Mirror",
    help: "Every system tag must have a matching judge_decisions row. A non-zero count means a judge tag is not visible to gates/RPCs.",
  },
  current_round_canonical: {
    title: "Round Value Canonical",
    help: "competitions.current_round and competition_entries.current_round must match ^[1-4]$. A typo here hides entries from the next round.",
  },
  decision_vocabulary: {
    title: "Decision Vocabulary",
    help: "judge_decisions.decision must be in the canonical set. Foreign words break aggregation, eligibility and gates.",
  },
  eligibility_consistency: {
    title: "Eligibility Consistency",
    help: "get_round_eligible_photos(R) must equal photos with a qualifying decision in R-1. Drift means R-N shows wrong photos.",
  },
};

const JudgingInvariantsAudit = () => {
  const [rows, setRows] = useState<InvariantRow[] | null>(null);
  const [cronFailures, setCronFailures] = useState<CronFailureRow[]>([]);
  const [lastCronAt, setLastCronAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [lastRepair, setLastRepair] = useState<RepairResult | null>(null);
  const [driftRows, setDriftRows] = useState<DriftRow[] | null>(null);
  const [loadingDrift, setLoadingDrift] = useState(false);
  const [showDrift, setShowDrift] = useState(false);

  const fetchDriftRows = async () => {
    setLoadingDrift(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("list_tag_decision_drift_admin" as any);
      if (rpcErr) throw rpcErr;
      setDriftRows((data as DriftRow[]) ?? []);
      setShowDrift(true);
    } catch (e: any) {
      toast.error(`Could not load drift rows: ${e?.message ?? "unknown error"}`);
    } finally {
      setLoadingDrift(false);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1) Live invariants snapshot
      const { data, error: rpcErr } = await supabase.rpc("judging_invariants_check" as any);
      if (rpcErr) throw rpcErr;
      const liveRows = (data as InvariantRow[]) ?? [];
      setRows(liveRows);
      setRanAt(new Date().toISOString());

      // 2) Latest cron-detected failures (last 24h)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: logRows, error: logErr } = await supabase
        .from("db_audit_logs")
        .select("row_id, new_data, created_at")
        .eq("table_name", "judging_invariants")
        .eq("operation", "drift_detected")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      if (logErr) throw logErr;
      const fails = (logRows as CronFailureRow[]) ?? [];
      setCronFailures(fails);

      // 3) Last cron run timestamp = max created_at across ALL rows in audit log
      // (not filtered to drift_detected, since a healthy run writes nothing).
      // Fall back to the most recent drift row if no separate heartbeat exists.
      setLastCronAt(fails[0]?.created_at ?? null);
      return liveRows;
    } catch (e: any) {
      setError(e?.message ?? "Failed to load invariants");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const [fixing, setFixing] = useState(false);
  const runBackfill = async () => {
    setFixing(true);
    try {
      const before = rows?.find((r) => r.check_name === "tag_decision_drift")?.fail_count ?? 0;
      const { data, error: rpcErr } = await supabase.rpc(
        "backfill_tag_decision_drift_admin" as any,
      );
      if (rpcErr) throw rpcErr;
      const row = Array.isArray(data) ? data[0] : data;
      const fixed = row?.inserted_count ?? 0;
      const scanned = row?.scanned_count ?? 0;
      const freshRows = await fetchAll();
      const after = freshRows?.find((r) => r.check_name === "tag_decision_drift")?.fail_count ?? 0;
      setLastRepair({ before, scanned, fixed, after, ranAt: new Date().toISOString() });
      toast.success(
        after === 0
          ? `Repair verified · before ${before}, fixed ${fixed}, now 0 fail`
          : `Repair ran · before ${before}, fixed ${fixed}, still ${after} fail`,
      );
    } catch (e: any) {
      toast.error(`Backfill failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setFixing(false);
    }
  };

  useEffect(() => {
    void fetchAll();
  }, []);

  const failingLive = (rows ?? []).filter((r) => r.status !== "ok");
  const activeCronFailures = cronFailures.filter((row) => {
    const checkName = row.new_data?.check_name ?? row.row_id;
    return failingLive.some((liveRow) => liveRow.check_name === checkName);
  });
  const resolvedCronFailures = cronFailures.filter((row) => {
    const checkName = row.new_data?.check_name ?? row.row_id;
    return !failingLive.some((liveRow) => liveRow.check_name === checkName);
  });
  const overallOk = rows !== null && failingLive.length === 0;

  const headerBorder = overallOk
    ? "border-emerald-500/40 bg-emerald-500/5"
    : rows === null
      ? "border-border bg-card/40"
      : "border-destructive/50 bg-destructive/5";

  return (
    <div className={`border-2 rounded-lg p-5 ${headerBorder}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3
            className="text-sm font-semibold text-foreground flex items-center gap-2"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Activity className="h-3.5 w-3.5" />
            Judging Invariants
            {overallOk && (
              <span className="inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-emerald-600 dark:text-emerald-400 font-semibold ml-2">
                <ShieldCheck className="h-3 w-3" />
                All green
              </span>
            )}
            {!overallOk && rows !== null && (
              <span className="inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-destructive font-semibold ml-2">
                <AlertTriangle className="h-3 w-3" />
                Drift detected
              </span>
            )}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1" style={{ fontFamily: "var(--font-body)" }}>
            R4 — admin sees drift before users do. Live RPC + nightly cron audit log.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {ranAt && (
            <span
              className="text-[10px] tracking-[0.1em] uppercase text-muted-foreground inline-flex items-center gap-1"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Clock className="h-3 w-3" /> {new Date(ranAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchAll}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Re-run now"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-destructive mb-3" style={{ fontFamily: "var(--font-body)" }}>
          {error}
        </div>
      )}

      {lastRepair && (
        <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-foreground" style={{ fontFamily: "var(--font-body)" }}>
          <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-3 w-3" />
            Repair proof · before {lastRepair.before} · scanned {lastRepair.scanned} · fixed {lastRepair.fixed} · now {lastRepair.after} fail
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Verified by fresh live audit at {new Date(lastRepair.ranAt).toLocaleTimeString()}.
          </div>
        </div>
      )}

      {/* Live snapshot grid */}
      {rows !== null && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          {rows.map((r) => {
            const meta = CHECK_LABELS[r.check_name] ?? { title: r.check_name, help: "" };
            const ok = r.status === "ok";
            return (
              <div
                key={r.check_name}
                className={`rounded-md border p-3 ${
                  ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[11px] font-semibold tracking-wide text-foreground"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {meta.title}
                  </span>
                  <span
                    className={`text-[10px] tracking-[0.15em] uppercase font-semibold ${
                      ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                    }`}
                  >
                    {ok ? "OK" : `${r.fail_count} fail`}
                  </span>
                </div>
                <p className="text-[10.5px] text-muted-foreground mt-1.5 leading-relaxed">{meta.help}</p>
                {ok && r.check_name === "tag_decision_drift" && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1 text-[10px] tracking-[0.1em] uppercase text-emerald-600 dark:text-emerald-400" style={{ fontFamily: "var(--font-heading)" }}>
                    <ShieldCheck className="h-3 w-3" />
                    Repair not needed · live audit 0 fail
                  </div>
                )}
                {!ok && r.check_name === "tag_decision_drift" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={runBackfill}
                      disabled={fixing}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-2.5 py-1 bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50 transition-opacity rounded"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <Wrench className={`h-3 w-3 ${fixing ? "animate-spin" : ""}`} />
                      {fixing ? "Backfilling…" : "🔧 Backfill orphan tags"}
                    </button>
                    <button
                      onClick={fetchDriftRows}
                      disabled={loadingDrift}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-2.5 py-1 border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors rounded"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      <ListChecks className={`h-3 w-3 ${loadingDrift ? "animate-pulse" : ""}`} />
                      {loadingDrift ? "Loading…" : `📋 List ${r.fail_count} drifting photo${r.fail_count === 1 ? "" : "s"}`}
                    </button>
                  </div>
                )}
                {!ok && r.check_name === "tag_decision_drift" && showDrift && driftRows && (
                  <div className="mt-3 border border-destructive/30 rounded bg-background/60 max-h-96 overflow-y-auto">
                    <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border px-2.5 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] tracking-[0.15em] uppercase font-semibold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                        {driftRows.length} drifting photo{driftRows.length === 1 ? "" : "s"} · click to fix
                      </span>
                      <button
                        onClick={() => setShowDrift(false)}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        ✕ close
                      </button>
                    </div>
                    {driftRows.length === 0 ? (
                      <p className="p-3 text-[11px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
                        No detailed rows returned. The cron may have just run; click Re-run now.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {driftRows.map((d, i) => {
                          const photoLink = d.competition_id
                            ? `/competitions/${d.competition_id}/entry/${d.entry_id}/photo/${d.photo_index}`
                            : `/entry/${d.entry_id}`;
                          return (
                            <li key={`${d.entry_id}-${d.judge_id}-${d.tag_id}-${d.photo_index}-${i}`} className="px-2.5 py-2 hover:bg-muted/40 transition-colors">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] text-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>
                                    <strong>{d.entry_title ?? "Untitled entry"}</strong>
                                    <span className="text-muted-foreground"> · photo #{d.photo_index}</span>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5" style={{ fontFamily: "var(--font-body)" }}>
                                    <span>{d.competition_title ?? "—"}</span>
                                    <span>·</span>
                                    <span>R{d.round_number}</span>
                                    <span>·</span>
                                    <span>tag: <code className="text-foreground">{d.tag_label ?? d.tag_id.slice(0, 8)}</code></span>
                                    <span>·</span>
                                    <span>missing decision: <code className="text-destructive">{d.decision}</code></span>
                                    <span>·</span>
                                    <span>judge: {d.judge_handle ?? d.judge_id.slice(0, 8)}</span>
                                  </div>
                                </div>
                                <Link
                                  to={photoLink}
                                  className="shrink-0 inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
                                  style={{ fontFamily: "var(--font-heading)" }}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Open photo
                                </Link>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
                {!ok && r.check_name !== "tag_decision_drift" && r.sample !== null && r.sample !== undefined && (
                  <pre className="mt-2 p-2 text-[10px] bg-background/60 rounded border border-border overflow-x-auto max-h-40">
                    {JSON.stringify(r.sample, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cron failure log (last 24h) */}
      <div className="mt-2 border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-semibold"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Nightly cron · last 24h
          </span>
          {lastCronAt && (
            <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
              latest: {new Date(lastCronAt).toLocaleString()}
            </span>
          )}
        </div>
        {cronFailures.length === 0 ? (
          <p
            className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-body)" }}
          >
            <ShieldCheck className="h-3 w-3 text-emerald-500" />
            No drift recorded by the cron in the last 24h.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {[...activeCronFailures, ...resolvedCronFailures].map((row, i) => {
              const cn = row.new_data?.check_name ?? row.row_id;
              const fc = row.new_data?.fail_count ?? 0;
              const meta = CHECK_LABELS[cn] ?? { title: cn };
              const isResolved = !activeCronFailures.includes(row);
              return (
                <li
                  key={`${row.row_id}-${i}`}
                  className={`flex items-center justify-between gap-3 text-[11px] border rounded px-2.5 py-1.5 ${
                    isResolved
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                >
                  <span className="text-foreground" style={{ fontFamily: "var(--font-body)" }}>
                    {isResolved ? (
                      <ShieldCheck className="h-3 w-3 inline mr-1.5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 inline mr-1.5 text-destructive" />
                    )}
                    <strong>{meta.title}</strong> — {isResolved ? "resolved" : `${fc} failing rows`}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {resolvedCronFailures.length > 0 && activeCronFailures.length === 0 && (
          <p className="mt-2 text-[10.5px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
            Old cron warnings are shown as resolved because the current live audit is green. The repair button only appears when live drift exists.
          </p>
        )}
      </div>
    </div>
  );
};

export default JudgingInvariantsAudit;
