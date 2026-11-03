import { describe, it, expect } from "vitest";
import { fullScreenPhoto, inlinePhotoUrl, photoDownloadAllowed } from "@/lib/photoProtection";

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4F = `${CDN}-w4000h3000-l4f.webp`;
const OLD = `${CDN}-w1920h1280-l3.webp`;
const PLAIN = `${CDN}-w1920h1280.webp`;

describe("photoDownloadAllowed (decision 3; Unit B: policy, no switch input at all)", () => {
  const base = { inApp: false, competitionEntry: false, adminOrJudge: false };
  it("takes no switch: the answer depends only on app / entry / role", () => {
    expect(Object.keys(base).sort()).toEqual(["adminOrJudge", "competitionEntry", "inApp"]);
  });
  it("members never; admin/judge only on competition entries; never in the app", () => {
    expect(photoDownloadAllowed(base)).toBe(false);
    expect(photoDownloadAllowed({ ...base, adminOrJudge: true })).toBe(false); // a post, even for an admin
    expect(photoDownloadAllowed({ ...base, competitionEntry: true })).toBe(false); // a member on an entry
    expect(photoDownloadAllowed({ ...base, competitionEntry: true, adminOrJudge: true })).toBe(true);
    expect(photoDownloadAllowed({ ...base, competitionEntry: true, adminOrJudge: true, inApp: true })).toBe(false);
  });
});

describe("fullScreenPhoto / inlinePhotoUrl (Unit A: the copy is chosen by the file, for every viewer)", () => {
  const L5 = `${CDN}-w1080h720-l5.webp`;
  const L5F = `${CDN}-w4000h3000-l5f.webp`;
  it("full screen PAINTS a clean copy; the context-menu file is the credited 2048; never a full size", () => {
    expect(fullScreenPhoto(L4)).toEqual({ shown: `${CDN}-w2048h1365-l4-r1080.webp`, saveAs: L4 });
    expect(fullScreenPhoto(L4F)).toEqual({ shown: `${CDN}-w4000h3000-l4f-r1080.webp`, saveAs: `${CDN}-w4000h3000-l4f-r2048.webp` });
    expect(fullScreenPhoto(L5)).toEqual({ shown: L5, saveAs: `${CDN}-w1080h720-l5-r2048c.webp` });
    expect(fullScreenPhoto(L5F)).toEqual({ shown: `${CDN}-w4000h3000-l5f-r1080.webp`, saveAs: `${CDN}-w4000h3000-l5f-r2048c.webp` });
  });
  it("inline: the clean 1080 for every viewer", () => {
    for (const v2 of [true, false]) {
      expect(inlinePhotoUrl(L4, v2)).toBe(`${CDN}-w2048h1365-l4-r1080.webp`);
      expect(inlinePhotoUrl(L4F, v2)).toBe(`${CDN}-w4000h3000-l4f-r1080.webp`);
      expect(inlinePhotoUrl(L5, v2)).toBe(L5);
    }
  });
  it("old photos: unchanged, no credited layer", () => {
    for (const u of [OLD, PLAIN]) { expect(fullScreenPhoto(u)).toEqual({ shown: u, saveAs: null }); expect(inlinePhotoUrl(u, true)).toBe(u); expect(inlinePhotoUrl(u, false)).toBe(u); }
    expect(fullScreenPhoto("")).toEqual({ shown: "", saveAs: null });
  });
});
