/**
 * THE VIDEO FRAME — every video post is shown in a 9:16 card.
 *
 * Owner, 2026-10-05 (in the D2 session, ~12:55 UTC): "all videos must be 9:16
 * size … if anyone posts any other size that video must be fit in our card —
 * same process as Instagram." This supersedes, FOR VIDEO, R-100/R-104's "same
 * frame rule as photos (imageFrame.ts, 4:5 … 1.91:1)". Photos are unchanged.
 *
 * The rule: the card is always 9:16 (portrait, phone-shaped). A 9:16 video
 * fills it edge to edge. Any other shape is FITTED, never cropped: shown whole
 * (`object-contain`), centred, and the empty space is filled with a blurred,
 * enlarged copy of the same video — so a 16:9 clip sits in the middle with soft
 * colour above and below it instead of black bars. Nothing the member filmed
 * is cut off.
 */
export const VIDEO_FRAME_ASPECT = 9 / 16;

/** How close to 9:16 a video must be to fill the card with no bars (rounding in phone encoders). */
export const VIDEO_FILL_TOLERANCE = 0.01;

/** The card's aspect (width / height). Always 9:16, whatever the video. */
export function videoFrameAspect(): number {
  return VIDEO_FRAME_ASPECT;
}

/** True when the video is not 9:16, so the blurred fill shows above/below or at the sides. */
export function videoNeedsFill(videoAspect: number | null | undefined): boolean {
  if (typeof videoAspect !== "number" || !Number.isFinite(videoAspect) || videoAspect <= 0) return false;
  return Math.abs(videoAspect - VIDEO_FRAME_ASPECT) > VIDEO_FILL_TOLERANCE;
}

/** Where the fill goes: "top-bottom" for anything wider than 9:16, "sides" for anything narrower. */
export function videoFillAxis(videoAspect: number | null | undefined): "none" | "top-bottom" | "sides" {
  if (!videoNeedsFill(videoAspect)) return "none";
  return (videoAspect as number) > VIDEO_FRAME_ASPECT ? "top-bottom" : "sides";
}
