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
    // Added 2026-08-11. The fan-out to people tagged in someone else's photo
    // carries the SAME reference_id — the post — because the thing you are
    // being told about is activity on that post. Without these two cases they
    // would fall through to the default and land the member on /dashboard,
    // which is the exact bug new_post_from_following had.
    case "tagged_post_reaction":
    case "tagged_post_comment":
      return notif.reference_id ? `/post/${notif.reference_id}` : "/feed";
    // A reply to a comment. Measured on production 2026-08-02: of 11 rows,
    // 9 reference_ids are live posts, 2 are posts that have since been deleted,
    // and NONE is a gallery image — so this is a post reply in practice and
    // "/discover" was sending people to a gallery that has nothing to do with
    // the reply they were told about.
    case "comment_reply":
      return notif.reference_id ? `/post/${notif.reference_id}` : "/feed";
    // Reactions and comments on the home-page gallery. reference_id points at a
    // `portfolio_images` row, which has NO page of its own anywhere in the app,
    // so the gallery is the closest true destination. Deliberately unchanged.
    case "image_reaction":
    case "image_comment":
      return "/discover";
    // Someone you follow posted. reference_id is that post — verified on
    // production. This was the single highest-volume type with no case at all,
    // so it fell through to the default and landed every member on /dashboard.
    case "new_post_from_following":
      return notif.reference_id ? `/post/${notif.reference_id}` : "/feed";
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
    // A reply on a sponsored ad. reference_id is the ad_creatives row, which
    // has its own page — an ad is not a post, so /post/<id> would 404.
    case "ad_comment_reply":
      return notif.reference_id ? `/ad/${notif.reference_id}` : "/feed";
    // "🎉 Today is <name>'s Birthday" — the whole point is to go and wish them,
    // so the destination is that person. reference_id is the celebrant, written
    // by emit_birthday_notifications().
    case "birthday":
      return notif.reference_id ? `/profile/${notif.reference_id}` : "/feed";
    default:
      return "/dashboard";
  }
}
