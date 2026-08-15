/**
 * THE COMPOSER PREVIEW — see the post before you make it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REQUEST, 2026-08-15: an Instagram-like posting experience, because
 * *"People are loosing interest from 50mm for multiple loop whole and not like
 * experince like Instagram"*. He approved this half specifically — the preview,
 * the crop guide and the reorder strip — with the scope stated plainly:
 * **no new plugin, no new permission, nothing that touches Play Store policy.**
 * Everything here is ordinary web UI over photos the member has already chosen.
 *
 * WHAT WAS WRONG WITH THE OLD STRIP: it showed the chosen photos as small
 * squares. On a photography platform that is the one thing a composer must not
 * do — the member cannot see their own framing, cannot tell which photo will be
 * the cover, and cannot see that a 16:9 landscape will not fill the same frame
 * a portrait does. They found out after posting.
 *
 * THREE THINGS THIS ADDS, each answering one of those:
 *
 *  1. **A true preview.** The photo is shown at the SAME frame the feed will
 *     give it — `frameAspectFor`, the owner's 2026-08-01 rule, clamped between
 *     4:5 and 1.91:1 — and `object-contain`, so nothing is cropped away
 *     silently. What you see here is what gets posted.
 *
 *  2. **A rule-of-thirds guide**, which is why a photographer wants a preview
 *     at all. Two lines each way at the thirds. It is decoration over the
 *     image, never part of it: it is `pointer-events-none` and `aria-hidden`,
 *     and it is not in the upload.
 *
 *  3. **Order you can change.** The first photo is the cover and sets the frame
 *     for the whole album (`frameAspectForUrls` uses `urls[0]`), so "which one
 *     is first" is a real decision that was previously unmakeable without
 *     removing everything and starting again.
 *
 * WHY ARROWS AND NOT DRAG-AND-DROP. Dragging a thumbnail with a thumb, inside a
 * scrolling page, on a 360px screen, is the kind of interaction that works in a
 * demo and fails in a hand — the page scrolls instead, or the drop lands one
 * slot off. Two buttons cannot be got wrong, work with a screen reader, need no
 * dependency, and are testable. Instagram itself does not reorder here.
 *
 * MEASURING, NOT GUESSING. A composer preview is one photo the member is
 * looking at, so measuring its real shape on load costs one reflow of one
 * element and buys a preview that is actually true. That is the opposite trade
 * from the wall, where measurement was removed precisely because a grid of
 * loading tiles must not jump.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { memo, useState } from "react";
import { ChevronLeft, ChevronRight, Crop, ImagePlus, X } from "lucide-react";
import { FRAME_DEFAULT_ASPECT, frameAspectFor } from "@/lib/imageFrame";

/** Instagram allows 10; so does this app's existing composer. */
export const MAX_PHOTOS = 10;

export interface PostComposerPreviewProps {
  /** Object/data URLs for the chosen photos, in post order. */
  previews: string[];
  /** Which one the big preview is showing. */
  activeIndex: number;
  onActiveChange: (index: number) => void;
  /** Move the photo at `from` to `to`. Order is the post's order. */
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  /** Open the existing crop editor for this photo. */
  onCrop: (index: number) => void;
  /** Null hides the "add more" tile — used when the limit is reached. */
  onAddMore?: () => void;
}

/**
 * Where a photo ends up if it moves one step.
 *
 * Pure and exported because the ARITHMETIC is what the tests hold: an
 * off-by-one here silently reorders somebody's album, and no screenshot would
 * show it.
 */
export function moveTarget(index: number, direction: -1 | 1, count: number): number | null {
  const next = index + direction;
  if (next < 0 || next >= count) return null; // at the end: the button is disabled
  return next;
}

/** Reorder without mutating — the caller owns the array. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const Thumb = memo(function Thumb({
  src, index, active, count, onSelect, onMove, onRemove,
}: {
  src: string; index: number; active: boolean; count: number;
  onSelect: () => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const canLeft = moveTarget(index, -1, count) !== null;
  const canRight = moveTarget(index, 1, count) !== null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        aria-label={`Photo ${index + 1} of ${count}${active ? ", showing" : ""}`}
        className={`relative block h-20 w-20 overflow-hidden rounded-md border-2 transition-colors ${
          active ? "border-primary" : "border-transparent"
        }`}
      >
        {/* object-contain, not cover: a thumbnail that crops is the thing this
            component exists to stop the member being surprised by. */}
        <img src={src} alt="" decoding="async" className="h-full w-full bg-muted/40 object-contain" />
        {/* The cover photo decides the frame for the whole album, so say so. */}
        {index === 0 && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
            Cover
          </span>
        )}
      </button>

      {/* 44px tap targets: the screenshot sweep fails the run below that, and
          these sit close together where a miss is most likely. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove photo ${index + 1}`}
        className="absolute -right-1 -top-1 flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:text-destructive"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card shadow-sm">
          <X className="h-3 w-3" />
        </span>
      </button>

      <div className="mt-1 flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={!canLeft}
          aria-label={`Move photo ${index + 1} earlier`}
          className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground disabled:opacity-30 enabled:hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={!canRight}
          aria-label={`Move photo ${index + 1} later`}
          className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground disabled:opacity-30 enabled:hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

const PostComposerPreview = ({
  previews, activeIndex, onActiveChange, onMove, onRemove, onCrop, onAddMore,
}: PostComposerPreviewProps) => {
  /**
   * The real shape of the photo on screen. Measured, because a data/blob URL
   * carries no dimensions in its name — the trick the feed uses does not apply
   * to a photo that has not been uploaded yet.
   */
  const [aspect, setAspect] = useState<number>(FRAME_DEFAULT_ASPECT);
  const active = previews[activeIndex] ?? previews[0] ?? null;

  if (!active) return null;

  return (
    <div className="mt-3 space-y-3">
      <div
        className="relative w-full overflow-hidden rounded-lg bg-muted/30"
        style={{ aspectRatio: String(aspect) }}
      >
        <img
          key={active}
          src={active}
          alt=""
          decoding="async"
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w && h) setAspect(frameAspectFor(w / h));
          }}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/* THE RULE-OF-THIRDS GUIDE. Decoration only: not in the upload, not in
            the tab order, and invisible to a screen reader. */}
        <div aria-hidden className="pointer-events-none absolute inset-0" data-testid="thirds-guide">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
        </div>

        <button
          type="button"
          onClick={() => onCrop(activeIndex)}
          className="absolute bottom-2 left-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-card/90 px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm"
        >
          <Crop className="h-3.5 w-3.5" />
          Crop
        </button>

        {previews.length > 1 && (
          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {activeIndex + 1}/{previews.length}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        This is how your post will look. The first photo is the cover.
      </p>

      <div className="flex items-start gap-2 overflow-x-auto pb-1">
        {previews.map((src, i) => (
          <Thumb
            key={`${i}-${src.slice(-24)}`}
            src={src}
            index={i}
            count={previews.length}
            active={i === activeIndex}
            onSelect={() => onActiveChange(i)}
            onMove={(dir) => {
              const to = moveTarget(i, dir, previews.length);
              if (to !== null) onMove(i, to);
            }}
            onRemove={() => onRemove(i)}
          />
        ))}

        {onAddMore && previews.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={onAddMore}
            aria-label="Add more photos"
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted/30"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export default PostComposerPreview;
