/**
 * THE ONE PLACE A NOTIFICATION BECOMES A SENTENCE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (audit 2026-08-01)
 *
 * The same event read three different ways, depending on where you saw it:
 *
 *   push / bell   "John Doe commented on your post"
 *   /notifications "johnd commented on your photo."
 *
 * Different name (full name vs @username), different noun (post vs photo),
 * different punctuation, and two separate "how long ago" formatters. The bell
 * rendered the frozen `message` column written by a database trigger months
 * earlier; the page recomposed the sentence client-side. Neither was wrong on
 * its own — having both was.
 *
 * Everything a surface needs to render a notification now comes from
 * `describeNotification()`. A surface may choose its own layout. It may not
 * choose its own words.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NAMING RULES, decided once (owner, 2026-08-01)
 *
 * 1. An admin is always the brand — "50mm Retina World", never a real person's
 *    name. Every other surface in the app already does this via resolveName();
 *    notifications were the one place an admin's real name leaked.
 * 2. Full name first, @username as the fallback. (The page used to do the
 *    opposite. This is the owner's call, applied everywhere.)
 * 3. **Never the word "Someone".** It was doing the work of three genuinely
 *    different states, and they deserve different sentences:
 *
 *      - the event has no human actor at all — a competition result, a wallet
 *        movement, a support reply. These read "Your entry was approved.", with
 *        no actor phrase at all. Prefixing a person onto them was always wrong.
 *      - the actor's profile is gone → "A deleted account"
 *      - the actor exists but has neither name nor username → "A member"
 *
 *    The old code could not tell these apart, partly because the grouping RPC
 *    coalesces missing names to an empty string, which is indistinguishable
 *    from "unknown" by the time it reaches TypeScript. `actorKnown` below is
 *    what carries that distinction across the boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { BRAND_NAME } from "@/lib/adminBrand";

/** Types that describe a thing that happened TO you, with no human actor. */
const IMPERSONAL_TYPES = new Set([
  "entry_approved",
  "entry_rejected",
  "entry_shortlisted",
  "entry_qualified",
  "entry_finalist",
  "competition_winner",
  "round_results_published",
  "new_competition",
  "role_approved",
  "role_rejected",
  "badge_awarded",
  "certificate_issued",
  "potd_featured",
  "featured_artist",
  "ticket_reply",
  "deposit_approved",
  "deposit_rejected",
  "verification_required",
  "admin_verification_pending",
  "admin_verification_submitted",
]);

export interface NotificationActor {
  id: string | null;
  /** profiles.full_name. Empty string and null both mean "not set". */
  fullName?: string | null;
  /** profiles.custom_url. Only used when there is no full name. */
  username?: string | null;
  /**
   * FALSE means "we looked and this profile is not there" — a deleted account.
   * Leave undefined when you genuinely do not know; the wording differs.
   */
  known?: boolean;
  isAdmin?: boolean;
}

/**
 * What every surface normalises into before asking for words. The bell builds
 * one of these from a single `user_notifications` row; the page builds one from
 * a grouped RPC row. That is the only difference between them.
 */
export interface NotificationSubject {
  type: string;
  actors: NotificationActor[];
  /** Distinct people behind the group. 1 for a single row. */
  actorCount: number;
  /** How many events collapsed into this. 1 for a single row. */
  eventCount: number;
  /** The server-written sentence, used only for types we do not phrase. */
  message?: string | null;
  title?: string | null;
  createdAt: string;
}

export interface NotificationDescription {
  /** "Partha Dalal", "Partha Dalal and Tanmay De", "… and 31 others", or "". */
  actorText: string;
  /** "commented on your photo." — the verb half, or "" for impersonal types. */
  action: string;
  /** The whole thing, ready to render. Never empty. */
  text: string;
  /** "5m", "3h", "2d" — one format, everywhere. */
  age: string;
  /** True when the sentence names people (so a surface may bold that part). */
  hasActor: boolean;
}

/** One actor's display name, with all three naming rules applied. */
export function actorDisplayName(actor: NotificationActor | undefined): string {
  if (!actor) return "A member";
  // Rule 1 wins over everything: an admin is the brand, whatever their profile
  // says. This is the leak that made an admin's real name visible in push.
  if (actor.isAdmin) return BRAND_NAME;
  if (actor.known === false) return "A deleted account";
  const name = actor.fullName?.trim();
  if (name) return name; // Rule 2: full name first…
  const username = actor.username?.trim();
  if (username) return username; // …then @username.
  return "A member"; // Rule 3: a real person we have no label for.
}

/**
 * "Partha Dalal", "Partha Dalal and Tanmay De",
 * "Partha Dalal, Tanmay De and 31 others".
 *
 * Never invents a number: `actorCount` is the true total from the database even
 * though at most three names come back with it.
 */
export function actorPhrase(subject: NotificationSubject): string {
  const actors = subject.actors ?? [];
  const shown = Math.min(actors.length, 2);
  if (shown === 0) return "";

  const names = actors.slice(0, shown).map((a) => actorDisplayName(a));
  const remaining = Math.max(0, (subject.actorCount ?? shown) - shown);

  if (remaining === 0) {
    return shown === 1 ? names[0] : `${names[0]} and ${names[1]}`;
  }
  const others = `${remaining} ${remaining === 1 ? "other" : "others"}`;
  return shown === 1 ? `${names[0]} and ${others}` : `${names[0]}, ${names[1]} and ${others}`;
}

/** The verb half. Plural forms use the REAL event count, never an estimate. */
export function actionPhrase(subject: NotificationSubject): string {
  const n = subject.eventCount ?? 1;
  const many = n > 1;

  switch (subject.type) {
    case "new_post_from_following":
      return many ? `shared ${n} photos.` : "shared a photo.";
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
      return "";
  }
}

/** Compact age: now / 5m / 3h / 6d / 1w / 3mo / 2y. `now` injectable for tests. */
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
  if (days < 30) return `${Math.floor(days / 7)}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * The sentence, and everything needed to render it.
 *
 * Falls back to the server-written `message` for any type this file does not
 * phrase — so a type added to the database tomorrow renders its own wording
 * rather than a blank row. That fallback is also why an impersonal type is
 * listed explicitly above: without the list, "Your entry was approved." would
 * get a person's name glued to the front of it.
 */
export function describeNotification(
  subject: NotificationSubject,
  now: Date = new Date(),
): NotificationDescription {
  const age = relativeAge(subject.createdAt, now);
  const action = actionPhrase(subject);

  // No phrasing of our own → render what the server wrote, verbatim.
  if (!action) {
    return {
      actorText: "",
      action: "",
      text: (subject.message || subject.title || "").trim(),
      age,
      hasActor: false,
    };
  }

  const impersonal = IMPERSONAL_TYPES.has(subject.type);
  const actorText = impersonal ? "" : actorPhrase(subject);

  if (!actorText) {
    // A type we phrase, but with nobody to name. Capitalise the verb so it
    // still reads as a sentence rather than a fragment.
    const standalone = action.charAt(0).toUpperCase() + action.slice(1);
    return { actorText: "", action, text: standalone, age, hasActor: false };
  }

  return { actorText, action, text: `${actorText} ${action}`, age, hasActor: true };
}

export default describeNotification;
