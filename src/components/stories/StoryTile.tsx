import type { ReactNode } from "react";
import OptimizedImage from "@/components/OptimizedImage";

/**
 * STORIES v2.3 — the ONE story / highlight tile (Owner, 7 Nov 2026: "no circle
 * anywhere more"). The feed row, the profile's stories and highlights all draw
 * this, so they cannot drift apart. Profile pictures are NOT tiles — they stay
 * round (Owner, 7 Nov: "Profile Picture dont touch").
 *
 * Sizes are the approved feed tile (approved-2026-11-06/new-1-feed-phone.png):
 * 88 px square, 18 px corners, a 3 px ring. Change them only with a new yes.
 */

/** Unseen story: the brand blue into gold (Owner 7 Nov). Seen / highlight: grey. */
export const RING_UNSEEN = "bg-gradient-to-tr from-primary to-amber-400";
export const RING_SEEN = "bg-muted-foreground/25";

/** The name / title under a tile. */
export const STORY_TILE_LABEL = "text-[10px] tracking-[0.05em] text-muted-foreground truncate max-w-[80px]";

interface StoryTileProps {
  /** unseen = blue→gold, seen = grey, none = no ring (an empty "+" tile) */
  ring: "unseen" | "seen" | "none";
  /** the photo inside, already sized */
  cover?: string | null;
  alt?: string;
  /** an empty "+" tile: dashed inner edge */
  dashed?: boolean;
  /** drawn in the middle when there is no photo (a "+", a spinner) */
  center?: ReactNode;
  /** drawn over the tile's edge (a small face, a "+", a badge) */
  corner?: ReactNode;
}

export function StoryTile({ ring, cover, alt = "", dashed = false, center, corner }: StoryTileProps) {
  const ringClass = ring === "unseen" ? RING_UNSEEN : ring === "seen" ? RING_SEEN : "bg-transparent";
  return (
    <div className={`relative h-[88px] w-[88px] rounded-[18px] p-[3px] ${ringClass}`}>
      <div className={`w-full h-full rounded-[15px] overflow-hidden border-2 border-background bg-muted flex items-center justify-center ${dashed ? "border-dashed border-primary/40 group-hover:border-primary" : ""}`}>
        {cover ? <OptimizedImage src={cover} alt={alt} className="w-full h-full object-cover" /> : center}
      </div>
      {corner}
    </div>
  );
}
