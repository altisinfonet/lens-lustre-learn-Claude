/**
 * FullscreenAdShell — the shared full-screen overlay used by interstitial,
 * app-open, and (via composition) rewarded ads.
 *
 * Renders an own-ad creative (image + optional headline/subtext/CTA) centered
 * over a dimmed backdrop, with a top bar that shows a countdown and reveals a
 * Close/Skip control only after `skippableAfterSeconds`. Purely presentational
 * — the caller owns when it opens/closes and any reward logic.
 *
 * Additive: nothing imports this yet.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdZoneCreative } from "@/lib/ads/adZonesV2";

interface FullscreenAdShellProps {
  creative: AdZoneCreative;
  /** Seconds before the Close/Skip control appears. 0 = immediately closable. */
  skippableAfterSeconds: number;
  /** Called when the user closes/skips (after it's allowed). */
  onClose: () => void;
  /** Called once when the creative is first shown (for impression tracking). */
  onShown?: () => void;
  /** Called when the user taps the creative (click-through). */
  onClickThrough?: () => void;
  /** Optional label shown top-left, e.g. "Sponsored" or "Ad". */
  label?: string;
  /** Optional footer node (e.g. the rewarded countdown + Claim button). */
  footer?: React.ReactNode;
  /** When true, hide the auto Close control entirely (rewarded owns its own flow). */
  hideDefaultClose?: boolean;
}

const FullscreenAdShell = ({
  creative,
  skippableAfterSeconds,
  onClose,
  onShown,
  onClickThrough,
  label = "Sponsored",
  footer,
  hideDefaultClose = false,
}: FullscreenAdShellProps) => {
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil(skippableAfterSeconds)));
  const shownRef = useRef(false);

  useEffect(() => {
    if (!shownRef.current) { shownRef.current = true; onShown?.(); }
  }, [onShown]);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => (r <= 1 ? 0 : r - 1)), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const canClose = remaining <= 0;

  const clickThrough = () => {
    onClickThrough?.();
    if (creative.click_url) window.open(creative.click_url, "_blank", "noopener,noreferrer");
  };

  const hasImage = creative.image_source !== "code" && !!creative.image_url;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm px-4">
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3">
        <span className="text-[9px] tracking-[0.3em] uppercase text-white/60" style={{ fontFamily: "var(--font-heading)" }}>{label}</span>
        {!hideDefaultClose && (
          canClose ? (
            <button
              onClick={onClose}
              aria-label="Close ad"
              className="flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <X className="h-3.5 w-3.5" /> Close
            </button>
          ) : (
            <span className="rounded-full bg-white/10 text-white/70 h-8 w-8 flex items-center justify-center text-xs tabular-nums" aria-label={`${remaining} seconds until you can close`}>
              {remaining}
            </span>
          )
        )}
      </div>

      {/* Creative */}
      <div className="w-full max-w-md">
        {hasImage ? (
          <button onClick={clickThrough} className={cn("block w-full text-left", creative.click_url ? "cursor-pointer" : "cursor-default")} disabled={!creative.click_url}>
            <div className="relative overflow-hidden rounded-lg shadow-2xl">
              <img src={creative.image_url} alt={creative.alt_text || "Sponsored"} className="w-full h-auto object-contain max-h-[70vh]" />
              {(creative.creative_headline || creative.creative_subtext || creative.creative_cta) && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-10">
                  {creative.creative_headline && <p className="text-white font-semibold leading-tight text-base line-clamp-3">{creative.creative_headline}</p>}
                  {creative.creative_subtext && <p className="text-white/80 text-sm leading-snug mt-1 line-clamp-2">{creative.creative_subtext}</p>}
                  {creative.creative_cta && (
                    <span className="inline-flex mt-2 items-center rounded-full bg-primary text-primary-foreground uppercase tracking-[0.18em] px-3 py-1.5 text-[10px]">{creative.creative_cta}</span>
                  )}
                </div>
              )}
            </div>
          </button>
        ) : (
          <div className="rounded-lg bg-white/5 p-6 text-center text-white/70 text-sm">Advertisement</div>
        )}
      </div>

      {footer && <div className="w-full max-w-md mt-4">{footer}</div>}
    </div>
  );
};

export default FullscreenAdShell;
