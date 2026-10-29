/**
 * ADS BUG 2 — a failed settings read is "unknown", never "ads off".
 *
 * The ad zone's data is kept on the phone (["ad-zone", zone]). The settings
 * reader answers null both for an unset key and for a failed request; before
 * this, the zone read null as "ads off" and that SUCCESS would be saved on
 * the phone over the last good settings — one weak-network read and the feed
 * has no ad offline. An explicit "off" stays a definite answer (review #558).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = vi.hoisted(() => ({ values: [null, null] as unknown[] }));
vi.mock("@/lib/siteSettingsCache", () => ({
  getSiteSetting: async () => null,
  getSiteSettings: async () => settings.values,
}));
vi.mock("@/lib/ads/adCreatives", () => ({ fetchAdCreatives: async () => [] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));

import { loadAdZoneData } from "@/lib/ads/adZoneData";

beforeEach(() => { settings.values = [null, null]; });

describe("ad settings that could not be read", () => {
  it("make the ad zone's read FAIL (kept data stays), not succeed as 'ads off'", async () => {
    await expect(loadAdZoneData("story-card")).rejects.toThrow(/could not be read/);
  });

  it("an explicit 'off' is a definite answer, even with no zone config saved", async () => {
    settings.values = [false, null];
    expect((await loadAdZoneData("story-card")).enabled).toBe(false);
  });

  it("on with a config reads as on", async () => {
    settings.values = [true, { "story-card": { mode: "own" } }];
    const d = await loadAdZoneData("story-card");
    expect(d.enabled).toBe(true);
    expect(d.config.mode).toBe("own");
  });
});
