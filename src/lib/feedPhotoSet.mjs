/**
 * THE FEED PHOTO SET's name rule — ONE predicate for the browser, the Pages
 * routes and the Node workers (Owner order, 4 Nov 2026). Plain ES module (no
 * TypeScript) so tools/media-derivatives/*.mjs import it as is, like
 * creditGeometry.mjs; types in feedPhotoSet.d.mts. src/lib/imageLadder.ts
 * re-exports both names (its FEED PHOTO SET note has the whole set).
 *
 * A `-l6` photo stores three CLEAN WebP files and its credit is NEVER stored:
 * every worker or route that could write a credited or derived file for a post
 * photo refuses a key / URL for which isFeedPhotoSet is true.
 */
export const FEED_PHOTO_MARKER = "-l6";

/** True for a feed set photo or any of its copies (`-l6`, `-l6-r1080`, `-l6-thumb`, …), as a key or a URL. */
export function isFeedPhotoSet(urlOrKey) {
  if (typeof urlOrKey !== "string") return false;
  return /-l6(?:-thumb|-r\d{3,4}c?)?\.[a-z0-9]+$/i.test(urlOrKey.replace(/[?#].*$/, ""));
}
