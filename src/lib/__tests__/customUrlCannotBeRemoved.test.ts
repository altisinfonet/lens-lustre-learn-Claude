import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCustomUrlValue } from "@/lib/customUrlRules";

/**
 * EVERY MEMBER HAS A PROFILE URL. HAVE NONE MUST BE ZERO.
 *
 * The Owner's rule here is not the once-a-year one — that governs CHANGING a
 * handle. This is the stronger one underneath it: nobody may be without one.
 *
 * A member-callable clear is a control that manufactures the forbidden state on
 * demand, and after F-92 and F-95 it is worse than it used to be. There is no
 * id address left to fall back on: a member with no handle has no reachable
 * profile URL at all, and their name renders as plain text everywhere it
 * appears — which is the branch this same work introduced. Clearing does not
 * give a member privacy. It makes them unreachable.
 *
 * So the form refuses an empty field BEFORE any request is made. The refusal is
 * the point: the member is told what they can do, and nothing is sent that
 * could half-succeed.
 */
const RESERVED = ["admin", "login"] as const;

describe("the profile URL field will not accept being emptied", () => {
  it.each([[""], ["   "], ["\t"], ["\n  \n"]])(
    "refuses %j with a message the member can act on",
    (value) => {
      const err = validateCustomUrlValue(value, RESERVED);
      expect(err, "an empty profile URL must be refused, not accepted").not.toBe("");
      // It has to say what they CAN do, not only what they cannot.
      expect(err.toLowerCase()).toMatch(/change/);
      // And it must not leak the machinery.
      expect(err.toLowerCase()).not.toMatch(/rpc|permission|denied|error|failed|database|function/);
    },
  );

  it("still accepts a real URL, so the refusal is not just a blanket no", () => {
    expect(validateCustomUrlValue("avijit.sheel", RESERVED)).toBe("");
  });

  it("keeps every rule it already had", () => {
    expect(validateCustomUrlValue("ab", RESERVED)).toMatch(/3 characters/);
    expect(validateCustomUrlValue("x".repeat(51), RESERVED)).toMatch(/50 characters/);
    expect(validateCustomUrlValue("has space", RESERVED)).toMatch(/letters, numbers/);
    expect(validateCustomUrlValue("admin", RESERVED)).toMatch(/reserved/i);
  });
});

describe("the client never calls clear_custom_url", () => {
  const src = readFileSync(join(process.cwd(), "src/pages/EditProfile.tsx"), "utf8")
    // Comments stripped: this rule has to be explained in the file it governs.
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("EditProfile does not invoke it", () => {
    expect(src).not.toContain("clear_custom_url");
  });

  it("no other file in src invokes it either", async () => {
    const { execSync } = await import("node:child_process");
    /*
     * The needle is ASSEMBLED rather than written out, because this file would
     * otherwise match itself: the first run reported a hit that was its own
     * source line. Splitting it is better than excluding this path from the
     * search — an exclusion would also hide a real call that happened to live
     * near it, and a self-match is a false RED, which is the safe direction but
     * still a lie about what the tree contains.
     *
     * The generated types entry is a type declaration, not a call, and stays:
     * the function still exists as a privileged action, it is simply not the
     * client's to invoke.
     */
    const needle = 'rpc("clear' + "_custom_url";
    const hits = execSync(`grep -rl '${needle}' src || true`, {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((f) => !f.endsWith("customUrlCannotBeRemoved.test.ts"));
    expect(hits, `still called from: ${hits.join(", ")}`).toEqual([]);
  });
});
