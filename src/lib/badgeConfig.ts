// Badge configuration for admin-assignable user badges
// Each badge has a unique type, display label, icon name, and color scheme

export const BADGE_TYPES = [
  "top_rated",
  "verified",
  "most_popular",
  "most_trusted",
  "rising_star",
] as const;

export type BadgeType = (typeof BADGE_TYPES)[number];

export interface BadgeConfig {
  type: BadgeType;
  label: string;
  /** Tailwind classes for the ribbon */
  ribbonClass: string;
  /** Tailwind classes for compact badge */
  badgeClass: string;
  /** Emoji/icon shorthand */
  icon: string;
}

export const BADGES: Record<BadgeType, BadgeConfig> = {
  top_rated: {
    type: "top_rated",
    label: "Top Rated",
    ribbonClass: "bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-amber-500/30",
    badgeClass: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    icon: "⭐",
  },
  verified: {
    type: "verified",
    label: "Verified",
    ribbonClass: "bg-gradient-to-r from-blue-500 to-cyan-400 text-white shadow-blue-500/30",
    badgeClass: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    icon: "✓",
  },
  most_popular: {
    type: "most_popular",
    label: "Most Popular",
    ribbonClass: "bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-pink-500/30",
    badgeClass: "bg-pink-500/15 text-pink-600 border-pink-500/30",
    icon: "🔥",
  },
  most_trusted: {
    type: "most_trusted",
    label: "Most Trusted",
    ribbonClass: "bg-gradient-to-r from-emerald-500 to-green-400 text-white shadow-emerald-500/30",
    badgeClass: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    icon: "🛡",
  },
  rising_star: {
    type: "rising_star",
    label: "Rising Star",
    ribbonClass: "bg-gradient-to-r from-violet-500 to-purple-400 text-white shadow-violet-500/30",
    badgeClass: "bg-violet-500/15 text-violet-600 border-violet-500/30",
    icon: "🚀",
  },
};
