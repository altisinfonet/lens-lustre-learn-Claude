/**
 * THE ACTION ROW'S GEOMETRY — one place, read by PostActionRow, ReactionPicker,
 * ReactionSummaryTooltip and ShareSummaryTooltip (the four pieces of the one
 * row the feed card and the ad card both draw; web and app alike).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIDE TO SIDE — Owner report 4 Nov 2026, live row beside Instagram: "auto
 * fitting space based on the count". The row used fixed 44 px tap boxes
 * (px-2.5 around every icon and count, + pr-2 after a count), so the eye saw
 * 21 px from the Like icon to its count, 28 px from a count to the next icon
 * and 19 px from the Comment icon to the Share icon. Instagram (measured on the
 * Owner's screenshots, ink): icon → count ~5.6, count → next icon ~14–15,
 * icon → icon with no count ~18.
 *
 * So every box is CONTENT-SIZED and the visible gaps are the boxes' own
 * padding: a tap box now ends where the next one begins, with no visible space
 * added and no two boxes overlapping. Who owns a gap:
 *   icon → its count (~5)      the count (the icon keeps its own edge)
 *   count → next icon (~16)    the count (a count is narrow; an icon is 24)
 *   icon → icon, no count (~18) split evenly
 *   after the last control      free card: the last box reaches into it
 * Logical ps / pe, so a right-to-left page mirrors the row.
 *
 * UP AND DOWN (approved 3 Nov, #867 — NOT changed here): every control is a
 * 44 px tall box (`h-11`) that reaches 12 px UP into the photo / camera line
 * (`-mt-3`, `pt-3` keeps the icon on the row's 32 px centre) and never down
 * into the caption. Layers decide the rest (caption > camera line > row >
 * photo; tools/uishot/card-hits.mjs).
 *
 * THE FLOOR (tools/uishot/capture.mjs): long >= 44 and short >= 32, measured on
 * the box itself. Every control is 44 tall and >= 32 wide — a count's box is
 * `min-w-8` with its number at the START, so a one-digit count's spare width
 * becomes part of the step to the next icon (that step is ~21 px instead of
 * ~16 after a ONE-digit like count; nothing else changes).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * THE SPACE BETWEEN THE PHOTO AND THE ROW (Owner, 5 Nov 2026, Instagram
 * screenshot beside ours: "match the space like insta in Ad and feed posts").
 * Measured on his screenshots (390 px phone): Instagram's icons sit ~22 px
 * below the photo (centre), ours ~12 px. This top margin adds the missing
 * 10 px to the ONE row both the feed card and the ad card draw — web and app.
 * A MARGIN, not padding: the row box itself starts where it did relative to its
 * controls, so they still reach 12 px up (ROW_TAP) into this space and
 * tools/uishot/card-hits.mjs measures the same layers. THE ONE VALUE.
 */
export const ROW_TOP_GAP = "mt-2.5";

/** Every control in the row: 44 px tall to a finger, 32 px of layout, reaching up only. */
export const ROW_TAP = "relative h-11 -mt-3 pt-3 touch-manipulation select-none";

/** A count that is its own control (like count, share count): >= 32 wide, number at the start. */
export const ROW_COUNT_TAP = `${ROW_TAP} inline-flex items-center justify-start min-w-8 cursor-pointer`;
