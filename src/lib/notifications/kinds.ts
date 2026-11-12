/**
 * N7b · per-type facts the notification row needs, mirrored from the
 * notification centre's type registry (20261104_0110 public.notification_types).
 * src/lib/notifications/__tests__/kinds.test.ts reads the registry and fails
 * if any entry here disagrees with it.
 *
 *   badgeFor()       — the small badge on the avatar (♥ like, comment, + follow,
 *                      ★ competition, @ mention). Unknown/other types: none.
 *   bellSettingFor() — the notification_preferences column "Turn off this kind"
 *                      writes: the registry's pref_in_app, and only where the
 *                      registry lets a member turn the type off. The centre's
 *                      writer reads that column (0110, ch_inapp), so turning it
 *                      off really stops new rows of that kind reaching the bell.
 */
export type NotificationBadge = "like" | "comment" | "follow" | "competition" | "mention";
export type BellSetting = "inapp_reactions" | "inapp_comments" | "inapp_social" | "inapp_competitions" | "inapp_mentions_everyone";

const BADGE: Record<string, NotificationBadge> = {
  post_reaction: "like",
  image_reaction: "like",
  tagged_post_reaction: "like",
  post_comment: "comment",
  image_comment: "comment",
  comment_reply: "comment",
  tagged_post_comment: "comment",
  ad_comment_reply: "comment",
  story_comment: "comment",
  post_tag: "mention",
  mention_all: "mention",
  mention_followers: "mention",
  new_follower: "follow",
  friend_request: "follow",
  friend_accepted: "follow",
  competition_vote: "competition",
  entry_approved: "competition",
  entry_rejected: "competition",
  entry_shortlisted: "competition",
  entry_qualified: "competition",
  entry_qualified_round: "competition",
  entry_finalist: "competition",
  entry_award: "competition",
  competition_winner: "competition",
  round_published: "competition",
  round_results_published: "competition",
  needs_review: "competition",
  badge_awarded: "competition",
  certificate_issued: "competition",
  potd_featured: "competition",
  featured_artist: "competition",
};

const BELL_SETTING: Record<string, BellSetting> = {
  post_reaction: "inapp_reactions",
  image_reaction: "inapp_reactions",
  tagged_post_reaction: "inapp_reactions",
  post_comment: "inapp_comments",
  image_comment: "inapp_comments",
  comment_reply: "inapp_comments",
  tagged_post_comment: "inapp_comments",
  ad_comment_reply: "inapp_comments",
  story_comment: "inapp_comments",
  post_tag: "inapp_social",
  mention_all: "inapp_mentions_everyone",
  mention_followers: "inapp_mentions_everyone",
  new_post_from_following: "inapp_social",
  new_follower: "inapp_social",
  friend_request: "inapp_social",
  friend_accepted: "inapp_social",
  competition_vote: "inapp_competitions",
  new_competition: "inapp_competitions",
};

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function badgeFor(type: string): NotificationBadge | null {
  return own(BADGE, type) ? BADGE[type] : null;
}

export function bellSettingFor(type: string): BellSetting | null {
  return own(BELL_SETTING, type) ? BELL_SETTING[type] : null;
}

/**
 * What a bell setting covers, said plainly — one column can cover several
 * kinds (inapp_social is follows, friends, tags and new posts), and the member
 * must know everything they are switching off. Same words as the settings table.
 */
export const BELL_SETTING_COVERS: Record<BellSetting, { key: string; fallback: string }> = {
  inapp_reactions: { key: "notifications.turn_off.reactions", fallback: "Likes on your photos" },
  inapp_comments: { key: "notifications.turn_off.comments", fallback: "Comments and replies" },
  inapp_social: { key: "notifications.turn_off.social", fallback: "Follows, friends, tags and new posts" },
  inapp_competitions: { key: "notifications.turn_off.competitions", fallback: "Competition votes and new competitions" },
  inapp_mentions_everyone: { key: "notifications.turn_off.mentions_everyone", fallback: "Mentions to everyone (@all, @followers)" },
};
