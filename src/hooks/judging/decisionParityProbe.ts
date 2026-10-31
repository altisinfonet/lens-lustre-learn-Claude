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

import { logger } from "@/lib/logger";

const FILE = "src/hooks/judging/decisionParityProbe.ts";

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
        logger.debug({
          code: "JUDGE-6107", event: "DECISION_PARITY_PROBE_READ_FAILED",
          fn: "probeDecisionParity", file: FILE,
          message: "The development decision-parity probe could not read its source.",
          reason: error.message,
          expected: "A decision row to compare against the UI",
          actual: "The read failed",
          detail: { source },
        });
        return;
      }
      const serverDecision: string = (data?.decision as string) ?? "";
      const expected = optimisticDecision || "";
      if (expected === serverDecision) return; // ✅ in sync
      logger.debug({
        code: "JUDGE-6107", event: "DECISION_PARITY_DIVERGENCE",
        fn: "probeDecisionParity", file: FILE,
        message: "The optimistic decision on screen disagrees with the stored one.",
        reason: "The probe compared what the UI showed against what the database holds.",
        expected: `optimistic "${expected}"`,
        actual: `server "${serverDecision}"`,
        nextStep: "Development only. The UI is showing a judge something the database does not agree with — fix at the source of the optimistic update, not here.",
        recordId: entryId,
        detail: { source, photoIndex, judgeId, roundNumber },
      });
    } catch (e) {
      logger.debug({
        code: "JUDGE-6107", event: "DECISION_PARITY_PROBE_THREW",
        fn: "probeDecisionParity", file: FILE,
        message: "The development decision-parity probe threw.",
        reason: e instanceof Error ? e.message : String(e),
        expected: "A completed comparison",
        actual: "The probe threw",
      });
    }
  }, REFETCH_SETTLE_MS);
}
