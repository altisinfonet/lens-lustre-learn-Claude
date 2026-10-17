/**
 * VID-5 · video ads: the read side (ad_videos → each creative's playable video)
 * and the ad slot that plays it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "@/test-utils/sourceText";

const calls: Array<{ table: string; ids?: readonly string[] }> = [];
let adVideoRows: unknown[] = [];
let adVideoError: { message: string; code?: string } | null = null;
let creativeRows: unknown[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        if (table === "ad_videos") {
          return { in: (_c: string, ids: readonly string[]) => { calls.push({ table, ids }); return Promise.resolve({ data: adVideoError ? null : adVideoRows, error: adVideoError }); } };
        }
        // ad_creatives: .eq().eq().order().order()
        const chain = { eq: () => chain, order: () => chain, then: (r: (v: unknown) => void) => { calls.push({ table }); return Promise.resolve({ data: creativeRows, error: null }).then(r); } };
        return chain;
      },
    }),
  },
}));
const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: (...a: unknown[]) => warn(...a) } }));

import { fetchAdVideoMap } from "../postVideoRead";
import { fetchAdCreatives, invalidateAdCreatives } from "@/lib/ads/adCreatives";

const READY = (id: string) => ({ id, state: "ready", current_version: 1, video_versions: [{ version_no: 1, width: 1080, height: 1920, declared_duration_s: "30.5", has_audio: true }] });

beforeEach(() => { calls.length = 0; adVideoRows = []; adVideoError = null; creativeRows = []; warn.mockClear(); invalidateAdCreatives(); });

describe("fetchAdVideoMap", () => {
  it("a ready video → its card data; one not ready → hidden (the ad keeps its picture)", async () => {
    adVideoRows = [
      { ad_creative_id: "c1", video_id: "v1", videos: READY("v1") },
      { ad_creative_id: "c2", video_id: "v2", videos: { ...READY("v2"), state: "checking" } },
    ];
    const m = await fetchAdVideoMap(["c1", "c2", "c3"]);
    expect(m.get("c1")).toEqual({ id: "v1", width: 1080, height: 1920, durationS: 30.5, hasAudio: true });
    expect(m.get("c2")).toBe("hidden");
    expect(m.has("c3")).toBe(false);
  });

  it("one batched read, never one per ad", async () => {
    await fetchAdVideoMap(Array.from({ length: 30 }, (_, i) => `c${i}`));
    expect(calls.filter((c) => c.table === "ad_videos").length).toBe(1);
  });

  it("a lane without the video tables (production before promotion) is quiet: no video ads, no warning", async () => {
    adVideoError = { message: "relation does not exist", code: "42P01" };
    expect((await fetchAdVideoMap(["c1"])).size).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    adVideoError = { message: "permission denied", code: "42501" };
    await fetchAdVideoMap(["c1"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAdCreatives carries each creative's video", () => {
  it("video on the creative that has a ready one; null on the others", async () => {
    creativeRows = [
      { id: "c1", zone: "story-card", image_url: "https://x/1.jpg", click_url: "", alt_text: "", headline: "", subtext: "", cta: "", advertiser_name: null, advertiser_logo_url: null, sort_order: 0 },
      { id: "c2", zone: "story-card", image_url: "https://x/2.jpg", click_url: "", alt_text: "", headline: "", subtext: "", cta: "", advertiser_name: null, advertiser_logo_url: null, sort_order: 1 },
    ];
    adVideoRows = [{ ad_creative_id: "c1", video_id: "v1", videos: READY("v1") }];
    const rows = await fetchAdCreatives("story-card" as never);
    expect(rows.find((r) => r.id === "c1")?.video?.id).toBe("v1");
    expect(rows.find((r) => r.id === "c2")?.video).toBeNull();
  });
});

describe("the ad slot (AdZone) and the ad page play it", () => {
  const zone = stripComments(readFileSync("src/components/ads/AdZone.tsx", "utf8"));
  it("one media value for the slot — own ads only, video only in the story card (review #412), never raw ad code", () => {
    expect(zone).toMatch(/const own = c\.mode === "own";/);
    expect(zone).toMatch(/const media = adMedia\(\{\s*video: own && zone === "story-card" \? chosen\?\.video \?\? null : null,\s*image_url: own && cr\.image_source !== "code" \? cr\.image_url : null,\s*\}\);/);
  });
  it("a video creative plays in the story card's own frame (fillParent), with the link as a TRACKED CTA bar under it", () => {
    expect(zone).toMatch(/c\.mode === "own" && media\.video &&/);
    expect(zone).toMatch(/onClick=\{handleClick\}\s*data-testid="ad-video-cta"/);
    expect(zone).toMatch(/<FeedVideoCard video=\{media\.video\} fillParent \/>/);
    expect(zone).toMatch(/data-testid="ad-video-cta"/);
  });
  it("the picture path draws media.imageUrls — empty for a video creative, so never both", () => {
    expect(zone).toMatch(/c\.mode === "own" && media\.imageUrls\.length > 0 &&/);
    expect(zone).not.toMatch(/src=\{cr\.image_url\}/);
  });
  it("the comments box gets the SAME media the card drew (Owner 2026-10-12: video in the card, still in the box)", () => {
    expect(zone).toMatch(/<AdEngagementBar creativeId=\{chosen\.id\} media=\{media\} \/>/);
  });
  it("the ad's own page plays the video too, picture as fallback", () => {
    const page = stripComments(readFileSync("src/pages/AdDetail.tsx", "utf8"));
    expect(page).toMatch(/fetchAdVideoMap\(\[creativeId\]\)/);
    expect(page).toMatch(/const media = adMedia\(creative\)/);
    expect(page).toMatch(/<FeedVideoCard video=\{media\.video\}/);
    expect(page).toMatch(/\{media\.imageUrls\.length > 0 &&/);
  });
});
