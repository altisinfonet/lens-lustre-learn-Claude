/**
 * N7b · sections are by TIME only: New · This week · Last 30 days · Earlier.
 * New = still unread (bucketFor's honest rule); the rest by age of the
 * latest event. Never a category header.
 */
import { describe, it, expect } from "vitest";
import { centreSections } from "@/lib/notifications/sections";
import type { NotificationGroup } from "@/lib/notificationText";

const NOW = new Date("2026-11-01T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const g = (key: string, days: number, unread = 0, type = "post_reaction"): NotificationGroup => ({
  group_key: key, type, notification_ids: [key], actor_ids: [], actor_names: [], actor_usernames: [], actor_avatars: [],
  actor_count: 0, event_count: 1, unread_count: unread, reference_id: null, thumbnail_url: null, title: "", message: "",
  latest_at: ago(days),
});

describe("centreSections", () => {
  it("New · This week · Last 30 days · Earlier, in that order", () => {
    const s = centreSections([g("old", 90), g("m", 20), g("w", 3), g("u", 40, 2)], "all", NOW);
    expect(s.map((x) => [x.key, x.label.fallback, x.groups.map((y) => y.group_key)])).toEqual([
      ["new", "New", ["u"]],
      ["week", "This week", ["w"]],
      ["last30", "Last 30 days", ["m"]],
      ["earlier", "Earlier", ["old"]],
    ]);
  });

  it("7 days is this week, 8 days is not", () => {
    const s = centreSections([g("a", 7), g("b", 8)], "all", NOW);
    expect(s.map((x) => [x.key, x.groups.map((y) => y.group_key)])).toEqual([["week", ["a"]], ["last30", ["b"]]]);
  });

  it("empty sections are left out; a tab filters rows", () => {
    const s = centreSections([g("f", 1, 0, "new_follower"), g("r", 1)], "follows", NOW);
    expect(s.map((x) => [x.key, x.groups.map((y) => y.group_key)])).toEqual([["week", ["f"]]]);
  });
});
