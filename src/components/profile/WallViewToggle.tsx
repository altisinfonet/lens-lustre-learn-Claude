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

import { Grid3x3, Rows3 } from "lucide-react";

export type WallView = "grid" | "feed";

interface Props {
  value: WallView;
  onChange: (v: WallView) => void;
  /** Announced to screen readers so the control is not just two icons. */
  className?: string;
}

const WallViewToggle = ({ value, onChange, className = "" }: Props) => {
  /**
   * MATCHED TO THE OWNER'S REAL-INSTAGRAM REFERENCE, 2026-08-16: icons only,
   * a 1px hairline under the whole bar, and a 1.5px WHITE underline under the
   * active tab only. Instagram's grid glyph is the nine-dot 3x3, not the
   * four-square. Inactive icons are dimmed, active is full white — the
   * "stronger icon state" his spec section 10 asks for, plus the underline.
   */
  const base =
    "relative flex min-h-11 flex-1 items-center justify-center transition-colors";
  const on = "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[1.5px] after:bg-foreground";
  const off = "text-muted-foreground/70 hover:text-foreground";

  return (
    <div role="tablist" aria-label="Wall layout" className={`flex w-full border-b border-border/60 ${className}`}>
      <button
        type="button"
        role="tab"
        aria-selected={value === "grid"}
        onClick={() => onChange("grid")}
        className={`${base} ${value === "grid" ? on : off}`}
      >
        <Grid3x3 className="h-6 w-6" aria-hidden strokeWidth={1.75} />
        <span className="sr-only sm:not-sr-only">Grid</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "feed"}
        onClick={() => onChange("feed")}
        className={`${base} ${value === "feed" ? on : off}`}
      >
        <Rows3 className="h-6 w-6" aria-hidden strokeWidth={1.75} />
        <span className="sr-only sm:not-sr-only">Feed</span>
      </button>
    </div>
  );
};

export default WallViewToggle;
