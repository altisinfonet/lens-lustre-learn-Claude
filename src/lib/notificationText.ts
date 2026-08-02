/**
 * The shape of a grouped notification row, and which section it belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE USED TO PHRASE NOTIFICATIONS TOO. IT NO LONGER DOES.
 *
 * It once exported `actorPhrase`, `actionPhrase`, `notificationSentence`,
 * `actorLabel` and its own `relativeAge`. Those were superseded on 2026-08-01
 * by `src/lib/notifications/describe.ts`, which every surface now uses — the
 * bell, the history page, and (through the SQL copy pinned by
 * pushCatalogParity.test.ts) the push body.
 *
 * They were deleted on 2026-08-02 rather than left lying around, because they
 * still said the two things that were removed from the product on purpose:
 * **"Someone"** and **"just shared a post."** Dead code that renders banned
 * wording is not dead — it is waiting for the next person who imports it.
 *
 * `hasInlineAction()` went with them. The rule it held — that a follower or a
 * friend request must never be collapsed into a group, because each carries a
 * button — now lives in the database, in `notif_group_key()`, which is where
 * the grouping actually happens.
 *
 * WHAT IS LEFT IS NOT PHRASING: the row type, and the bucket a row falls into
 * on the history screen.
 * ─────────────────────────────────────────────────────────────────────────────
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
