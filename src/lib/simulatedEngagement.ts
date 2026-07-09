/**
 * Generates deterministic simulated engagement stats based on item ID and age.
 * Views appear after 24h and grow over 30 days (range: 2K–100K).
 * Reach is ~30-60% of views. Trending if <48h old with high "activity".
 * Top post badge if in upper tier. Read time for articles.
 */

/** Simple hash from string to number 0-1 */
const hashSeed = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 10000) / 10000;
};

export interface SimulatedStats {
  views: number;
  viewsLabel: string;
  reach: number;
  reachLabel: string;
  isTrending: boolean;
  isTopPost: boolean;
  readTimeMin?: number; // only for articles
  show: boolean; // false if < 24h old
}

const formatCount = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
};

export const getSimulatedStats = (
  id: string,
  createdAt: string,
  wordCount?: number
): SimulatedStats => {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHours = ageMs / 3600000;
  const ageDays = ageHours / 24;

  // Don't show if less than 24 hours old
  if (ageDays < 1) {
    return { views: 0, viewsLabel: "0", reach: 0, reachLabel: "0", isTrending: false, isTopPost: false, show: false };
  }

  const seed = hashSeed(id);
  const seed2 = hashSeed(id + "reach");
  const seed3 = hashSeed(id + "trend");

  // Growth curve: starts at ~2K at day 1, grows to 2K-100K by day 30
  // Use logarithmic growth capped at 30 days
  const cappedDays = Math.min(ageDays, 30);
  const growthFactor = Math.log(cappedDays + 1) / Math.log(31); // 0 to 1 over 30 days

  // Base range 2000–100000, seeded per item
  const minViews = 2000;
  const maxViews = 100000;
  const targetViews = minViews + seed * (maxViews - minViews);

  // Start at ~10-20% of target on day 1, reach full by day 30
  const startFraction = 0.1 + seed2 * 0.1;
  const currentViews = Math.round(
    targetViews * (startFraction + (1 - startFraction) * growthFactor)
  );

  // Add daily jitter so it doesn't feel static
  const dayIndex = Math.floor(ageDays);
  const jitter = hashSeed(id + String(dayIndex));
  const jitteredViews = Math.round(currentViews * (0.95 + jitter * 0.1));

  // Reach is always higher than views (130-180% of views)
  const reachRatio = 1.3 + seed2 * 0.5;
  const reach = Math.round(jitteredViews * reachRatio);

  // Trending: items 1-2 days old with high seed
  const isTrending = ageDays >= 1 && ageDays <= 3 && seed3 > 0.4;

  // Top post: top ~25% by seed value AND at least 3 days old
  const isTopPost = seed > 0.75 && ageDays >= 3;

  // Read time (for articles with word count)
  const readTimeMin = wordCount ? Math.max(1, Math.round(wordCount / 200)) : undefined;

  return {
    views: jitteredViews,
    viewsLabel: formatCount(jitteredViews),
    reach,
    reachLabel: formatCount(reach),
    isTrending,
    isTopPost,
    readTimeMin,
    show: true,
  };
};
