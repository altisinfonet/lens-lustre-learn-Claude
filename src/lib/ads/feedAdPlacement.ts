/**
 * Feed ad placement thresholds — how many posts must exist before the Nth
 * in-feed ad (story card) is allowed to appear. Relocated from the retired
 * legacy AdPlacement component so the feed keeps its progressive spacing.
 *
 * Pattern (0-indexed position): 4, 14, 34, 54, 74 … — base 4, then 14, then
 * +20 each step.
 */
export const getMinPostCount = (positionIndex: number): number => {
  if (positionIndex <= 0) return 4;
  if (positionIndex === 1) return 14;
  return 14 + (positionIndex - 1) * 20; // 34, 54, 74 …
};
