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

/**
 * Types that describe a thing that happened TO you, with no human actor.
 *
 * Exported so a test can prove this list and ACTION_CATALOG never overlap — an
 * overlap would put a person's name in front of "Your entry was approved."
 */
export const IMPERSONAL_TYPES = new Set([
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

/**
 * The two labels used when a person cannot be named. Exported because the push
 * body is composed in SQL (notif_display_name) and a test compares the two
 * word for word — see src/lib/notifications/__tests__/pushCatalogParity.test.ts.
 */
export const NAME_UNKNOWN = "A member";
export const NAME_DELETED = "A deleted account";

/** One actor's display name, with all three naming rules applied. */
export function actorDisplayName(actor: NotificationActor | undefined): string {
  if (!actor) return NAME_UNKNOWN;
  // Rule 1 wins over everything: an admin is the brand, whatever their profile
  // says. This is the leak that made an admin's real name visible in push.
  if (actor.isAdmin) return BRAND_NAME;
  if (actor.known === false) return NAME_DELETED;
  const name = actor.fullName?.trim();
  if (name) return name; // Rule 2: full name first…
  const username = actor.username?.trim();
  if (username) return username; // …then @username.
  return NAME_UNKNOWN; // Rule 3: a real person we have no label for.
}

/**
 * "Partha Dalal", "Partha Dalal and Tanmay De",
 * "Partha Dalal, Tanmay De and 31 others".
 *
 * Never invents a number: `actorCount` is the true total from the database even
 * though at most three names come back with it.
 */
/**
 * One piece of the actor phrase. A segment carrying an `actor` is that person's
 * NAME; a segment without one is connective text (" and ", ", ", "3 others").
 */
export interface ActorSegment {
  text: string;
  actor?: NotificationActor;
}

/**
 * The actor phrase, BROKEN INTO PARTS so a surface can link the names.
 *
 * F-98c — /notifications rendered twenty member names as dead text. The handle
 * was already arriving: get_my_notifications_grouped() returns actor_usernames,
 * which is profiles.custom_url. Nothing was missing from the data — the phrase
 * was assembled into a single string before it reached the page, so there was
 * no seam at which a name could become a link.
 *
 * The wording lives HERE and only here. actorPhrase() below is the join of
 * these parts, so the string form and the linked form can never drift into two
 * different sentences — the failure mode this codebase has already paid for
 * with author_badges and with the harness fixture projection.
 *
 * Only the first two actors are ever named, and the remainder collapses to
 * "N others", which is not a person and carries no actor.
 */
export function actorPhraseParts(subject: NotificationSubject): ActorSegment[] {
  const actors = subject.actors ?? [];
  const shown = Math.min(actors.length, 2);
  if (shown === 0) return [];

  const named = actors.slice(0, shown);
  const remaining = Math.max(0, (subject.actorCount ?? shown) - shown);
  const seg = (a: NotificationActor): ActorSegment => ({ text: actorDisplayName(a), actor: a });

  if (remaining === 0) {
    return shown === 1
      ? [seg(named[0])]
      : [seg(named[0]), { text: " and " }, seg(named[1])];
  }
  const others = { text: `${remaining} ${remaining === 1 ? "other" : "others"}` };
  return shown === 1
    ? [seg(named[0]), { text: " and " }, others]
    : [seg(named[0]), { text: ", " }, seg(named[1]), { text: " and " }, others];
}

export function actorPhrase(subject: NotificationSubject): string {
  return actorPhraseParts(subject)
    .map((p) => p.text)
    .join("");
}

export interface ActionEntry {
  /** Exactly one event. This is also the string the push body uses. */
  one: string;
  /** Two or more events collapsed into one line. Absent = never grouped. */
  many?: (n: number) => string;
}

/**
 * EVERY PHRASE THE APP CAN SAY ABOUT A NOTIFICATION, in one object.
 *
 * This was a `switch` until 2026-08-02. It is data now for one reason: the push
 * body is composed inside the database (public.notif_action_phrase, added in
 * migration 20260802090000_push_text_from_catalog.sql) and the two copies must
 * never drift. A list can be walked by a test; a switch cannot.
 * `pushCatalogParity.test.ts` walks this object, reads the migration file, and
 * fails if one character differs.
 *
 * A type missing from here is not an error — it renders the sentence the server
 * wrote, on every surface. Adding a type is safe; changing a phrase means
 * changing it in the migration too, and CI will say so.
 */
export const ACTION_CATALOG: Readonly<Record<string, ActionEntry>> = {
  new_post_from_following: { one: "shared a photo.", many: (n) => `shared ${n} photos.` },
  post_reaction: { one: "reacted to your photo.", many: (n) => `reacted to your photos ${n} times.` },
  image_reaction: { one: "reacted to your photo.", many: (n) => `reacted to your photos ${n} times.` },
  post_comment: { one: "commented on your photo.", many: (n) => `left ${n} comments on your photos.` },
  image_comment: { one: "commented on your photo.", many: (n) => `left ${n} comments on your photos.` },
  comment_reply: { one: "replied to your comment.", many: (n) => `replied to you ${n} times.` },
  new_follower: { one: "started following you." },
  friend_request: { one: "sent you a friend request." },
  friend_accepted: { one: "accepted your friend request." },
  post_tag: { one: "tagged you in a photo." },
  // Owner, 2026-08-11: "All tagged person will get all notification untill
  // bering removed the tag." These two are the fan-out to people tagged in
  // someone else's photo. They are deliberately NOT worded "your photo" — it
  // is not their photo, and reusing post_reaction/post_comment would have made
  // the app say so. "you are tagged in", not "you're": the SQL twin of this
  // catalog is a single-quoted string literal and pushCatalogParity extracts it
  // with a regex that stops at the first quote.
  tagged_post_reaction: {
    one: "reacted to a photo you are tagged in.",
    many: (n) => `reacted ${n} times to a photo you are tagged in.`,
  },
  tagged_post_comment: {
    one: "commented on a photo you are tagged in.",
    many: (n) => `left ${n} comments on a photo you are tagged in.`,
  },
  // A reply to your comment on a sponsored ad. Nobody OWNS an ad, so there is
  // no owner notification for ads at all — but a reply still has to reach the
  // person it answers, exactly as it does on a post. "sponsored post" and not
  // "ad", because that is the word the card itself uses.
  ad_comment_reply: {
    one: "replied to your comment on a sponsored post.",
    many: (n) => `replied ${n} times to your comment on a sponsored post.`,
  },
};

/** The verb half. Plural forms use the REAL event count, never an estimate. */
export function actionPhrase(subject: NotificationSubject): string {
  const entry = ACTION_CATALOG[subject.type];
  if (!entry) return "";
  const n = subject.eventCount ?? 1;
  return n > 1 && entry.many ? entry.many(n) : entry.one;
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

  if (IMPERSONAL_TYPES.has(subject.type)) {
    // Nothing happened to you at the hands of a person. Capitalise the verb so
    // it still reads as a sentence rather than a fragment. (No type is both
    // impersonal and phrasable today; this is the guard for the day one is.)
    const standalone = action.charAt(0).toUpperCase() + action.slice(1);
    return { actorText: "", action, text: standalone, age, hasActor: false };
  }

  // A social type always had a human behind it, so the sentence always gets a
  // subject — even when we cannot say who.
  //
  // This is not hypothetical. delete-user and delete-my-account both null out
  // user_notifications.actor_id when an account goes, which is right, and 33
  // rows on production are in that state. Without this line they would read
  // "Started following you." — a headless sentence, and the exact shape of the
  // old "Someone" bug wearing different clothes.
  const actorText = actorPhrase(subject) || NAME_UNKNOWN;

  return { actorText, action, text: `${actorText} ${action}`, age, hasActor: true };
}

export default describeNotification;
