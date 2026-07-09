/**
 * decisionParityProbe — DEV-ONLY parity check for per-photo optimistic decisions.
 *
 * After every optimistic `updateDecisionOptimistic(entryId, photoIndex, decision, …)`
 * call, the probe reads the live `judge_decisions` row for the same
 * (entry_id, photo_index, judge_id, round_number) ~2.5s later (after the
 * realtime debounce + refetch settle window) and warns to the browser
 * console if the two values diverge.
 *
 * Why: catches the exact regression we just fixed (DB tag label changed
 * but `tagLabelToDecision` not updated → optimistic value silently
 * disagreed with server → UI showed wrong decision until manual refresh).
 *
 * Production cost: literally zero. The whole call site is wrapped in
 * `if (import.meta.env.DEV)` and Vite tree-shakes the import out of the
 * production bundle.
 */
import { supabase } from "@/integrations/supabase/client";

const REFETCH_SETTLE_MS = 2500;

export function probeDecisionParity(args: {
  entryId: string;
  photoIndex: number;
  judgeId: string;
  roundNumber: number;
  optimisticDecision: string; // "" means "decision was cleared"
  source: string; // e.g. "toggleTag:add" / "toggleTag:remove"
}) {
  if (!import.meta.env.DEV) return; // hard guard — also tree-shaken by Vite
  const { entryId, photoIndex, judgeId, roundNumber, optimisticDecision, source } = args;
  setTimeout(async () => {
    try {
      const { data, error } = await (supabase
        .from("judge_decisions" as any)
        .select("decision")
        .eq("entry_id", entryId)
        .eq("photo_index", photoIndex)
        .eq("judge_id", judgeId)
        .eq("round_number", roundNumber)
        .maybeSingle() as any);
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("[decision-parity] probe read failed", { source, error: error.message });
        return;
      }
      const serverDecision: string = (data?.decision as string) ?? "";
      const expected = optimisticDecision || "";
      if (expected === serverDecision) return; // ✅ in sync
      // eslint-disable-next-line no-console
      console.warn(
        `[decision-parity] DIVERGENCE (${source}) — optimistic="${expected}" server="${serverDecision}"`,
        { entryId, photoIndex, judgeId, roundNumber },
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[decision-parity] probe threw", e);
    }
  }, REFETCH_SETTLE_MS);
}
