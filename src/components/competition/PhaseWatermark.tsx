import React from "react";
import { useCanBypassWatermark } from "@/hooks/competition/useCanBypassWatermark";

export type PhaseWatermarkSurface = "card" | "lightbox" | "cinema";

interface PhaseWatermarkProps {
  /** Competition phase. Watermark only renders when phase === "judging". */
  phase: string;
  /** Current judging round ("1" | "2" | "3" | "4" | null). */
  currentRound: string | null;
  /**
   * Surface this watermark is rendered on. Reserved for future per-surface
   * sizing tweaks; the default ("card") preserves the exact original markup
   * extracted from EntryCard.tsx (lines 119–132).
   */
  surface?: PhaseWatermarkSurface;
}

/**
 * Single source of truth for the diagonal "Judging in Progress" watermark
 * overlay shown on competition entry imagery during the judging phase.
 *
 * Extracted verbatim from src/components/EntryCard.tsx (lines 119–132) as
 * part of Step 19. No visual or behavioural changes.
 */
const PhaseWatermark: React.FC<PhaseWatermarkProps> = ({
  phase,
  currentRound: _currentRound, // intentionally not rendered — see note below
  surface = "card",
}) => {
  // Step 23 — Role-based bypass: admins + judges always see clean imagery.
  // Owner + public continue to see the watermark during the judging phase.
  // Hook is called unconditionally (Rules of Hooks); short-circuits below.
  const { canBypass } = useCanBypassWatermark();

  if (phase !== "judging") return null;
  if (canBypass) return null;

  // 2026-05-02 — Participant-safe watermark.
  // We intentionally DO NOT surface the internal `current_round` value
  // (e.g. "Round 4 · Final Judging") to participants. The admin sets
  // `competitions.current_round` as soon as judges open the next round,
  // which is BEFORE results are officially declared/published. Showing
  // it leaked unpublished round labels onto the participant gallery —
  // the exact "fake update" the user reported. Admins / judges already
  // bypass this overlay above, so a generic label is correct for the
  // remaining audience (owner + public).
  void _currentRound;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-[5]">
      <div className="px-6 py-3 rounded-lg bg-background/10 backdrop-blur-[2px]">
        <span
          className="text-[24px] md:text-[40px] font-bold uppercase tracking-[0.25em] text-foreground/[0.08] rotate-[-25deg] whitespace-nowrap block"
          style={{ fontFamily: "var(--font-display)", textShadow: "0 1px 2px rgba(0,0,0,0.1)" }}
          data-surface={surface}
        >
          Judging in Progress
        </span>
      </div>
    </div>
  );
};

export default React.memo(PhaseWatermark);
