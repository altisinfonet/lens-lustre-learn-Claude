import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { centreHeadline, isBigMoment } from "@/lib/notifications/centreWording";
import { ACTION_CATALOG } from "@/lib/notifications/describe";

const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/20261104_0110_notification_centre.sql"), "utf8");
const memberTypes = [...sql.matchAll(/^\s*\('([a-z_]+)',\s*'member',\s*'[a-z_]+'/gm)].map((m) => m[1]);

describe("centre wording (N7): no member type is left with server text only", () => {
  it("reads the registry's member types", () => {
    expect(memberTypes.length).toBeGreaterThanOrEqual(43);
  });

  it("every member type has an app sentence (people) or an app headline (everything else)", () => {
    const missing = memberTypes.filter((t) => !ACTION_CATALOG[t] && !centreHeadline(t));
    expect(missing).toEqual([]);
  });

  it("a type with an app sentence gets no headline (no double wording)", () => {
    for (const t of Object.keys(ACTION_CATALOG)) expect(centreHeadline(t), t).toBeNull();
  });

  it("unknown types get no headline and are never big", () => {
    expect(centreHeadline("some_future_type")).toBeNull();
    expect(isBigMoment("some_future_type")).toBe(false);
  });

  it("the big moments are the awards and features, nothing routine", () => {
    for (const t of ["competition_winner", "entry_award", "entry_finalist", "potd_featured", "featured_artist", "certificate_issued"]) {
      expect(isBigMoment(t), t).toBe(true);
    }
    for (const t of ["entry_rejected", "deposit_rejected", "post_reaction", "new_follower", "ticket_reply"]) {
      expect(isBigMoment(t), t).toBe(false);
    }
  });

  it("headlines are short, plain and end without a full stop", () => {
    for (const t of memberTypes) {
      const h = centreHeadline(t);
      if (!h) continue;
      expect(h.fallback.length, t).toBeLessThanOrEqual(32);
      expect(h.fallback, t).not.toMatch(/\.$|Someone/);
      expect(h.key, t).toBe(`notifications.headline.${t}`);
    }
  });

  it("competition_winner covers EVERY award level (runner-up, Top 100 …), so its headline must not claim first place", () => {
    // 20261104_0150: competition_winner fires for winner, runner_up*, honourable mentions, special_jury, top_50, top_100
    expect(centreHeadline("competition_winner")?.fallback).not.toMatch(/You won!|first|winner/i);
    expect(centreHeadline("competition_winner")?.fallback).toMatch(/award/i);
  });

  it("the admin announcement (registry row added by 20261104_0220) leads with 'Announcement'", () => {
    // the server text under it is the admin's own title + message
    expect(centreHeadline("admin_announcement")?.fallback).toBe("Announcement");
    expect(isBigMoment("admin_announcement")).toBe(false);
  });
});
