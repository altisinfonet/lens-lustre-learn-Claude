import { describe, it, expect } from "vitest";
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
    ["competition_winner", "competitions"], ["round_published", "competitions"], ["new_competition", "competitions"],
    ["certificate_issued", "competitions"], ["needs_review", "competitions"],
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
