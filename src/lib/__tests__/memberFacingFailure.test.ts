/**
 * WHAT A MEMBER IS SHOWN WHEN SOMETHING FAILS.
 *
 * Owner rule: every error carries a code. Owner report, 2026-08-17: a member
 * trying to publish a photograph was shown
 *
 *     Could not publish
 *     Cannot read properties of undefined (reading 'rest')
 *
 * — a raw JavaScript exception, and no code to quote back. Both halves are
 * pinned here.
 */
import { describe, it, expect } from "vitest";
import { memberFacingFailure } from "@/lib/reportClientError";

describe("a failure a member can act on, and can report", () => {
  it("NEVER shows the exception that started all this", () => {
    const out = memberFacingFailure(
      new TypeError("Cannot read properties of undefined (reading 'rest')"),
      "DRAFT-2002",
    );
    expect(out).not.toContain("Cannot read properties");
    expect(out).not.toContain("undefined");
    expect(out).toContain("DRAFT-2002");
  });

  it("keeps a message the DATABASE wrote — those are written for people", () => {
    const out = memberFacingFailure(
      { message: "You are posting too quickly. Please wait a minute.", code: "P0001" },
      "DRAFT-2002",
    );
    expect(out).toContain("You are posting too quickly");
    expect(out).toContain("DRAFT-2002");
  });

  it("carries the code even when the error is empty or a bare string", () => {
    expect(memberFacingFailure(null, "DRAFT-2002")).toContain("DRAFT-2002");
    expect(memberFacingFailure({}, "POST-2001")).toContain("POST-2001");
    expect(memberFacingFailure(new Error(""), "POST-2001")).toContain("POST-2001");
  });

  it("recognises the other common shapes of a programming fault", () => {
    for (const m of [
      "x is not a function",
      "undefined is not an object",
      "Cannot read properties of null (reading 'id')",
      "foo is not defined",
      "obj is not iterable",
    ]) {
      const out = memberFacingFailure(new TypeError(m), "UI-8000");
      expect(out, m).toContain("Something went wrong on our side");
      expect(out, m).toContain("UI-8000");
    }
  });

  it("tells the member nothing was lost — because with a draft, nothing is", () => {
    const out = memberFacingFailure(new TypeError("boom of undefined"), "DRAFT-2002");
    expect(out).toMatch(/nothing was lost/i);
  });
});
