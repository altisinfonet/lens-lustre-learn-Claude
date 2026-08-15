/**
 * GRID ⇄ FEED switch for a member's wall.
 *
 * Instagram puts this exact control in this exact place — directly above the
 * photographs, full width, two equal halves — and it is worth copying rather
 * than inventing, because a member arriving from Instagram already knows what
 * it does without being told.
 *
 * WHY IT IS NOT REMEMBERED BETWEEN VISITS.
 * The obvious next step is to persist the choice in localStorage. It is
 * deliberately not done yet: this app is currently investigating random
 * sign-outs whose leading suspects include WebView storage loss
 * (docs/fix-sprints/owner-reported-3-bugs-2026-08-15.md), and adding a second
 * reason to write to that store while the first is unexplained would make the
 * investigation harder, not the app better. It can be added the day that bug is
 * closed with evidence.
 *
 * TAP TARGETS: both halves are min-h-11 (44px). The screenshot sweep in
 * tools/uishot/capture.mjs fails the run below that, and it caught a 36px
 * button on its very first run.
 */

import { LayoutGrid, Rows3 } from "lucide-react";

export type WallView = "grid" | "feed";

interface Props {
  value: WallView;
  onChange: (v: WallView) => void;
  /** Announced to screen readers so the control is not just two icons. */
  className?: string;
}

const WallViewToggle = ({ value, onChange, className = "" }: Props) => {
  const base =
    "flex min-h-11 flex-1 items-center justify-center gap-2 border-b-2 text-sm font-medium transition-colors";
  const on = "border-foreground text-foreground";
  const off = "border-transparent text-muted-foreground hover:text-foreground";

  return (
    <div role="tablist" aria-label="Wall layout" className={`flex w-full ${className}`}>
      <button
        type="button"
        role="tab"
        aria-selected={value === "grid"}
        onClick={() => onChange("grid")}
        className={`${base} ${value === "grid" ? on : off}`}
      >
        <LayoutGrid className="h-5 w-5" aria-hidden />
        <span className="sr-only sm:not-sr-only">Grid</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "feed"}
        onClick={() => onChange("feed")}
        className={`${base} ${value === "feed" ? on : off}`}
      >
        <Rows3 className="h-5 w-5" aria-hidden />
        <span className="sr-only sm:not-sr-only">Feed</span>
      </button>
    </div>
  );
};

export default WallViewToggle;
