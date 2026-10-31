import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NOTIFICATION_TABS, notificationTab, inTab } from "@/lib/notifications/tabs";

describe("notification tabs (N7)", () => {
  it("has the four tabs in order", () => {
    expect(NOTIFICATION_TABS).toEqual(["all", "comments", "follows", "competitions"]);
  });

  it.each([
    ["post_comment", "comments"], ["image_comment", "comments"], ["comment_reply", "comments"],
    ["tagged_post_comment", "comments"], ["ad_comment_reply", "comments"], ["post_tag", "comments"],
    ["new_follower", "follows"], ["friend_request", "follows"], ["friend_accepted", "follows"],
    ["competition_vote", "competitions"], ["entry_approved", "competitions"], ["entry_award", "competitions"],
    ["competition_winner", "competitions"], ["round_published", "competitions"],
    ["certificate_issued", "competitions"], ["needs_review", "competitions"], ["new_competition", null],
    ["post_reaction", null], ["new_post_from_following", null], ["birthday", null], ["deposit_approved", null],
    ["some_future_type", null],
  ])("%s → %s", (type, tab) => {
    expect(notificationTab(type)).toBe(tab);
  });

  it("All holds every type; a named tab only its own", () => {
    expect(inTab("post_reaction", "all")).toBe(true);
    expect(inTab("some_future_type", "all")).toBe(true);
    expect(inTab("post_comment", "comments")).toBe(true);
    expect(inTab("post_comment", "follows")).toBe(false);
    expect(inTab("post_reaction", "comments")).toBe(false);
  });
});

describe("tabs follow the centre's type registry (20261104_0110)", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/20261104_0110_notification_centre.sql"), "utf8");
  const registry = new Map<string, string>();
  for (const m of sql.matchAll(/^\s*\('([a-z_]+)',\s*'(member|admin)',\s*'([a-z_]+)'/gm)) registry.set(m[1], m[3]);

  it("reads the registry", () => {
    expect(registry.size).toBeGreaterThanOrEqual(49);
  });

  it("every member type of follows_friends / competitions is in its tab, and nothing else is", () => {
    for (const [type, group] of registry) {
      const tab = notificationTab(type);
      if (group === "follows_friends") expect(tab, type).toBe("follows");
      else if (group === "competitions") expect(tab, type).toBe("competitions");
      else if (group === "likes_comments") expect([null, "comments"], type).toContain(tab);
      else expect(tab, type).toBeNull();
    }
  });
});
