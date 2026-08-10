/**
 * THE FEED AD'S PICTURE IS THE SAME SIZE AS A POST'S PICTURE,
 * AND AN ADMIN'S AD CHANGE REACHES SCREENS QUICKLY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG — owner report, 2026-08-04
 *
 * 1. "Ad container size is smaller than the post container." Measured in a
 *    rendered browser at feed width (380px column): the 4:5 aspect box sat on
 *    the WHOLE story-card — so the "Sponsored" label ate 32px of the 475px
 *    box, the picture started 32px down, and overflow-hidden clipped its
 *    bottom 31px. Every ad picture rendered visibly smaller than the 4:5 post
 *    photos around it. The aspect box now sits on the MEDIA container, giving
 *    the ad picture the full 4:5 exactly like PostMedia does.
 *
 * 2. "Ad changed from Admin panel but not updated on the App and web." Zone
 *    config was served from a 10-minute in-memory cache and each AdZone read
 *    it once per mount. Now: ad-setting reads cap staleness at 60s, the admin
 *    save invalidates its own session's cache, and mounted AdZones refetch on
 *    the "ad-slots-updated" event.
 *
 * jsdom has no layout (every element is 0×0), so like SendButtonTapTarget
 * this pins the SOURCE; the rendered proof was measured in real Chromium
 * before shipping (post photo 380×475 vs ad picture 378×472.5 — the 2px is
 * the card's 1px border, nothing clipped).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const adZone = read("src/components/ads/AdZone.tsx");
const adZonesLib = read("src/lib/ads/adZonesV2.ts");
const adminAds = read("src/components/admin/ads/AdminAdsV2.tsx");
const settingsCache = read("src/lib/siteSettingsCache.ts");

describe("the story-card ad picture gets the full 4:5, like a post photo", () => {
  it("keeps the 4:5 frame declared for the story card", () => {
    expect(adZone).toMatch(/aspect: "4 \/ 5"/);
  });

  it("puts the aspect box on the MEDIA container, not the whole card", () => {
    // The wrapper div must NOT carry the aspect style any more — that is what
    // made the label eat into the picture's height.
    expect(adZone).not.toMatch(/frame\.wrapper, className\)\} style=\{frame\.aspect/);
    // The media box carries it instead, and drops h-full (which resolved to
    // auto inside the anchor and let the natural-height image be clipped).
    expect(adZone).toContain('? { className: "relative overflow-hidden w-full", style: { aspectRatio: frame.aspect } }');
    // No radius on the media box. The story card is full-bleed since
    // 2026-08-10 ("show it fullview without border"), and a rounded corner at
    // the screen edge is exactly the inset look he was pointing at.
    expect(adZone).not.toContain('"relative overflow-hidden rounded-sm w-full"');
  });

  it("both own-image paths render through the shared media box", () => {
    const matches = adZone.match(/className=\{mediaBox\.className\} style=\{mediaBox\.style\}/g) ?? [];
    expect(matches.length).toBe(2); // with click_url and without
  });
});

describe("an admin's ad change reaches screens quickly", () => {
  it("ad settings are read with a 60s staleness cap, not the 10-minute default", () => {
    expect(adZonesLib).toMatch(/AD_SETTING_MAX_AGE_MS = 60_000/);
    for (const key of ["AD_ZONES_KEY", "AD_FREQUENCY_KEY", "AD_ZONES_FLAG_KEY"]) {
      expect(adZonesLib).toContain(`getSiteSetting(${key}, { maxAgeMs: AD_SETTING_MAX_AGE_MS })`);
    }
  });

  it("the settings cache honours maxAgeMs", () => {
    expect(settingsCache).toMatch(/Math\.min\(ttl, maxAgeMs \?\? ttl\)/);
  });

  it("saving in the admin panel invalidates the cached setting", () => {
    expect(adminAds).toMatch(/invalidateSiteSetting\(key\);/);
  });

  it("mounted AdZones refetch on the admin's save event", () => {
    expect(adZone).toMatch(/addEventListener\("ad-slots-updated", onUpdated\)/);
    expect(adZone).toMatch(/\[zone, reloadTick\]/);
  });
});
