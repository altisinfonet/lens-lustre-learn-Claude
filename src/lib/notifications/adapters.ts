/**
 * The two shapes a notification arrives in, normalised into one.
 *
 * The bell reads single unread rows from `user_notifications`. The page reads
 * grouped rows from `get_my_notifications_grouped()`. They are genuinely
 * different queries answering different questions — unread inbox vs history —
 * and that difference is deliberate.
 *
 * What is NOT allowed is for that difference to reach the words on screen.
 * Both go through `describeNotification`, and these two functions are the only
 * places that know which query a row came from.
 */
import type { NotificationSubject, NotificationActor } from "@/lib/notifications/describe";

/** A grouped row from get_my_notifications_grouped(). */
export interface GroupedRow {
  type: string;
  actor_ids?: string[] | null;
  actor_names?: string[] | null;
  actor_usernames?: string[] | null;
  /**
   * Positionally aligned with actor_ids. FALSE = that profile is gone.
   *
   * Only `get_my_unread_notifications_grouped()` (the bell) returns this. The
   * history RPC does not, so it arrives as undefined there and the wording is
   * unchanged — which is deliberate: undefined means "we did not look", and
   * that is a different sentence from "we looked and they are gone".
   */
  actor_known?: (boolean | null)[] | null;
  actor_count?: number | null;
  event_count?: number | null;
  message?: string | null;
  title?: string | null;
  latest_at: string;
}

/** A single unread row from user_notifications, as the bell hydrates it. */
export interface SingleRow {
  type: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_username?: string | null;
  /** false = we looked and the profile is gone. undefined = we did not look. */
  actor_known?: boolean;
  actor_is_admin?: boolean;
  message?: string | null;
  title?: string | null;
  created_at: string;
}

export function subjectFromGroup(row: GroupedRow, adminIds?: Set<string>): NotificationSubject {
  const ids = row.actor_ids ?? [];
  const actors: NotificationActor[] = ids.map((id, i) => ({
    id,
    // The RPC coalesces missing names to an EMPTY STRING, which is
    // indistinguishable from "unknown" once it crosses into TypeScript. Treat
    // empty as absent here, at the one boundary that knows that, rather than
    // letting `""` travel any further.
    fullName: row.actor_names?.[i]?.trim() || null,
    username: row.actor_usernames?.[i]?.trim() || null,
    // `?? undefined` on purpose. A null here means the row came from a query
    // that does not answer the question; only a real `false` means deleted.
    known: row.actor_known?.[i] ?? undefined,
    isAdmin: adminIds ? adminIds.has(id) : false,
  }));

  return {
    type: row.type,
    actors,
    actorCount: row.actor_count ?? actors.length,
    eventCount: row.event_count ?? 1,
    message: row.message,
    title: row.title,
    createdAt: row.latest_at,
  };
}

export function subjectFromRow(row: SingleRow, adminIds?: Set<string>): NotificationSubject {
  const actors: NotificationActor[] = row.actor_id
    ? [
        {
          id: row.actor_id,
          fullName: row.actor_name?.trim() || null,
          username: row.actor_username?.trim() || null,
          known: row.actor_known,
          isAdmin: row.actor_is_admin ?? (adminIds ? adminIds.has(row.actor_id) : false),
        },
      ]
    : [];

  return {
    type: row.type,
    actors,
    actorCount: actors.length,
    eventCount: 1,
    message: row.message,
    title: row.title,
    createdAt: row.created_at,
  };
}
