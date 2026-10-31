/**
 * Owner order 2026-10-30 (#652): the "Upload Resume" switch lives in the
 * existing "Video Feature" admin menu group, directly after "Video Ads".
 * There is no separate "Uploads" group.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../AdminPanel.tsx"), "utf8");
const tabGroupsSrc = src.slice(src.indexOf("const tabGroups = ["), src.indexOf("];", src.indexOf("const tabGroups = [")));

/** Group label → its [route, label] items, read from the tabGroups source. */
function groups(): Map<string, Array<[string, string]>> {
  const out = new Map<string, Array<[string, string]>>();
  const re = /\{\s*label:\s*"([^"]+)",\s*items:\s*\[([\s\S]*?)\]\s*as const\s*\}/g;
  for (const m of tabGroupsSrc.matchAll(re)) {
    const items = [...m[2].matchAll(/\[\s*"([^"]+)",\s*"([^"]+)"/g)].map((i) => [i[1], i[2]] as [string, string]);
    out.set(m[1], items);
  }
  return out;
}

describe("Admin side menu · Video Feature group", () => {
  it("reads the tabGroups source", () => {
    expect(groups().size).toBeGreaterThan(5);
  });

  it("is Video Posts · Video Ads · Upload Resume · Copyright Music Check · Video Conversion", () => {
    expect(groups().get("Video Feature")).toEqual([
      ["video_posts", "Video Posts"],
      ["video_ads", "Video Ads"],
      ["upload_resume", "Upload Resume"],
      ["video_music_check", "Copyright Music Check"],
      ["video_conversion", "Video Conversion"],
    ]);
  });

  it("has no separate Uploads group, and upload_resume appears once", () => {
    expect(groups().has("Uploads")).toBe(false);
    const all = [...groups().values()].flat().filter(([r]) => r === "upload_resume");
    expect(all).toHaveLength(1);
  });

  it("still renders the photo_upload_resume switch on the upload_resume route", () => {
    expect(src).toMatch(/currentRoute === "upload_resume" && <LazyTab><AdminVideoFeature feature="photo_upload_resume" \/><\/LazyTab>/);
  });
});
