/**
 * Photo plan U4 · "Save mobile data" + video start level (decision 6) and the
 * feed's 1080 srcset follow-up (U3 review: "feed keeps 1080").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAVE_MOBILE_DATA_KEY, getLinkKind, getSaveMobileData, linkKindOf, resetDataSaver, savingDataNow, setSaveMobileData, subscribeDataSaver,
} from "@/lib/dataSaver";
import { feedPhotoSet, fullScreenPhotoUrl, inlinePhotoUrl } from "@/lib/photoProtection";
import { videoStartPlan } from "@/lib/video/playback";

const CDN = "https://cdn-staging.50mmretina.com/post-images/u1/posts/1762000000000-abc";
const L4 = `${CDN}-w2048h1365-l4.webp`;
const L4F = `${CDN}-w4000h3000-l4f.webp`;
const L4_SMALL = `${CDN}-w900h600-l4.webp`;
const L4_TINY = `${CDN}-w500h400-l4.webp`;
const OLD = `${CDN}-w1920h1280-l3.webp`;
const PLAIN = `${CDN}-w1920h1280.webp`;

function setConnection(type: string | undefined) {
  Object.defineProperty(globalThis.navigator, "connection", { configurable: true, value: type === undefined ? undefined : { type } });
}

describe("dataSaver setting (per device)", () => {
  beforeEach(() => { localStorage.clear(); resetDataSaver(); setConnection(undefined); });
  afterEach(() => { setConnection(undefined); });

  it("defaults to off, remembers on/off on this device and notifies", () => {
    expect(getSaveMobileData()).toBe(false);
    let n = 0;
    const off = subscribeDataSaver(() => { n++; });
    setSaveMobileData(true);
    expect(getSaveMobileData()).toBe(true);
    expect(localStorage.getItem(SAVE_MOBILE_DATA_KEY)).toBe("on");
    resetDataSaver();
    expect(getSaveMobileData()).toBe(true); // read back from storage
    setSaveMobileData(false);
    expect(n).toBe(2);
    off();
    setSaveMobileData(true);
    expect(n).toBe(2);
  });

  it("blocked storage → off, and a choice still holds in memory", () => {
    const orig = Storage.prototype.getItem;
    const origSet = Storage.prototype.setItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    Storage.prototype.setItem = () => { throw new Error("blocked"); };
    try {
      resetDataSaver();
      expect(getSaveMobileData()).toBe(false);
      setSaveMobileData(true);
      expect(getSaveMobileData()).toBe(true);
    } finally { Storage.prototype.getItem = orig; Storage.prototype.setItem = origSet; }
  });

  it("link kind: Wi-Fi / cable = wifi, cellular = mobile, anything unnamed = unknown", () => {
    expect(linkKindOf("wifi")).toBe("wifi");
    expect(linkKindOf("ethernet")).toBe("wifi");
    expect(linkKindOf("cellular")).toBe("mobile");
    expect(linkKindOf(undefined)).toBe("unknown");
    expect(linkKindOf("other")).toBe("unknown");
    setConnection("cellular");
    expect(getLinkKind()).toBe("mobile");
  });

  it("saves only with the setting on, and never on a link named Wi-Fi (unknown counts as maybe mobile)", () => {
    expect(savingDataNow(false, "mobile")).toBe(false);
    expect(savingDataNow(true, "wifi")).toBe(false);
    expect(savingDataNow(true, "mobile")).toBe(true);
    expect(savingDataNow(true, "unknown")).toBe(true);
  });
});

describe("one size down (switch on + saving)", () => {
  it("full screen 2048 → 1080; inline 1080 → 600; old photos and switch off unchanged", () => {
    expect(fullScreenPhotoUrl(L4, true, true)).toBe(`${CDN}-w2048h1365-l4-r1080.webp`);
    expect(fullScreenPhotoUrl(L4F, true, true)).toBe(`${CDN}-w4000h3000-l4f-r1080.webp`);
    expect(inlinePhotoUrl(L4, true, true)).toBe(`${CDN}-w2048h1365-l4-thumb.webp`);
    for (const u of [OLD, PLAIN]) { expect(fullScreenPhotoUrl(u, true, true)).toBe(u); expect(inlinePhotoUrl(u, true, true)).toBe(u); }
    expect(fullScreenPhotoUrl(L4, false, true)).toBe(L4);
    expect(inlinePhotoUrl(L4, false, true)).toBe(L4);
    // not saving: U3's answers, unchanged
    expect(fullScreenPhotoUrl(L4, true, false)).toBe(L4);
    expect(inlinePhotoUrl(L4, true, false)).toBe(`${CDN}-w2048h1365-l4-r1080.webp`);
  });
});

describe("feedPhotoSet — the feed keeps 1080 (never the 2048 or a full size)", () => {
  it("-l4: 600 + 1080, src = 1080", () => {
    expect(feedPhotoSet(L4, false)).toEqual({
      src: `${CDN}-w2048h1365-l4-r1080.webp`,
      srcSet: `${CDN}-w2048h1365-l4-thumb.webp 600w, ${CDN}-w2048h1365-l4-r1080.webp 1080w`,
    });
  });
  it("-l4f: never the full-size file", () => {
    const s = feedPhotoSet(L4F, false)!;
    expect(s.src).toBe(`${CDN}-w4000h3000-l4f-r1080.webp`);
    expect(s.srcSet).toBe(`${CDN}-w4000h3000-l4f-thumb.webp 600w, ${CDN}-w4000h3000-l4f-r1080.webp 1080w`);
    expect(s.srcSet).not.toMatch(/l4f\.webp/);
  });
  it("portrait widths are scaled from the long edge", () => {
    const P = `${CDN}-w1365h2048-l4.webp`;
    expect(feedPhotoSet(P, false)!.srcSet).toBe(`${CDN}-w1365h2048-l4-thumb.webp 400w, ${CDN}-w1365h2048-l4-r1080.webp 720w`);
  });
  it("small photos: no 1080 copy exists → the photo itself; tiny → one entry", () => {
    expect(feedPhotoSet(L4_SMALL, false)).toEqual({
      src: L4_SMALL,
      srcSet: `${CDN}-w900h600-l4-thumb.webp 600w, ${L4_SMALL} 900w`,
    });
    expect(feedPhotoSet(L4_TINY, false)).toEqual({ src: `${CDN}-w500h400-l4-thumb.webp`, srcSet: `${CDN}-w500h400-l4-thumb.webp 500w` });
  });
  it("saving: one size down → the 600 copy only", () => {
    expect(feedPhotoSet(L4, true)).toEqual({ src: `${CDN}-w2048h1365-l4-thumb.webp`, srcSet: `${CDN}-w2048h1365-l4-thumb.webp 600w` });
  });
  it("old / unmarked photos → null (today's srcset stays)", () => {
    expect(feedPhotoSet(OLD, false)).toBeNull();
    expect(feedPhotoSet(PLAIN, true)).toBeNull();
  });
});

describe("videoStartPlan — 240/480p on mobile data, 720p on Wi-Fi", () => {
  const full = [{ height: 240, bitrate: 300_000 }, { height: 480, bitrate: 900_000 }, { height: 720, bitrate: 2_000_000 }];
  const two = [{ height: 240, bitrate: 300_000 }, { height: 480, bitrate: 900_000 }];
  it("Wi-Fi → starts on 720p, no cap", () => {
    expect(videoStartPlan(full, { slow: false, saving: false, kind: "wifi" })).toEqual({ start: 2, cap: -1 });
  });
  it("mobile data → starts on 480p, ABR free to move", () => {
    expect(videoStartPlan(full, { slow: false, saving: false, kind: "mobile" })).toEqual({ start: 1, cap: -1 });
  });
  it("a device that cannot say → 480p (the cautious start)", () => {
    expect(videoStartPlan(full, { slow: false, saving: false, kind: "unknown" })).toEqual({ start: 1, cap: -1 });
  });
  it("Save mobile data → starts on 240p and never above 480p", () => {
    expect(videoStartPlan(full, { slow: false, saving: true, kind: "mobile" })).toEqual({ start: 0, cap: 1 });
  });
  it("slow network → 240p only (today's rule, kept)", () => {
    expect(videoStartPlan(full, { slow: true, saving: false, kind: "wifi" })).toEqual({ start: 0, cap: 0 });
    expect(videoStartPlan(full, { slow: true, saving: true, kind: "mobile" })).toEqual({ start: 0, cap: 0 });
  });
  it("a video without 720p on Wi-Fi starts on its best (480p); levels out of order are read by height", () => {
    expect(videoStartPlan(two, { slow: false, saving: false, kind: "wifi" })).toEqual({ start: 1, cap: -1 });
    const shuffled = [full[2], full[0], full[1]];
    expect(videoStartPlan(shuffled, { slow: false, saving: false, kind: "mobile" })).toEqual({ start: 2, cap: -1 });
  });
  it("no levels → hls.js defaults", () => {
    expect(videoStartPlan([], { slow: false, saving: false, kind: "wifi" })).toEqual({ start: -1, cap: -1 });
  });
});
