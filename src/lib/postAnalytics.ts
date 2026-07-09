/**
 * Post analytics utilities — shared across Feed & Wall.
 */

/** Format numbers: 1200 → 1.2K, 1200000 → 1.2M */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    const val = num / 1_000_000;
    return val % 1 === 0 ? `${val}M` : `${val.toFixed(1)}M`;
  }
  if (num >= 1_000) {
    const val = num / 1_000;
    return val % 1 === 0 ? `${val}K` : `${val.toFixed(1)}K`;
  }
  return String(num);
}

export interface PostMetrics {
  views: number;
  reach: number;
  engagement: number;
  engagementRate: number;
  ageHours: number;
  velocity: number;
}

/** Calculate derived metrics from a post */
export function getMetrics(post: {
  like_count: number;
  comment_count: number;
  share_count: number;
  created_at: string;
  views?: number;
  reach?: number;
}): PostMetrics {
  const views = post.views ?? 0;
  const reach = post.reach ?? views;
  const engagement = post.like_count + post.comment_count + post.share_count;
  const engagementRate = views > 0 ? engagement / views : 0;
  const ageHours = Math.max(
    (Date.now() - new Date(post.created_at).getTime()) / 3_600_000,
    0.1,
  );
  const velocity = views / ageHours;

  return { views, reach, engagement, engagementRate, ageHours, velocity };
}

export type PostBadgeType = "trending" | "top" | "rising";

/** Return at most ONE badge type based on velocity & engagement */
export function getPostBadge(metrics: PostMetrics): PostBadgeType | null {
  if (metrics.velocity > 800 && metrics.ageHours < 24) return "trending";
  if (metrics.engagementRate > 0.12 && metrics.views > 10_000) return "top";
  if (metrics.velocity > 300 && metrics.ageHours < 6) return "rising";
  return null;
}

/** Return a human-readable insight string or null */
export function getPostInsight(metrics: PostMetrics): string | null {
  if (metrics.engagementRate > 0.15) return "High engagement performance";
  if (metrics.velocity > 1000) return "Rapid traction";
  if (metrics.ageHours < 2 && metrics.velocity > 500) return "Strong early growth";
  return null;
}
