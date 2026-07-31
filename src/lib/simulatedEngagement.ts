/**
 * REAL engagement helpers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REMOVED 2026-07-31 (owner decision): `getSimulatedStats()` used to invent view
 * and "reach" numbers from a hash of the item id — a 2,000–100,000 range with a
 * growth curve and daily jitter, shown as if real. On a platform with 74 members
 * a photo displaying "12.4K views" is disprovable by arithmetic, and one member
 * doing that maths would discredit every other number in the product.
 *
 * RULE FROM NOW ON: show a number only when a real source exists for it.
 *   • posts               -> feed_events, via the get_post_view_counts() RPC
 *   • competition entries -> competition_entries.view_count
 *   • gallery photos      -> portfolio_images.view_count
 *   • profiles            -> profile_views table
 *   • stories             -> story_views table
 *   • "reach"             -> NO real source anywhere. Do not display it.
 *   • "trending" / "top post" badges -> were pure seed output. Removed.
 *
 * Do not reintroduce synthetic engagement. If a surface has no real source,
 * show nothing there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Compact display form for a real count: 1234 -> "1.2K". */
export const formatCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
};

/**
 * Reading time from an actual word count. This is a genuine estimate derived
 * from real content (~200 words per minute), not invented data, so it stays.
 * Returns undefined when there is no word count to work from.
 */
export const estimateReadTimeMin = (wordCount?: number): number | undefined => {
  if (!wordCount || wordCount <= 0) return undefined;
  return Math.max(1, Math.round(wordCount / 200));
};
