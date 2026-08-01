/**
 * Feed ad placement — where Story Card ads sit in the feed.
 *
 * OWNER SPEC (2026-08-01): "1st ad come after 2nd feed, 2nd ad will after 5
 * feed, 3rd will come 10 feed, 4th will come after 15 feed."
 *
 * Positions are 0-indexed post positions, and an ad renders AFTER the post at
 * that index — so index 1 means "after the 2nd post".
 *
 *   index 1  → after post 2
 *   index 4  → after post 5
 *   index 9  → after post 10
 *   index 14 → after post 15
 *
 * WHY THE OLD MINIMUM-POST-COUNT GATE IS GONE
 *   The previous rule demanded 4 loaded posts before the 1st ad, 14 before the
 *   2nd and 34 before the 3rd. The feed loads roughly 10 posts per page, so the
 *   2nd ad effectively never appeared — the owner reported seeing exactly one
 *   card, and this was the cause. It is replaced by the single honest condition
 *   in shouldShowFeedAd() below.
 */

/** Post positions (0-indexed) after which a Story Card ad is placed. */
export const FEED_AD_POSITIONS: readonly number[] = [1, 4, 9, 14];

/**
 * Human sentence for the admin panel, built FROM the array above so the help
 * text can never drift away from what the code actually does.
 * → "after post 2, 5, 10 and 15"
 */
export const feedAdPositionsLabel = (): string => {
  const posts = FEED_AD_POSITIONS.map((i) => i + 1);
  if (posts.length === 0) return "nowhere — no positions configured";
  if (posts.length === 1) return `after post ${posts[0]}`;
  return `after post ${posts.slice(0, -1).join(", ")} and ${posts[posts.length - 1]}`;
};

/**
 * Should the ad at `positionIndex` render, given how many posts are loaded?
 *
 * The only rule left: there must be at least one real post AFTER the ad, so an
 * ad is never the last thing in the feed (which reads as "the feed ended on an
 * advert"). With infinite scroll `loadedPosts` grows, so later slots light up
 * on their own as the member keeps scrolling.
 */
export const shouldShowFeedAd = (positionIndex: number, loadedPosts: number): boolean =>
  loadedPosts > positionIndex + 1;
