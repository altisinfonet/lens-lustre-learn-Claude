/**
 * Tests for the ONE place a notification becomes a sentence.
 *
 * WHY THIS EXISTS (audit 2026-08-01)
 *   The same event read three ways: push and the bell used the frozen `message`
 *   column a trigger wrote ("John Doe commented on your post"), while
 *   /notifications recomposed it client-side ("johnd commented on your
 *   photo."). Different name, different noun, different time format.
 *
 *   Everything below is a rule that was decided once and must hold on EVERY
 *   surface. The last block is the one the owner will notice: an admin must
 *   never appear under a real person's name.
 */

import { describe, it, expect } from "vitest";
import {
  describeNotification,
  actorDisplayName,
  actorPhrase,
  relativeAge,
} from "@/lib/notifications/describe";
import { subjectFromGroup, subjectFromRow } from "@/lib/notifications/adapters";
import { BRAND_NAME } from "@/lib/adminBrand";

const NOW = new Date("2026-08-01T12:00:00Z");

const groupRow = (over: Record<string, unknown> = {}) => ({
  type: "post_comment",
  actor_ids: ["a1"],
  actor_names: ["Partha Dalal"],
  actor_usernames: ["parthad"],
  actor_count: 1,
  event_count: 1,
  message: "Partha Dalal commented on your post",
  title: "New comment",
  latest_at: NOW.toISOString(),
  ...over,
});

const singleRow = (over: Record<string, unknown> = {}) => ({
  type: "post_comment",
  actor_id: "a1",
  actor_name: "Partha Dalal",
  actor_username: "parthad",
  actor_known: true,
  actor_is_admin: false,
  message: "Partha Dalal commented on your post",
  title: "New comment",
  created_at: NOW.toISOString(),
  ...over,
});

describe("the bell and the page cannot disagree", () => {
  it("produces the identical sentence from a single row and from a group of one", () => {
    // This is the whole point of the layer. Same event, two different queries,
    // one sentence.
    const fromBell = describeNotification(subjectFromRow(singleRow()), NOW);
    const fromPage = describeNotification(subjectFromGroup(groupRow()), NOW);

    expect(fromBell.text).toBe(fromPage.text);
    expect(fromBell.age).toBe(fromPage.age);
    expect(fromBell.text).toBe("Partha Dalal commented on your photo.");
  });

  it("does not render the frozen server message for a type it can phrase", () => {
    // The stored message says "post"; we say "photo". The point is that BOTH
    // surfaces now say the same one.
    const d = describeNotification(subjectFromRow(singleRow()), NOW);
    expect(d.text).not.toContain("commented on your post");
  });
});

describe("naming — full name first, username as fallback (owner, 2026-08-01)", () => {
  it("prefers the full name", () => {
    expect(actorDisplayName({ id: "a", fullName: "Partha Dalal", username: "parthad" }))
      .toBe("Partha Dalal");
  });

  it("falls back to the username when there is no full name", () => {
    expect(actorDisplayName({ id: "a", fullName: "", username: "parthad" })).toBe("parthad");
    expect(actorDisplayName({ id: "a", fullName: null, username: "parthad" })).toBe("parthad");
  });

  it("treats the RPC's empty-string names as absent, not as a name", () => {
    // get_my_notifications_grouped coalesces NULL to '', which is
    // indistinguishable from "unknown" by the time it reaches TypeScript.
    const subject = subjectFromGroup(groupRow({ actor_names: [""], actor_usernames: ["parthad"] }));
    expect(describeNotification(subject, NOW).actorText).toBe("parthad");
  });
});

describe("an admin is always the brand", () => {
  it("replaces a real admin name on the page", () => {
    const subject = subjectFromGroup(groupRow(), new Set(["a1"]));
    expect(describeNotification(subject, NOW).actorText).toBe(BRAND_NAME);
  });

  it("replaces it in the bell too", () => {
    const subject = subjectFromRow(singleRow({ actor_is_admin: true }));
    expect(describeNotification(subject, NOW).actorText).toBe(BRAND_NAME);
  });

  it("beats every other naming rule", () => {
    // Even with a full name AND a username present, admin wins.
    expect(actorDisplayName({ id: "a", fullName: "Real Person", username: "real", isAdmin: true }))
      .toBe(BRAND_NAME);
  });
});

