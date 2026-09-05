import { describe, it, expect } from "vitest";
import { ordinalSuffix, changeRefusalMessage } from "@/lib/customUrlChangeWindow";

/**
 * THE OWNER LOCKED THIS TEXT AND HAS TWICE SAID NO MORE WORDS.
 *
 *     Can’t change until 31st Dec 2027.
 *
 * One line. Nothing before it, nothing after it. No title, no prefix, no
 * "Failed to update custom URL", no toast wrapping it in the words he removed.
 * So it is asserted CHARACTER FOR CHARACTER rather than by matching a pattern —
 * a regex would let the sentence drift back towards a paragraph.
 *
 * THE DATE IS COMPOSED HERE, NOT IN THE DATABASE, AND THAT IS THE POINT. The
 * RPC returns next_change_at as a raw ISO timestamptz; the sentence is built
 * from it IN THE MEMBER'S OWN TIMEZONE. Rendered in UTC, a member in India
 * whose window opens at 23:00 UTC on 31 Dec 2027 would be told "31st Dec 2027",
 * try on the 31st in their own calendar, and be refused on the exact date the
 * site told them to come back — the unlock instant is 04:30 on 1 Jan where they
 * live. The whole promise of the sentence is that the date shown is the day it
 * works.
 */
const APOSTROPHE = "’"; // ’ RIGHT SINGLE QUOTATION MARK — ONE character.

describe("the refusal sentence, exactly as the Owner wrote it", () => {
  it("is that sentence and nothing else", () => {
    expect(changeRefusalMessage("2027-12-31T09:00:00Z", "UTC")).toBe(
      "Can’t change until 31st Dec 2027.",
    );
  });

  it("uses a single typographic apostrophe, not an escape or a pair of characters", () => {
    const msg = changeRefusalMessage("2027-12-31T09:00:00Z", "UTC");
    expect(msg.slice(0, 5)).toBe(`Can${APOSTROPHE}t`);
    expect(msg.charCodeAt(3)).toBe(0x2019);
    expect(msg).not.toContain("&#39;");
    expect(msg).not.toContain("'");
  });

  it("carries no title, prefix, suffix or second sentence", () => {
    const msg = changeRefusalMessage("2027-12-31T09:00:00Z", "UTC");
    expect(msg.split(".").filter(Boolean)).toHaveLength(1);
    expect(msg.toLowerCase()).not.toContain("failed");
    expect(msg.toLowerCase()).not.toContain("error");
    expect(msg.toLowerCase()).not.toContain("url");
    expect(msg.startsWith("Can")).toBe(true);
    expect(msg.endsWith("2027.")).toBe(true);
  });
});

describe("the ordinal, where this always breaks", () => {
  it.each([
    [1, "st"], [2, "nd"], [3, "rd"], [4, "th"],
    [11, "th"], [12, "th"], [13, "th"],
    [21, "st"], [22, "nd"], [23, "rd"], [24, "th"],
    [31, "st"],
  ])("%i takes %s", (day, suffix) => {
    expect(ordinalSuffix(day)).toBe(suffix);
  });

  it("11th, 12th and 13th are th — not st, nd, rd", () => {
    // The whole reason this function exists rather than a % 10 switch.
    for (const [iso, expected] of [
      ["2027-12-11T09:00:00Z", "Can’t change until 11th Dec 2027."],
      ["2027-12-12T09:00:00Z", "Can’t change until 12th Dec 2027."],
      ["2027-12-13T09:00:00Z", "Can’t change until 13th Dec 2027."],
    ] as const) {
      expect(changeRefusalMessage(iso, "UTC")).toBe(expected);
    }
  });
});

describe("THE MEMBER'S OWN TIMEZONE — the reason this moved to the client", () => {
  /**
   * 23:00 UTC on 31 Dec 2027 is 04:30 on 1 Jan 2028 in Asia/Kolkata (+05:30).
   * A member there must be told 1st Jan 2028, because that is the day it works
   * for them. Told "31st Dec 2027" they would try on their 31st and be refused.
   */
  const AT = "2027-12-31T23:00:00Z";

  it("Asia/Kolkata is told the day it actually unlocks for them", () => {
    expect(changeRefusalMessage(AT, "Asia/Kolkata")).toBe(
      "Can’t change until 1st Jan 2028.",
    );
  });

  it("UTC is told its own day, and the two genuinely differ", () => {
    expect(changeRefusalMessage(AT, "UTC")).toBe("Can’t change until 31st Dec 2027.");
    expect(changeRefusalMessage(AT, "UTC")).not.toBe(changeRefusalMessage(AT, "Asia/Kolkata"));
  });

  it("a zone behind UTC moves the other way", () => {
    // 01:00 UTC on 1 Jan 2028 is 20:00 on 31 Dec 2027 in America/New_York.
    expect(changeRefusalMessage("2028-01-01T01:00:00Z", "America/New_York")).toBe(
      "Can’t change until 31st Dec 2027.",
    );
  });
});

describe("the form shows the sentence and nothing around it", () => {
  const src = () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    return readFileSync(join(process.cwd(), "src/pages/EditProfile.tsx"), "utf8")
      // Comments stripped: the rule has to be explained in the file it governs,
      // and a naive search cannot tell an explanation from a violation.
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  };

  it("no toast wraps a profile-URL refusal", () => {
    // The toast was titled t("ep.urlError") and prefixed "Failed to update
    // custom URL" — the exact words the Owner removed, put straight back.
    const s = src();
    expect(s).not.toContain("ep.urlError");
    expect(s).not.toContain("Failed to update custom URL");
  });

  it("the refusal is composed from the timestamp, not hardcoded", () => {
    const s = src();
    expect(s).toContain("changeRefusalMessage(");
    // A literal date in the page would be right for one member and wrong for
    // everyone whose window opens on another day.
    expect(s).not.toMatch(/Can.t change until \d/);
  });
});
