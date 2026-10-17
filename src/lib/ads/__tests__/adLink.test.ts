/**
 * Bug 4: an ad's link is a web address, or it is no link at all.
 *
 * Review fix round (17 Oct 2026, Owner: "the same as Meta"): Meta Ads Manager
 * takes https:// AND http://, and a bare "site.com" / "www.site.com" is read as
 * https://site.com. So "hideaway.com" and "http://hideaway.com", refused by the
 * first version of this rule, now open, and are asserted with their exact href
 * below. Everything else that was refused still is, plus the shapes a link can
 * hide in.
 */
import { describe, it, expect } from "vitest";
import { adLink, adLinkProblem, adLinkHost, adLinkToSave, AD_LINK_MESSAGE, AD_LINK_STORED_WARNING } from "@/lib/ads/adLink";

describe("adLink", () => {
  it("accepts a full https address", () => {
    expect(adLink(" https://www.hideaway-resort.com/rooms ")).toBe("https://www.hideaway-resort.com/rooms");
    expect(adLinkHost("https://www.hideaway-resort.com/rooms")).toBe("hideaway-resort.com");
  });
  it.each([
    ["http://hideaway.com", "http://hideaway.com/"],
    ["HTTP://Hideaway.com/rooms", "http://hideaway.com/rooms"],
    ["hideaway.com", "https://hideaway.com/"],
    ["www.hideaway-resort.com", "https://www.hideaway-resort.com/"],
    ["www.hideaway-resort.com/rooms?x=1#top", "https://www.hideaway-resort.com/rooms?x=1#top"],
    ["hideaway.com:8443/book", "https://hideaway.com:8443/book"],
    [" https://hideaway.com﻿", "https://hideaway.com/"],
    ["https://аpple.com", "https://xn--pple-43d.com/"],
  ])("Meta rule: %s opens %s", (raw, href) => expect(adLink(raw)).toBe(href));
  it.each([
    "Hideaway Resort and Hotel", "hideaway", "javascript:alert(1)", "https://localhost", "https://Hideaway Resort", "", null, undefined,
    // plain text / spaces
    "Hideaway Resort.com", "www.hideaway .com",
    // user@host, and userinfo hiding the real host
    "user@hideaway.com", "https://hideaway.com@evil.com", "https://user:pw@hideaway.com",
    // other schemes, and a scheme-relative //host
    "JavaScript:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "mailto:a@hideaway.com", "ftp://hideaway.com", "//evil.com", "///evil.com",
    // whitespace / unicode tricks inside the address
    "​javascript:alert(1)", "https://hideaway.com​/", "https://hide‮away.com", "https://hideaway.com/\tpath", "https://hide\naway.com", "https:\\evil.com", "https:/\evil.com", "hideaway.com\@evil.com",
    // no real host
    "https://.com", "https://a..com", "https://hideaway.",
  ])("refuses %s", (v) => expect(adLink(v as string)).toBeNull());
  it("the href is built from the parsed URL, never the raw string", () => {
    expect(adLink('hideaway.com/"><script>')).toBe("https://hideaway.com/%22%3E%3Cscript%3E");
  });
  it("the admin box: empty or valid saves, anything else says why", () => {
    expect(adLinkProblem("")).toBeNull();
    expect(adLinkProblem("https://hideaway.com")).toBeNull();
    expect(adLinkProblem("http://hideaway.com")).toBeNull();
    expect(adLinkProblem("www.hideaway.com")).toBeNull();
    expect(adLinkProblem("Hideaway Resort and Hotel")).toBe(AD_LINK_MESSAGE);
    expect(AD_LINK_MESSAGE).toMatch(/https:\/\//);
    expect(AD_LINK_MESSAGE).toMatch(/www\./);
  });
  it("the admin saves the parsed address: a bare site.com is stored as https://site.com/", () => {
    expect(adLinkToSave("  www.hideaway.com ")).toBe("https://www.hideaway.com/");
    expect(adLinkToSave("http://hideaway.com")).toBe("http://hideaway.com/");
    expect(adLinkToSave("   ")).toBe("");
  });
  it("an ad saved with a bad link is told so, in the Owner's words", () => {
    expect(AD_LINK_STORED_WARNING).toBe("This ad has no valid website, so no button shows — add a link");
  });
});
