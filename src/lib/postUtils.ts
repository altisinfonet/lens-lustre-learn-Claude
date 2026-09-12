import { Globe, Users, Lock } from "lucide-react";
import { createElement } from "react";

/**
 * Relative age for a post or a comment: "Just now", "5m", "3h", "2d", then an
 * absolute date.
 *
 * ⚠ `weeks` IS OPT-IN, AND THE DEFAULT IS UNCHANGED ON PURPOSE.
 *
 * A comment thread wants a RELATIVE age all the way out — the reference reads
 * "5w", and in a list of replies "5w" answers "is this conversation still
 * live?" in a way "Aug 20" does not. A post card wants the opposite: its
 * header is the one place a photograph is dated, and a date is what a member
 * screenshots, cites and searches for.
 *
 * Those are two genuinely different answers, so the tier is a parameter rather
 * than a change of behaviour. Only CommentThread passes it; PostCard calls this
 * exactly as it always has and its output is byte-identical.
 *
 * It is a PARAMETER and not a second `timeAgoWeeks` helper because this
 * codebase already carries six hand-copied `timeAgo`s (AdminNotifications,
 * ImageEngagement, ProfileActivityFeed, CommentsSection, PostDetail, plus the
 * one in src/utils/time.ts that stops at "mo"). A seventh would be the same
 * mistake one more time.
 */
export const timeAgo = (dateStr: string, opts?: { weeks?: boolean }) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  if (opts?.weeks) {
    // 52 weeks, not 12 months: weeks are what the days actually divide into,
    // and rolling over at "52w" keeps the unit honest rather than inventing a
    // 30-day month the calendar does not have.
    const weeks = Math.floor(days / 7);
    return weeks < 52 ? `${weeks}w` : `${Math.floor(days / 365)}y`;
  }
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const privacyIcon = (p: string) => {
  switch (p) {
    case "friends": return createElement(Users, { className: "h-3 w-3" });
    case "private": return createElement(Lock, { className: "h-3 w-3" });
    default: return createElement(Globe, { className: "h-3 w-3" });
  }
};
