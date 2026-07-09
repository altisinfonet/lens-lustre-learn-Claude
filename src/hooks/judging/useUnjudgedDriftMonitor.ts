import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * J-03 safety net — dev-only drift detector.
 *
 * Watches the sidebar `unjudged` count (derived in useJudgePhotoData
 * `getMyDecisionCounts`) against the live `filteredPhotos.length` rendered
 * in the grid when the user has the Unjudged filter active. They MUST be
 * equal — both are computed from the same `decision || score || tag` rule.
 * If they ever disagree, fire a single sonner warning per drift event so a
 * dev sees it immediately instead of shipping a silent counter regression.
 *
 * Production builds: no-op (zero runtime cost).
 */
export function useUnjudgedDriftMonitor(args: {
  enabled: boolean;
  sidebarView: string | null | undefined;
  unjudgedCount: number;
  filteredCount: number;
}) {
  const { enabled, sidebarView, unjudgedCount, filteredCount } = args;
  const lastReportedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!enabled) return;
    if (sidebarView !== "unjudged") {
      lastReportedRef.current = null;
      return;
    }
    if (unjudgedCount === filteredCount) {
      lastReportedRef.current = null;
      return;
    }
    const signature = `${unjudgedCount}:${filteredCount}`;
    if (lastReportedRef.current === signature) return;
    lastReportedRef.current = signature;

    const delta = filteredCount - unjudgedCount;
    console.warn("[J-03 drift] sidebar Unjudged ≠ grid count", { unjudgedCount, filteredCount, delta });
    toast.warning("Unjudged counter drift", {
      description: `Sidebar says ${unjudgedCount}, grid shows ${filteredCount} (Δ ${delta > 0 ? "+" : ""}${delta}). Decision/score/tag rule is out of sync.`,
      duration: 8000,
    });
  }, [enabled, sidebarView, unjudgedCount, filteredCount]);
}