describe('the word "Someone" is gone, and the states it hid are separated', () => {
  it('does not say "Someone" for a nameless actor', () => {
    const subject = subjectFromGroup(groupRow({ actor_names: [""], actor_usernames: [""] }));
    const d = describeNotification(subject, NOW);
    expect(d.text).not.toMatch(/Someone/);
    expect(d.text).toBe("A member commented on your photo.");
  });

  it("says so when the profile is actually gone", () => {
    const subject = subjectFromRow(singleRow({ actor_known: false }));
    expect(describeNotification(subject, NOW).actorText).toBe("A deleted account");
  });

  it("puts no name at all on a notification with no human actor", () => {
    // A competition result happened TO you. There is nobody to name.
    const subject = subjectFromGroup(
      groupRow({
        type: "entry_approved",
        actor_ids: [],
        actor_names: [],
        actor_usernames: [],
        actor_count: 0,
        message: 'Your entry in "Monsoon" has been approved!',
      }),
    );
    const d = describeNotification(subject, NOW);
    expect(d.hasActor).toBe(false);
    expect(d.text).toBe('Your entry in "Monsoon" has been approved!');
  });

  it("still names a subject when a social type has lost its actor", () => {
    // CHANGED 2026-08-02. This used to expect the headless "Reacted to your
    // photo." Production says that is the wrong call: delete-user and
    // delete-my-account null out user_notifications.actor_id when an account
    // goes, and 33 rows are in that state right now. A social event always had
    // a person behind it, so the sentence keeps a subject even when we can no
    // longer say who — a headless verb is the old "Someone" bug in disguise.
    const subject = subjectFromGroup(
      groupRow({ type: "post_reaction", actor_ids: [], actor_names: [], actor_count: 0 }),
    );
    expect(describeNotification(subject, NOW).text).toBe("A member reacted to your photo.");
  });

  it("leaves an impersonal notification with no subject at all", () => {
    // The other half of the same decision: nobody DID this to you, so nothing
    // is prefixed. Guard for the day a type is both impersonal and phrasable.
    const subject = subjectFromGroup(
      groupRow({ type: "entry_approved", actor_ids: [], actor_names: [], actor_count: 0, message: "" }),
    );
    expect(describeNotification(subject, NOW).text).not.toMatch(/^A member/);
  });
});

describe("counts are real, never invented", () => {
  it("names two and counts the rest from the true distinct total", () => {
    const subject = subjectFromGroup(
      groupRow({
        actor_ids: ["a1", "a2", "a3"],
        actor_names: ["Partha Dalal", "Tanmay De", "Amit Sen"],
        actor_count: 33,
        event_count: 40,
      }),
    );
    const d = describeNotification(subject, NOW);
    expect(d.actorText).toBe("Partha Dalal, Tanmay De and 31 others");
    expect(d.action).toBe("left 40 comments on your photos.");
  });

  it("uses the singular for exactly one other", () => {
    const subject = subjectFromGroup(
      groupRow({ actor_ids: ["a1", "a2"], actor_names: ["A", "B"], actor_count: 3 }),
    );
    expect(actorPhrase(subject)).toBe("A, B and 1 other");
  });
});

describe("one age format", () => {
  it("is the compact form on every surface", () => {
    const t = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
    expect(relativeAge(t(0), NOW)).toBe("now");
    expect(relativeAge(t(5), NOW)).toBe("5m");
    expect(relativeAge(t(180), NOW)).toBe("3h");
    expect(relativeAge(t(60 * 24 * 2), NOW)).toBe("2d");
  });

  it("never throws on a malformed date", () => {
    expect(relativeAge("not a date", NOW)).toBe("");
  });
});
