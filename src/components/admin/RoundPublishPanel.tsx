/**
 * RoundPublishPanel — Spec v3 / Golden Rule "Locking ≠ Declaring"
 *
 * Two-step admin gate per round:
 *   1. LOCK   — set by judge via `complete-round` (stamps `closed_at`).
 *               Means: judging is finished, results are pending admin review.
 *   2. DECLARE — set by admin here via `publish-round` (stamps `published_at`).
 *               Triggers participant visibility, certificates, and emails.
 *
 * The "Declare" button is disabled until the round is locked. Undeclaring
 * pulls results back to admin-only (rare, audit-logged).
 */
import { useEffect, useState } from "react";
import { Loader2, Eye, EyeOff, CheckCircle2, Lock, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { queryKeys } from "@/lib/queryKeys";

interface PublishRow {
  competition_id: string;
  round_number: number;
  closed_at: string | null;
  closed_by: string | null;
  published_at: string | null;
  published_by: string | null;
}

interface Props {
  competitionId: string;
}

const ROUND_LABELS: Record<number, string> = {
  1: "Round 1 — Initial Screening",
  2: "Round 2 — Shortlist",
  3: "Round 3 — Finalist Selection",
  4: "Round 4 — Final Awards",
};

type RoundState = "open" | "locked" | "declared";

const stateOf = (row: PublishRow): RoundState => {
  if (row.published_at) return "declared";
  if (row.closed_at) return "locked";
  return "open";
};

export default function RoundPublishPanel({ competitionId }: Props) {
  const [rows, setRows] = useState<PublishRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRound, setBusyRound] = useState<number | null>(null);
  const qc = useQueryClient();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("competition_round_publish" as any)
      .select("competition_id, round_number, closed_at, closed_by, published_at, published_by")
      .eq("competition_id", competitionId)
      .order("round_number", { ascending: true });
    if (error) {
      toast({ title: "Failed to load round state", description: error.message, variant: "destructive" });
    } else {
      setRows((data as any as PublishRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [competitionId]);

  const toggle = async (round: number, action: "publish" | "unpublish") => {
    setBusyRound(round);
    try {
      const { data, error } = await supabase.functions.invoke("publish-round", {
        body: { competition_id: competitionId, round_number: round, action },
      });
      if (error || (data as any)?.error) {
        const context = (error as any)?.context;
        let backendError: string | null = null;
        if (context instanceof Response) {
          try {
            const body = await context.clone().json();
            backendError = body?.error || body?.message || null;
          } catch {
            try { backendError = await context.clone().text(); } catch { backendError = null; }
          }
        }
        throw new Error((data as any)?.error || backendError || error?.message || "Failed");
      }
      toast({
        title: action === "publish" ? `Round ${round} declared` : `Round ${round} undeclared`,
        description:
          action === "publish"
            ? "Results are now visible to participants. Notification emails will be dispatched."
            : "Results hidden — all participant panels will revert to Under Review within seconds.",
      });
      qc.invalidateQueries({ queryKey: queryKeys.gatedEntryStatusAll() });
      qc.invalidateQueries({ queryKey: queryKeys.entryPublicStatusAll() });
      qc.invalidateQueries({ queryKey: ["competition-detail"] });
      qc.invalidateQueries({ queryKey: queryKeys.submissionDetailAll() });
      await load();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setBusyRound(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading round state…
      </div>
    );
  }

  const byRound = new Map(rows.map((r) => [r.round_number, r]));
  const display = [1, 2, 3, 4].map(
    (r): PublishRow =>
      byRound.get(r) ?? {
        competition_id: competitionId,
        round_number: r,
        closed_at: null,
        closed_by: null,
        published_at: null,
        published_by: null,
      }
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-px bg-primary" />
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-primary"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Result Declaration
          </span>
        </div>
        <h3
          className="text-xl font-light tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Round <em className="italic text-primary">Lock & Declare</em> Gate
        </h3>
        <p
          className="text-xs text-muted-foreground mt-1.5 max-w-2xl"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <strong className="text-foreground">Locking ≠ Declaring.</strong>{" "}
          Judges <em>lock</em> a round when they finish judging it — that protects the data but
          stays admin-only. Participants only see results, get emails, or become eligible for
          certificates after <em>you</em> click <strong>Declare</strong> here. This two-step
          gate gives you a chance to review consensus before going public.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {display.map((row) => {
          const state = stateOf(row);
          const busy = busyRound === row.round_number;

          const stateChip =
            state === "declared" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-primary/15 text-primary text-[9px] tracking-[0.18em] uppercase font-bold" style={{ fontFamily: "var(--font-heading)" }}>
                <CheckCircle2 className="h-3 w-3" /> Declared
              </span>
            ) : state === "locked" ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] tracking-[0.18em] uppercase font-bold" style={{ fontFamily: "var(--font-heading)" }}>
                <Lock className="h-3 w-3" /> Locked · awaiting declaration
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-muted text-muted-foreground text-[9px] tracking-[0.18em] uppercase font-bold" style={{ fontFamily: "var(--font-heading)" }}>
                <AlertCircle className="h-3 w-3" /> Not locked yet
              </span>
            );

          return (
            <div
              key={row.round_number}
              className={`border p-4 transition-colors ${
                state === "declared"
                  ? "border-primary/40 bg-primary/5"
                  : state === "locked"
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-2">
                  <div
                    className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {ROUND_LABELS[row.round_number]}
                  </div>
                  {stateChip}
                  <div
                    className="text-[10px] text-muted-foreground space-y-0.5"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    <div>
                      <span className="opacity-70">Locked:</span>{" "}
                      {row.closed_at ? new Date(row.closed_at).toLocaleString() : "—"}
                    </div>
                    <div>
                      <span className="opacity-70">Declared:</span>{" "}
                      {row.published_at ? new Date(row.published_at).toLocaleString() : "—"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {state === "declared" ? (
                  <button
                    onClick={() => toggle(row.round_number, "unpublish")}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-[10px] tracking-[0.15em] uppercase hover:border-destructive hover:text-destructive transition-colors disabled:opacity-40"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
                    Undeclare
                  </button>
                ) : state === "locked" ? (
                  <button
                    onClick={() => toggle(row.round_number, "publish")}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-40"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                    Declare Round {row.round_number}
                  </button>
                ) : (
                  <button
                    disabled
                    title="Judges must complete (lock) this round before it can be declared."
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted text-muted-foreground text-[10px] tracking-[0.15em] uppercase cursor-not-allowed opacity-60"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    <Lock className="h-3 w-3" />
                    Awaiting judge lock
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
