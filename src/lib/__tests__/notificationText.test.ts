/**
 * What survives in notificationText.ts: the bucket a group falls into.
 *
 * The phrasing tests that used to live here went with the functions they
 * covered (2026-08-02). Every assertion about wording now lives in
 * src/lib/notifications/__tests__/describe.test.ts — one text layer, one set of
 * tests. Keeping a second suite alive would have kept a second answer alive.
 */
import { describe, it, expect } from "vitest";
import { bucketFor, BUCKET_LABEL, type NotificationGroup } from "@/lib/notificationText";

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

  it("has a label for every bucket it can return", () => {
    for (const key of ["new", "last30", "earlier"] as const) {
      expect(BUCKET_LABEL[key]).toBeTruthy();
    }
  });
});

describe("this file no longer phrases anything", () => {
  it("exports no sentence builders", async () => {
    // The old actorPhrase/actionPhrase/notificationSentence said "Someone" and
    // "just shared a post." — both removed from the product on purpose. If they
    // come back, so does the drift they caused.
    const mod = await import("@/lib/notificationText");
    for (const gone of [
      "actorPhrase",
      "actionPhrase",
      "notificationSentence",
      "actorLabel",
      "relativeAge",
      "hasInlineAction",
    ]) {
      expect(mod).not.toHaveProperty(gone);
    }
  });
});
