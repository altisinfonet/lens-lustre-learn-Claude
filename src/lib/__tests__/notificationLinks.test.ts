/**
 * WHERE DOES TAPPING A NOTIFICATION TAKE YOU?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on production 2026-08-02
 *
 * `getNotifLink` had no case for **new_post_from_following** — the
 * highest-volume type on the platform — so it fell through to the default and
 * put every member on /dashboard. Its reference_id is the post: verified, 14 of
 * 24 rows point at a live post and the rest at posts since deleted.
 *
 * **comment_reply** went to /discover, the gallery. Of its 11 rows, 9 point at
 * a live post, 2 at deleted posts, and **none at a gallery image**. Someone
 * replied to your comment and the app opened an unrelated gallery.
 *
 * ALSO CHECKED AND DELIBERATELY NOT CHANGED — recorded here so it is not
 * "fixed" by someone reading the same list later:
 *
 *   image_reaction / image_comment  reference_id points at a `portfolio_images`
 *                                   row — the HOME PAGE gallery, which has no
 *                                   page of its own anywhere in the app.
 *                                   /discover is the closest true destination.
 *   course_published                links to /courses/<uuid> against a
 *                                   /courses/:slug route, which LOOKS broken.
 *                                   It is not: useCourseDetail falls back to a
 *                                   lookup by id when the slug misses.
 *
 * And the audit's claim that seven further types dump you on /dashboard was
 * WRONG. entry_shortlisted, entry_qualified, entry_finalist,
 * round_results_published, verification_required, admin_verification_pending
 * and admin_verification_submitted are emitted by **nothing** — no database
 * function, no edge function, no client code — and no row of any of them exists.
 * They are names in a list, not a routing failure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { getNotifLink } from "@/lib/notificationLinks";

const POST = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";

describe("the two destinations that were wrong", () => {
  it("opens the post someone you follow just shared", () => {
    expect(getNotifLink({ type: "new_post_from_following", reference_id: POST })).toBe(
      `/post/${POST}`,
    );
  });

  it("no longer drops that member on the dashboard", () => {
    // This is the regression. Before the fix there was no case at all for the
    // highest-volume notification type on the platform.
    expect(getNotifLink({ type: "new_post_from_following", reference_id: POST })).not.toBe(
      "/dashboard",
    );
  });

  it("opens the post the reply is on", () => {
    expect(getNotifLink({ type: "comment_reply", reference_id: POST })).toBe(`/post/${POST}`);
    expect(getNotifLink({ type: "comment_reply", reference_id: POST })).not.toBe("/discover");
  });

  it("falls back to the feed rather than a broken post URL", () => {
    expect(getNotifLink({ type: "new_post_from_following", reference_id: null })).toBe("/feed");
    expect(getNotifLink({ type: "comment_reply", reference_id: null })).toBe("/feed");
  });
});

describe("the destinations that were deliberately left alone", () => {
  it("keeps gallery reactions on the gallery", () => {
    // portfolio_images has no per-image page. Sending someone to /post/<id>
    // here would be a 404 dressed up as a fix.
    expect(getNotifLink({ type: "image_reaction", reference_id: POST })).toBe("/discover");
    expect(getNotifLink({ type: "image_comment", reference_id: POST })).toBe("/discover");
  });
});

describe("every type that actually exists on this platform has a destination", () => {
  /**
   * The 15 types present in user_notifications on production, 2026-08-02, with
   * where each one should land. Not a wish list — a census.
   */
  const LIVE: Array<[string, string | null, string]> = [
    ["post_reaction", POST, `/post/${POST}`],
    ["post_comment", POST, `/post/${POST}`],
    ["comment_reply", POST, `/post/${POST}`],
    ["new_post_from_following", POST, `/post/${POST}`],
    ["new_follower", PERSON, `/profile/${PERSON}`],
    ["friend_request", PERSON, "/friends"],
    ["friend_accepted", PERSON, `/profile/${PERSON}`],
    ["image_reaction", POST, "/discover"],
    ["entry_rejected", POST, `/competitions/${POST}`],
    ["course_published", POST, `/courses/${POST}`],
    ["certificate_issued", POST, "/certificates"],
    ["badge_awarded", POST, "/certificates"],
    ["deposit_approved", POST, "/wallet"],
    ["potd_featured", POST, "/"],
    ["ticket_reply", POST, "/help-support"],
  ];

  it.each(LIVE)("%s lands somewhere meant for it", (type, ref, expected) => {
    expect(getNotifLink({ type, reference_id: ref })).toBe(expected);
  });

  it("means no live type falls through to the catch-all", () => {
    // /dashboard is the fallback. A live type reaching it is a type nobody
    // decided a destination for — which is how new_post_from_following spent
    // its whole life sending people to the wrong screen.
    const fellThrough = LIVE.filter(([type, ref]) => getNotifLink({ type, reference_id: ref }) === "/dashboard");
    expect(fellThrough.map(([t]) => t)).toEqual([]);
  });
});
