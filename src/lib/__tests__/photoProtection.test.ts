import { describe, it, expect } from "vitest";
import { fullScreenPhotoUrl, inlinePhotoUrl, photoDownloadAllowed } from "@/lib/photoProtection";

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4F = `${CDN}-w4000h3000-l4f.webp`;
const OLD = `${CDN}-w1920h1280-l3.webp`;
const PLAIN = `${CDN}-w1920h1280.webp`;

describe("photoDownloadAllowed (U3, decision 3)", () => {
  const base = { v2: true, inApp: false, competitionEntry: false, adminOrJudge: false };
  it("switch off → always today's answer (the caller's own rules decide)", () => {
    for (const inApp of [false, true]) for (const competitionEntry of [false, true]) for (const adminOrJudge of [false, true]) {
      expect(photoDownloadAllowed({ v2: false, inApp, competitionEntry, adminOrJudge })).toBe(true);
    }
  });
  it("switch on: members never; admin/judge only on competition entries; never in the app", () => {
    expect(photoDownloadAllowed(base)).toBe(false);
    expect(photoDownloadAllowed({ ...base, adminOrJudge: true })).toBe(false); // a post, even for an admin
    expect(photoDownloadAllowed({ ...base, competitionEntry: true })).toBe(false); // a member on an entry
    expect(photoDownloadAllowed({ ...base, competitionEntry: true, adminOrJudge: true })).toBe(true);
    expect(photoDownloadAllowed({ ...base, competitionEntry: true, adminOrJudge: true, inApp: true })).toBe(false);
  });
});

describe("fullScreenPhotoUrl / inlinePhotoUrl", () => {
  it("switch on: v2 photos → 2048 / 1080; -l4f never its full size", () => {
    expect(fullScreenPhotoUrl(L4, true)).toBe(L4);
    expect(fullScreenPhotoUrl(L4F, true)).toBe(`${CDN}-w4000h3000-l4f-r2048.webp`);
    expect(inlinePhotoUrl(L4, true)).toBe(`${CDN}-w2048h1365-l4-r1080.webp`);
    expect(inlinePhotoUrl(L4F, true)).toBe(`${CDN}-w4000h3000-l4f-r1080.webp`);
  });
  it("old photos and switch off: unchanged", () => {
    for (const u of [OLD, PLAIN]) { expect(fullScreenPhotoUrl(u, true)).toBe(u); expect(inlinePhotoUrl(u, true)).toBe(u); }
    for (const u of [L4, L4F, OLD]) { expect(fullScreenPhotoUrl(u, false)).toBe(u); expect(inlinePhotoUrl(u, false)).toBe(u); }
    expect(fullScreenPhotoUrl("", true)).toBe("");
  });
});
