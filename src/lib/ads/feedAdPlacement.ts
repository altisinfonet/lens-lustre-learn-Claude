/**
 * Feed ad placement — which picture appears where in the feed.
 *
 * OWNER SPEC (2026-08-01): every picture in the Story Card library owns a fixed
 * place in the feed. Picture #1 always appears after 2 posts, #2 after 5, #3
 * after 10, #4 after 15, and from there one every 10 posts — 25, 35, 45 …
 * A member never sees picture #2 where picture #1 should be.
 *
 * Positions are 0-indexed POST indices, and the ad renders AFTER the post at
 * that index. Post index 1 is the 2nd post, so slot #1 → index 1.
 *
 *   slot 0 (#1) → index 1  → after post 2
 *   slot 1 (#2) → index 4  → after post 5
 *   slot 2 (#3) → index 9  → after post 10
 *   slot 3 (#4) → index 14 → after post 15
 *   slot 4 (#5) → index 24 → after post 25
 *   slot 5 (#6) → index 34 → after post 35   … +10 for each further picture
 *
 * There is no upper limit: 50 pictures simply means 50 places, the last of them
 * deep in an endlessly scrolling feed. Nothing repeats and nothing rotates —
 * position is decided purely by where a picture sits in the library.
 */

/** First four places are hand-set; everything after is one per 10 posts. */
const HEAD_POSITIONS = [1, 4, 9, 14] as const;
const TAIL_STEP = 10;

/** The 0-indexed post position that ad slot `slotIndex` sits after. */
export const feedAdPostIndex = (slotIndex: number): number => {
  if (slotIndex < 0) return HEAD_POSITIONS[0];
  if (slotIndex < HEAD_POSITIONS.length) return HEAD_POSITIONS[slotIndex];
  return HEAD_POSITIONS[HEAD_POSITIONS.length - 1] + (slotIndex - (HEAD_POSITIONS.length - 1)) * TAIL_STEP;
};

/** Human post number for a slot: 2, 5, 10, 15, 25, 35 … (1-indexed). */
export const feedAdPostNumber = (slotIndex: number): number => feedAdPostIndex(slotIndex) + 1;

/**
 * Label shown beside each picture in the admin library, in the owner's wording.
 * → "#1 (after 2 feed posts)"
 */
export const feedAdSlotLabel = (slotIndex: number): string =>
  `#${slotIndex + 1} (after ${feedAdPostNumber(slotIndex)} feed posts)`;

/**
 * Which ad slot, if any, belongs immediately after the post at `postIndex`.
 * The exact inverse of feedAdPostIndex, so the two can never disagree.
 * Returns null for the overwhelming majority of posts, which have no ad.
 */
export const slotForPostIndex = (postIndex: number): number | null => {
  const headSlot = HEAD_POSITIONS.indexOf(postIndex as (typeof HEAD_POSITIONS)[number]);
  if (headSlot !== -1) return headSlot;

  const last = HEAD_POSITIONS[HEAD_POSITIONS.length - 1];
  if (postIndex <= last) return null;
  const delta = postIndex - last;
  if (delta % TAIL_STEP !== 0) return null;
  return HEAD_POSITIONS.length - 1 + delta / TAIL_STEP;
};

/** One-line summary for the admin panel, generated so it cannot go stale. */
export const feedAdPositionsLabel = (): string =>
  `after post ${HEAD_POSITIONS.map((i) => i + 1).join(", ")}, then one every ${TAIL_STEP} posts`;

/**
 * Should the ad for `postIndex` render, given how many posts are loaded?
 *
 * The only rule: there must be at least one real post AFTER the ad, so the feed
 * never appears to end on an advert. With infinite scroll `loadedPosts` grows,
 * so deeper slots light up on their own as the member keeps scrolling.
 */
export const shouldShowFeedAd = (postIndex: number, loadedPosts: number): boolean =>
  loadedPosts > postIndex + 1;
