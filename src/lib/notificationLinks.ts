/**
 * Single source of truth for "where does this notification take me?".
 *
 * Used by BOTH the in-app notification bell and the push-notification tap
 * handler, so the two can never drift apart. A push payload only carries
 * `type` and `reference_id`, which is all this needs.
 */
export type NotifLinkInput = { type: string; reference_id?: string | null };

export function getNotifLink(notif: NotifLinkInput): string {
  switch (notif.type) {
    // The DB triggers store NEW.post_id in reference_id for these, so we can
    // open the exact post instead of dumping the user on the feed (bug report
    // 2026-07-31: "clicking the notification doesn't take me to the comment").
    case "post_reaction":
    case "post_comment":
      return notif.reference_id ? `/post/${notif.reference_id}` : "/feed";
    case "image_reaction":
    case "image_comment":
    case "comment_reply":
      return "/discover";
    case "competition_vote":
    case "entry_approved":
    case "entry_rejected":
    case "competition_winner":
    case "new_competition":
      return notif.reference_id ? `/competitions/${notif.reference_id}` : "/competitions";
    // A pending request needs the Awaited list (where it can be accepted), not
    // the sender's profile. /friends opens on Awaited when requests are waiting.
    case "friend_request":
      return "/friends";
    // These are informational — the person is the destination.
    case "new_follower":
    case "friend_accepted":
      return notif.reference_id ? `/profile/${notif.reference_id}` : "/friends";
    case "role_approved":
    case "role_rejected":
      return "/dashboard";
    case "ticket_reply":
      return "/help-support";
    case "deposit_approved":
    case "deposit_rejected":
      return "/wallet";
    case "badge_awarded":
    case "certificate_issued":
      return "/certificates";
    case "potd_featured":
    case "featured_artist":
      return "/";
    case "journal_published":
      return notif.reference_id ? `/journal/${notif.reference_id}` : "/journal";
    case "course_published":
      return notif.reference_id ? `/courses/${notif.reference_id}` : "/courses";
    case "post_tag":
      return notif.reference_id ? `/post/${notif.reference_id}` : "/feed";
    default:
      return "/dashboard";
  }
}
