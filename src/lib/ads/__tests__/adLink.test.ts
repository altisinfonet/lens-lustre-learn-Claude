/** Bug 4 — an ad's link is a full https:// address, or it is no link at all. */
import { describe, it, expect } from "vitest";
import { adLink, adLinkProblem, adLinkHost, AD_LINK_MESSAGE } from "@/lib/ads/adLink";

describe("adLink", () => {
  it("accepts a full https address", () => {
    expect(adLink(" https://www.hideaway-resort.com/rooms ")).toBe("https://www.hideaway-resort.com/rooms");
    expect(adLinkHost("https://www.hideaway-resort.com/rooms")).toBe("hideaway-resort.com");
  });
  it.each(["Hideaway Resort and Hotel", "hideaway.com", "http://hideaway.com", "javascript:alert(1)", "https://localhost", "https://Hideaway Resort", "", null, undefined])(
    "refuses %s",
    (v) => expect(adLink(v as string)).toBeNull(),
  );
  it("the admin box: empty or valid saves, anything else says why", () => {
    expect(adLinkProblem("")).toBeNull();
    expect(adLinkProblem("https://hideaway.com")).toBeNull();
    expect(adLinkProblem("Hideaway Resort and Hotel")).toBe(AD_LINK_MESSAGE);
    expect(AD_LINK_MESSAGE).toMatch(/https:\/\//);
  });
});
