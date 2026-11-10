/**
 * ONE ROW OF FILTER CHIPS (Courses, Journal, Competitions), SCROLLING SIDEWAYS.
 *
 * Owner, 2026-11-10 (app, 390px): on Competitions "Results" was cut in half at
 * the right edge with nothing to say the row scrolls. Measured on live: each of
 * the three pages had its own copy of `flex gap-2 overflow-x-auto scrollbar-hide`,
 * and every one ended in a hard cut inside the page padding.
 *
 * Here, once (coverAndChipRowGate.test.ts keeps the pages on it):
 *  - while more chips lie to the right, the row's right edge FADES out — the
 *    usual "there is more, swipe" hint — and the fade goes when the end is reached;
 *  - the same on the left once the row has been scrolled;
 *  - a little vertical room so a chip's focus ring is not clipped.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const FADE = "28px";

export default function FilterChipRow({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const mask = edges.left || edges.right
    ? `linear-gradient(to right, ${edges.left ? `transparent, #000 ${FADE}` : "#000"}, ${edges.right ? `#000 calc(100% - ${FADE}), transparent` : "#000"})`
    : undefined;

  return (
    <div
      ref={ref}
      onScroll={measure}
      data-filter-chip-row=""
      data-more-left={edges.left ? "true" : "false"}
      data-more-right={edges.right ? "true" : "false"}
      className={cn("flex gap-2 overflow-x-auto scrollbar-hide py-0.5", className)}
      style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
    >
      {children}
    </div>
  );
}
