import { Link } from "react-router-dom";
import { memberPath } from "@/lib/urlHelpers";
import { actorPhraseParts } from "@/lib/notifications/describe";
import type { NotificationSubject } from "@/lib/notifications/describe";

/**
 * The people in a notification, with their names as LINKS.
 *
 * F-98c — /notifications rendered every member name as dead text: ONE live link
 * against TWENTY dead on the deployed page. Nothing was missing from the data.
 * get_my_notifications_grouped() already returns actor_usernames, which is
 * profiles.custom_url, and the page simply never built an address from it — the
 * whole phrase arrived pre-joined into a string, so there was no seam at which
 * a name could become a link.
 *
 * The wording is NOT rebuilt here. It comes from actorPhraseParts(), which
 * actorPhrase() joins for every non-linking surface, so the sentence a member
 * reads is the same one either way. Duplicating the phrasing to add links is
 * exactly how the string form and the linked form drift into two different
 * sentences — the failure this codebase has already paid for twice.
 *
 * A segment with no handle renders as text and SAYS SO: data-unlinked="missing"
 * means nobody decided, which is the state a walking probe must be able to see.
 * There is no deliberate case here — a notification names other people, never
 * the reader, so every actor in it should be reachable.
 */
export default function ActorPhrase({ subject }: { subject: NotificationSubject }) {
  const parts = actorPhraseParts(subject);
  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((part, i) => {
        if (!part.actor) return <span key={i}>{part.text}</span>;
        const href = memberPath(part.actor.username);
        return href ? (
          <Link key={i} to={href} className="hover:underline">
            {part.text}
          </Link>
        ) : (
          <span key={i} data-unlinked="missing">
            {part.text}
          </span>
        );
      })}
    </>
  );
}
