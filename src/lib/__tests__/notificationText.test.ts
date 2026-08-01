import { describe, it, expect } from "vitest";
import {
  actorPhrase,
  actionPhrase,
  notificationSentence,
  relativeAge,
  bucketFor,
  hasInlineAction,
  type NotificationGroup,
} from "@/lib/notificationText";

const g = (over: Partial<NotificationGroup> = {}): NotificationGroup => ({
  group_key: "k",
  type: "post_reaction",
  notification_ids: ["n1"],
  actor_ids: ["a1"],
  actor_names: ["Anindita Hidayat"],
  actor_usernames: ["aninditahidayat"],
  actor_avatars: [""],
  actor_count: 1,
  event_count: 1,
  unread_count: 1,
  reference_id: null,
  thumbnail_url: null,
  title: "t",
  message: "m",
  latest_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

describe("actorPhrase", () => {
  it("names one actor", () => {
    expect(actorPhrase(g())).toBe("aninditahidayat");
  });

  it("names two actors without an 'and others' tail", () => {
    expect(actorPhrase(g({
      actor_ids: ["a1", "a2"],
      actor_usernames: ["aninditahidayat", "vickyroy87"],
      actor_count: 2,
    }))).toBe("aninditahidayat and vickyroy87");
  });

  it("counts the remainder from actor_count, not from the names it was given", () => {
    // the RPC returns at most 3 names but the TRUE actor_count — the screenshot's
    // "aninditahidayat, vickyroy87 and others" case
    expect(actorPhrase(g({
      actor_ids: ["a1", "a2", "a3"],
      actor_usernames: ["aninditahidayat", "vickyroy87", "somnath"],
      actor_count: 33,
    }))).toBe("aninditahidayat, vickyroy87 and 31 others");
  });

  it("says '1 other', not '1 others'", () => {
    expect(actorPhrase(g({
      actor_ids: ["a1", "a2"],
      actor_usernames: ["a", "b"],
      actor_count: 3,
    }))).toBe("a, b and 1 other");
  });

  it("falls back to the display name when there is no username", () => {
    expect(actorPhrase(g({ actor_usernames: [""] }))).toBe("Anindita Hidayat");
  });

  it("never renders empty when the actor is unknown", () => {
    expect(actorPhrase(g({ actor_ids: [], actor_usernames: [], actor_names: [], actor_count: 0 })))
      .toBe("Someone");
  });
});

describe("actionPhrase", () => {
  it("uses the real event count for the plural form", () => {
    expect(actionPhrase(g({ type: "new_post_from_following", event_count: 33 })))
      .toBe("shared 33 photos.");
  });

  it("uses the singular wording from the screenshot for one post", () => {
    expect(actionPhrase(g({ type: "new_post_from_following", event_count: 1 })))
      .toBe("just shared a post.");
  });

  it("returns nothing for types that carry their own server-written wording", () => {
    expect(actionPhrase(g({ type: "competition_winner" }))).toBe("");
  });
});

describe("notificationSentence", () => {
  it("builds the screenshot's aggregated sentence", () => {
    expect(notificationSentence(g({
      type: "new_post_from_following",
      actor_ids: ["a1", "a2", "a3"],
      actor_usernames: ["aninditahidayat", "vickyroy87", "x"],
      actor_count: 5,
      event_count: 33,
    }))).toBe("aninditahidayat, vickyroy87 and 3 others shared 33 photos.");
  });

  it("builds the follow sentence", () => {
    expect(notificationSentence(g({
      type: "new_follower",
      actor_usernames: ["kasprzwoo"],
    }))).toBe("kasprzwoo started following you.");
  });

  it("falls back to the stored message for an unknown type, never blank", () => {
    expect(notificationSentence(g({ type: "some_future_type", message: "Your payout cleared" })))
      .toBe("Your payout cleared");
  });
});

describe("relativeAge", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  it.each([
    ["2026-08-01T11:59:30.000Z", "now"],
    ["2026-08-01T11:45:00.000Z", "15m"],
    ["2026-08-01T07:00:00.000Z", "5h"],
    ["2026-07-26T12:00:00.000Z", "6d"],
    ["2026-07-25T12:00:00.000Z", "1w"],
    ["2026-06-01T12:00:00.000Z", "2mo"],
    ["2024-08-01T12:00:00.000Z", "2y"],
  ])("%s -> %s", (iso, expected) => {
    expect(relativeAge(iso, now)).toBe(expected);
  });

  it("does not throw on a malformed timestamp", () => {
    expect(relativeAge("not-a-date", now)).toBe("");
  });
});

describe("bucketFor", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  it("puts anything unread in New, however old", () => {
    expect(bucketFor(g({ unread_count: 1, latest_at: "2020-01-01T00:00:00.000Z" }), now)).toBe("new");
  });

  it("puts a read group from this month in Last 30 days", () => {
    expect(bucketFor(g({ unread_count: 0, latest_at: "2026-07-20T00:00:00.000Z" }), now)).toBe("last30");
  });

  it("puts an older read group in Earlier", () => {
    expect(bucketFor(g({ unread_count: 0, latest_at: "2026-01-01T00:00:00.000Z" }), now)).toBe("earlier");
  });
});

describe("hasInlineAction", () => {
  it("is true for the rows that carry a button", () => {
    expect(hasInlineAction(g({ type: "new_follower" }))).toBe(true);
    expect(hasInlineAction(g({ type: "friend_request" }))).toBe(true);
  });
  it("is false for passive rows", () => {
    expect(hasInlineAction(g({ type: "post_reaction" }))).toBe(false);
  });
});
