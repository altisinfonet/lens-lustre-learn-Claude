import { describe, expect, it, vi, beforeEach } from "vitest";

const readState = vi.fn();
vi.mock("@/lib/siteSettingsCache", () => ({ readSiteSettingState: (...a: unknown[]) => readState(...a) }));

import {
  FIRST_POST_NUDGE_KEY,
  firstPostComposeUrl,
  firstPostNudgeOn,
  isFirstPostNudgeOn,
  isSlugShaped,
  putFirstPostFiles,
  shouldOfferFirstPostStep,
  takeFirstPostFiles,
} from "@/lib/firstPost/firstPostNudge";

beforeEach(() => readState.mockReset());

describe("first_post_nudge switch — absent/off = today's behaviour", () => {
  it("only the exact value \"on\" is on", () => {
    expect(isFirstPostNudgeOn("on")).toBe(true);
    for (const v of [null, undefined, "off", "ON", true, 1, { on: true }, ""]) expect(isFirstPostNudgeOn(v)).toBe(false);
  });

  it("reads the site_settings key first_post_nudge", async () => {
    readState.mockResolvedValue({ known: true, value: "on" });
    await expect(firstPostNudgeOn()).resolves.toBe(true);
    expect(readState).toHaveBeenCalledWith(FIRST_POST_NUDGE_KEY, { maxAgeMs: 60_000 });
    expect(FIRST_POST_NUDGE_KEY).toBe("first_post_nudge");
  });

  it("no row, an unreadable setting or a throw all read as off", async () => {
    readState.mockResolvedValueOnce({ known: true, value: null });
    await expect(firstPostNudgeOn()).resolves.toBe(false);
    readState.mockResolvedValueOnce({ known: false, value: null });
    await expect(firstPostNudgeOn()).resolves.toBe(false);
    readState.mockRejectedValueOnce(new Error("offline"));
    await expect(firstPostNudgeOn()).resolves.toBe(false);
  });
});

describe("the step is offered only to a first-time member, only when on", () => {
  it("switch OFF → never offered (nothing changes for anyone)", async () => {
    await expect(shouldOfferFirstPostStep(false, async () => false)).resolves.toBe(false);
    await expect(shouldOfferFirstPostStep(true, async () => false)).resolves.toBe(false);
  });
  it("switch ON → offered to a new member, not to one who had completed the form before", async () => {
    await expect(shouldOfferFirstPostStep(false, async () => true)).resolves.toBe(true);
    await expect(shouldOfferFirstPostStep(true, async () => true)).resolves.toBe(false);
  });
  it("a failing switch read is off", async () => {
    await expect(shouldOfferFirstPostStep(false, async () => { throw new Error("x"); })).resolves.toBe(false);
  });
});

describe("composer link and hand-off", () => {
  it("opens the normal post flow (?compose=1), category and hand-off optional", () => {
    expect(firstPostComposeUrl()).toBe("/feed?compose=1");
    expect(firstPostComposeUrl({ category: "street" })).toBe("/feed?compose=1&cat=street");
    expect(firstPostComposeUrl({ category: "street", handoff: true })).toBe("/feed?compose=1&cat=street&first=1");
  });
  it("slug shape", () => {
    expect(isSlugShaped("street")).toBe(true);
    expect(isSlugShaped("black_and_white")).toBe(true);
    expect(isSlugShaped("Street")).toBe(false);
    expect(isSlugShaped("a b")).toBe(false);
    expect(isSlugShaped("../x")).toBe(false);
    expect(isSlugShaped(null)).toBe(false);
  });
  it("hands photos over once, at most 10", () => {
    const files = Array.from({ length: 12 }, (_, i) => new File(["x"], `p${i}.jpg`, { type: "image/jpeg" }));
    putFirstPostFiles(files);
    expect(takeFirstPostFiles()).toHaveLength(10);
    expect(takeFirstPostFiles()).toHaveLength(0);
  });
});
