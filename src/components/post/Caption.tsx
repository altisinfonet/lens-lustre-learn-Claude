import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import RichContentRenderer from "@/components/RichContentRenderer";
import TranslateBar from "@/components/post/TranslateBar";

interface CaptionProps {
  content: string;
  maxLines?: number;
  /**
   * Rendered INSIDE the clamped paragraph, immediately before the text.
   * PostCard passes the author's name here so the caption reads
   * "<name> the caption text", which is how Instagram writes it. It has to be
   * inside the clamp, not above it, or the name would survive on its own line
   * while the text it belongs to is collapsed.
   * Omitted by every other caller, and then nothing is rendered.
   */
  prefix?: ReactNode;
}

/**
 * Tailwind only generates classes it can SEE as literal strings when it scans
 * the source. A template like `line-clamp-${n}` is invisible to that scanner,
 * so the rule may simply not exist in the stylesheet. It happened to work for
 * 2 lines only because `line-clamp-2` is written out literally in other files.
 * Mapping to literals makes any value actually work.
 */
const CLAMP: Record<number, string> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

const Caption = ({ content, maxLines = 2, prefix }: CaptionProps) => {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const clampRef = useRef<HTMLDivElement>(null);

  /**
   * BUG FIX (reported 2026-08-01): "See more" never appeared on short captions
   * that ran to several lines.
   *
   * The text was clamped by LINE COUNT (line-clamp-2) but the button was shown
   * by CHARACTER COUNT (content.length > 120) — two different yardsticks. A
   * caption written across a few short lines, which is common because the
   * renderer keeps the author's line breaks, is under 120 characters yet taller
   * than 2 lines. It got cut off with an ellipsis and NO way to open it, so the
   * rest of the post was unreadable.
   *
   * Now we measure the element itself: if the full text is taller than the
   * clamped box, the button appears. Character count never enters into it, so
   * the button and the clamp can no longer disagree.
   */
  useLayoutEffect(() => {
    const el = clampRef.current;
    if (!el) return;
    const measure = () => {
      // While expanded the box is unclamped, so it can never report overflow —
      // keep the button visible so the reader can collapse it again.
      if (expanded) return;
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    // Re-measure on width changes (rotation, resize, font swap) — a caption
    // that fits on desktop may overflow on a phone.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [content, maxLines, expanded]);

  // Late-loading webfonts change text height after the first paint.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (!fonts?.ready) return;
    let alive = true;
    void fonts.ready.then(() => {
      const el = clampRef.current;
      if (!alive || !el || expanded) return;
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    });
    return () => { alive = false; };
  }, [expanded]);

  if (!content) return null;

  return (
    // No padding above OR below.
    //
    // Above: the action row supplies the gap, so a post with a caption and one
    // without keep the same spacing — adding `pt` here pushes captioned posts
    // down and nothing else.
    //
    // Below: the 16px gap between one post and the next lives in ONE place,
    // PostCard's `mb-4`. It used to be `pb-2` here plus whatever the last
    // element happened to be, which is why the measured gap between posts came
    // out at 21px, 23px, 34px and once at MINUS 1px on the live feed. Owner,
    // 2026-08-10: "After removing the thin border line between two post gap
    // also maintain exactly like Instagram."
    <div className="px-3">
      <div ref={clampRef} className={expanded ? "" : CLAMP[maxLines] || CLAMP[2]}>
        {/**
         * `break-words` IS LOAD-BEARING, not tidiness.
         *
         * `whitespace-pre-wrap` keeps the author's own line breaks, but it
         * cannot break a WORD — and a caption is often not prose. Measured on
         * the real feed at 360px, in the screenshot harness: a caption of
         * "Untitled_series_seventeen_finalexport_v3_lightroom_classic…"
         * (one token, no spaces — a filename, and a pasted url behaves the
         * same) ran 178px past the card and was sliced off by the card's
         * `overflow-hidden`. No ellipsis, no "See more" — the text simply
         * stopped mid-word at the edge of the screen.
         *
         * `ScheduledPostsList` already pairs the two classes; this was the one
         * place that did not.
         */}
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ fontFamily: "var(--font-body)" }}>
          {prefix}
          <RichContentRenderer content={content} />
        </p>
      </div>
      {/* min-h-11 = 44px. Reported at 52x16 by the sweep. It sits UNDER the
          caption, not inside it, so giving it a 44px tap area moves no text —
          `-my-3` pulls the extra height back out of the flow so the gap
          between caption and engagement row is unchanged. `self-start` keeps
          the target the width of the words, not the whole card. */}
      {(overflowing || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex min-h-11 -my-3 items-center self-start text-xs text-muted-foreground hover:text-foreground mt-0.5 font-medium"
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
      <TranslateBar text={content} />
    </div>
  );
};

export default Caption;
