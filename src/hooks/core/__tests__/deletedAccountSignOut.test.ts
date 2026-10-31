/**
 * A DELETED ACCOUNT MUST BE SIGNED OUT. PINNED.
 *
 * Owner report, 2026-08-06: *"neilbasu.ramt@gmail.com was deleted from admin
 * after that he is activated on product and doing comments too. Once deleted
 * from admin or account deleted by user instant log off from all devices …
 * is not working. major security bug."*
 *
 * Measured against production during the investigation:
 *   * auth.users AND profiles both returned 0 rows for that e-mail — the
 *     deletion itself worked completely.
 *   * 0 orphaned comment authors table-wide, and 0 comments written anywhere in
 *     the two-hour window around the screenshots — NOTHING was written.
 *   * Access token expiry is 3600s, and deleting a user does not revoke an
 *     already-issued JWT.
 *
 * So the account was gone and the session simply never found out. Two separate
 * defects kept it alive, and each is pinned below. Both assertions fail against
 * main at 327f494.
 *
 * These are SOURCE PINS, the same technique as loggingStandard.test.ts. A
 * behavioural test would need the whole Supabase auth + realtime surface
 * mocked; what actually broke here was two specific lines, and lines are what
 * these guard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/** Read useAuth.tsx with comments stripped, so a quoted rule is never mistaken for code. */
const src = () =>
  readFileSync(join(__dirname, "..", "useAuth.tsx"), "utf8")
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("a deleted account must not stay signed in", () => {
  /**
   * DEFECT 1 — the restriction check failed open.
   *
   * `if (error || !data) return false;` treats "the lookup failed" and "the row
   * does not exist" as the same thing. They are opposites: the first is
   * transient and must NOT sign anyone out; the second means the account is
   * gone and must.
   */
  it("never treats a missing profile row the same as a failed lookup", () => {
    const code = src();
    expect(
      code,
      "the combined fail-open branch is back — a deleted account will stay signed in",
    ).not.toMatch(/if\s*\(\s*error\s*\|\|\s*!data\s*\)\s*return\s+false\s*;/);
  });

  it("signs the member out when their profile row is gone", () => {
    const code = src();
    // A missing row must resolve to `true` (restricted → sign out), and must be
    // reported with its own code so it is never invisible again.
    expect(code, "there must be a dedicated !data branch").toMatch(/if\s*\(\s*!data\s*\)\s*\{/);
    expect(code).toContain("AUTH-1005");
    expect(code).toContain("ACCOUNT_NO_LONGER_EXISTS");
  });

  it("keeps a member signed in when the lookup merely failed", () => {
    const code = src();
    // The transient case must still return false. Signing members out over a
    // dropped request would be a worse bug than the one being fixed.
    expect(code, "the error branch must still keep the member signed in").toMatch(
      /if\s*\(\s*error\s*\)\s*\{[\s\S]*?return\s+false\s*;[\s\S]*?\}/,
    );
  });

  /**
   * DEFECT 2 — the realtime guard could not see a deletion.
   *
   * It subscribed to `event: "UPDATE"` on profiles, which catches a ban and a
   * suspension and is blind to a DELETE. Verified before changing it that
   * supabase_realtime has pubdelete = true, publishes profiles, and that
   * profiles has REPLICA IDENTITY FULL — so a DELETE reaches the client AND the
   * id filter still matches.
   */
  it("the realtime guard listens for deletions, not only updates", () => {
    const code = src();
    expect(
      code,
      "the guard is UPDATE-only again — a deletion will not eject the session",
    ).not.toMatch(/event:\s*"UPDATE"/);
    expect(code, "the profiles guard must subscribe to all events").toMatch(/event:\s*"\*"/);
  });

  it("a realtime DELETE ends the session immediately", () => {
    const code = src();
    expect(code).toMatch(/payload\.eventType\s*===\s*"DELETE"/);
    expect(code).toContain("ACCOUNT_DELETED_WHILE_SIGNED_IN");
    // The DELETE branch must actually trigger the sign-out effect.
    const deleteBranch = code.match(/if\s*\(payload\.eventType\s*===\s*"DELETE"\)\s*\{[\s\S]*?\n\s{12}\}/);
    expect(deleteBranch, "no DELETE branch found").toBeTruthy();
    expect(deleteBranch![0]).toContain("setAccountRestricted(true)");
  });

  it("the member is told what happened, not just ejected", () => {
    const code = src();
    // Owner rule: an error message must tell the member what happened. A silent
    // logout is indistinguishable from the app breaking.
    const messages = [...code.matchAll(/sessionStorage\.setItem\(\s*"suspension_message",\s*([\s\S]*?)\)/g)];
    expect(messages.length, "no member-facing message on sign-out").toBeGreaterThanOrEqual(2);
    expect(code).toContain("This account has been removed");
  });

  it("INSERT events are ignored — there is no prior state to compare", () => {
    const code = src();
    // Widening to "*" means INSERT arrives too. The ban/suspension logic reads
    // payload.old, which an INSERT does not have.
    expect(code).toMatch(/payload\.eventType\s*!==\s*"UPDATE"\s*\)\s*return\s*;/);
  });
});
