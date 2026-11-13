/**
 * EVERY CARD THE FEED PUTS BETWEEN POSTS, IN ONE PLACE (Owner 13 Nov 2026,
 * Trending in the app: "strong work, not patch work").
 *
 * The numbers are ZERO-BASED post indexes: a card sits directly BELOW that post.
 * The Story Card library (ads) owns its own places (feedAdPlacement.ts:
 * below posts 2, 5, 10, 15, then every 10th); the cards here must never land
 * on an ad's place — feedInserts.test.ts holds that.
 *
 *   trending  below the 4th post, ONCE per feed, wherever the computer's left
 *             column (≥ 1280 px) is not on screen: the phone, the app, tablets
 *   people    below the 10th post, app only (FeedFriendSuggestions decides)
 */
export const FEED_INSERTS = {
  trending: 3,
  people: 9,
} as const;
