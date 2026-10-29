/**
 * ADS BUG 2 — a failed settings read is "unknown", never "ads off".
 *
 * The ad zone's data is kept on the phone (["ad-zone", zone]). The settings
 * reader answers null both for an unset key and for a failed request; before
 * this, the zone read null as "ads off" and that SUCCESS would be saved on
 * the phone over the last good settings — one weak-network read and the feed
 * has no ad offline.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/siteSettingsCache", () => ({
  getSiteSetting: async () => null,
  getSiteSettings: async (keys: string[]) => keys.map(() => null),
}));
vi.mock("@/lib/ads/adCreatives", () => ({ fetchAdCreatives: async () => [] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) },
}));

import { loadAdZoneData } from "@/lib/ads/adZoneData";

describe("ad settings that could not be read", () => {
  it("make the ad zone's read FAIL (kept data stays), not succeed as 'ads off'", async () => {
    await expect(loadAdZoneData("story-card")).rejects.toThrow(/could not be read/);
  });
});
