/**
 * N7 · the tabs on /notifications (centre rows only, behind notif_centre_ui).
 * All shows everything. The named tabs follow the notification centre's type
 * registry (20261104_0110): Comments & mentions = the comment/reply/tag types
 * of likes_comments; Follows = follows_friends; Competitions = competitions.
 * new_competition is an announcement in the registry, so it shows under All.
 * src/lib/notifications/__tests__/tabs.test.ts checks every entry against the
 * registry's group_key. A type not listed here (including any future type)
 * shows under All only, so nothing can disappear.
 */
export const NOTIFICATION_TABS = ["all", "comments", "follows", "competitions"] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];

const TAB_OF: Record<string, Exclude<NotificationTab, "all">> = {
  post_comment: "comments",
  image_comment: "comments",
  comment_reply: "comments",
  tagged_post_comment: "comments",
  ad_comment_reply: "comments",
  post_tag: "comments",

  new_follower: "follows",
  friend_request: "follows",
  friend_accepted: "follows",

  competition_vote: "competitions",
  entry_approved: "competitions",
  entry_rejected: "competitions",
  entry_shortlisted: "competitions",
  entry_qualified: "competitions",
  entry_qualified_round: "competitions",
  entry_finalist: "competitions",
  entry_award: "competitions",
  competition_winner: "competitions",
  round_published: "competitions",
  round_results_published: "competitions",
  needs_review: "competitions",
  badge_awarded: "competitions",
  certificate_issued: "competitions",
  potd_featured: "competitions",
  featured_artist: "competitions",
};

/** The named tab a type belongs to, or null when it shows under All only. */
export function notificationTab(type: string): Exclude<NotificationTab, "all"> | null {
  return Object.prototype.hasOwnProperty.call(TAB_OF, type) ? TAB_OF[type] : null;
}

export function inTab(type: string, tab: NotificationTab): boolean {
  return tab === "all" || notificationTab(type) === tab;
}

export const TAB_LABEL: Record<NotificationTab, { key: string; fallback: string }> = {
  all: { key: "notifications.tab.all", fallback: "All" },
  comments: { key: "notifications.tab.comments", fallback: "Comments & mentions" },
  follows: { key: "notifications.tab.follows", fallback: "Follows" },
  competitions: { key: "notifications.tab.competitions", fallback: "Competitions" },
};
