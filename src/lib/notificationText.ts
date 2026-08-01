/**
 * Turns a grouped notification row into the sentence the user reads.
 *
 * Kept out of the page component on purpose: this is pure, testable logic, and
 * the phrasing has to stay identical between the notifications page and any
 * future surface (bell, push tap, app). The grouping itself happens in the
 * database — see get_my_notifications_grouped() — so this file only formats
 * what it is handed.
 *
 * NOTHING here invents a number. Counts come straight from the RPC.
 */

export interface NotificationGroup {
  group_key: string;
  type: string;
  notification_ids: string[];
  actor_ids: string[];
  actor_names: string[];
  actor_usernames: string[];
  actor_avatars: string[];
  actor_count: number;
  event_count: number;
  unread_count: number;
  reference_id: string | null;
  thumbnail_url: string | null;
  title: string;
  message: string;
  latest_at: string;
}

/** Display handle for an actor: @username if they have one, else their name. */
export function actorLabel(group: NotificationGroup, index: number): string {
  const username = group.actor_usernames?.[index]?.trim();
  if (username) return username;
  const name = group.actor_names?.[index]?.trim();
  return name || "Someone";
}

/**
 * "aninditahidayat", "aninditahidayat and vickyroy87",
 * "aninditahidayat, vickyroy87 and 31 others".
 *
 * The RPC returns at most 3 actors but always the true actor_count, so the
 * "and N others" number is real even though we only have three names.
 */
export function actorPhrase(group: NotificationGroup): string {
  const shown = Math.min(group.actor_ids?.length ?? 0, 2);
  if (shown === 0) return "Someone";

  const names = Array.from({ length: shown }, (_, i) => actorLabel(group, i));
  const remaining = Math.max(0, (group.actor_count ?? shown) - shown);

  if (remaining === 0) {
    return names.length === 1 ? names[0] : `${names[0]} and ${names[1]}`;
  }
  if (remaining === 1 && shown >= 2) {
    return `${names[0]}, ${names[1]} and 1 other`;
  }
  return shown === 1
    ? `${names[0]} and ${remaining} ${remaining === 1 ? "other" : "others"}`
    : `${names[0]}, ${names[1]} and ${remaining} others`;
}

/** The verb half of the sentence. Plural forms use the REAL event count. */
export function actionPhrase(group: NotificationGroup): string {
  const n = group.event_count ?? 1;
  const many = n > 1;

  switch (group.type) {
    case "new_post_from_following":
      return many ? `shared ${n} photos.` : "just shared a post.";
    case "post_reaction":
    case "image_reaction":
      return many ? `reacted to your photos ${n} times.` : "reacted to your photo.";
    case "post_comment":
    case "image_comment":
      return many ? `left ${n} comments on your photos.` : "commented on your photo.";
    case "comment_reply":
      return many ? `replied to you ${n} times.` : "replied to your comment.";
    case "new_follower":
      return "started following you.";
    case "friend_request":
      return "sent you a friend request.";
    case "friend_accepted":
      return "accepted your friend request.";
    case "post_tag":
      return "tagged you in a photo.";
    default:
      // Types with their own server-written wording (competition results,
      // wallet, tickets, certificates) keep that wording verbatim rather than
      // being paraphrased here.
      return "";
  }
}

/**
 * Full sentence. Falls back to the notification's own stored message for any
 * type this file does not phrase itself, so a new type can never render blank.
 */
export function notificationSentence(group: NotificationGroup): string {
  const action = actionPhrase(group);
  if (!action) return group.message || group.title || "";
  return `${actorPhrase(group)} ${action}`;
}

/** Types that carry an inline action and so must never be collapsed away. */
export function hasInlineAction(group: NotificationGroup): boolean {
  return group.type === "new_follower" || group.type === "friend_request";
}

/**
 * Instagram-style compact age: 1m / 5h / 6d / 1w / 3mo / 2y.
 * `now` is injectable so tests are not clock-dependent.
 */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.floor((now.getTime() - then) / 1000));

  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

export type BucketKey = "new" | "last30" | "earlier";

/**
 * Which section a group belongs to.
 *
 * The screenshot's top section is Instagram's "Highlights", which is an
 * algorithmically curated bucket. We do not have — and should not pretend to
 * have — that curation, so the top section is simply everything still unread.
 * That is honest and, on this platform, more useful.
 */
export function bucketFor(group: NotificationGroup, now: Date = new Date()): BucketKey {
  if ((group.unread_count ?? 0) > 0) return "new";
  const ageDays = (now.getTime() - new Date(group.latest_at).getTime()) / 86_400_000;
  return ageDays <= 30 ? "last30" : "earlier";
}

export const BUCKET_LABEL: Record<BucketKey, string> = {
  new: "New",
  last30: "Last 30 days",
  earlier: "Earlier",
};
