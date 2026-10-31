/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ALLOW-LIST WAS MATCHED BY A PREFIX THE ATTACKER CHOOSES.
 *
 * `ALLOWED_ORIGINS.some(o => requestOrigin.startsWith(o))` accepts anything
 * that BEGINS with an allowed origin, and registering such a domain costs a few
 * dollars. Measured against the implementation this replaces:
 *
 *   ALLOWED  https://50mmretina.com.evil.example
 *   ALLOWED  https://50mmretina.com.attacker.net
 *   ALLOWED  https://www.50mmretina.com.evil.io
 *   blocked  https://staging.50mmretina.com      <- the only legitimate one
 *
 * Each of those got Access-Control-Allow-Origin echoed back, in front of
 * credentials-bearing endpoints; the one origin the lane work exists to serve
 * was refused. Both halves were wrong in the same line.
 *
 * These tests pin equality. A refactor back to startsWith/endsWith fails here
 * naming the attacker host, rather than passing quietly.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, afterEach } from "vitest";
import { isOriginAllowed } from "../../supabase/functions/_shared/secureHeaders";

/** SITE_ORIGIN reaches the module through globalThis.Deno, as it does on Deno. */
function setLaneOrigin(value: string | undefined): void {
  const g = globalThis as { Deno?: { env: { get(k: string): string | undefined } } };
  if (value === undefined) {
    delete g.Deno;
    return;
  }
  g.Deno = { env: { get: (k: string) => (k === "SITE_ORIGIN" ? value : undefined) } };
}

afterEach(() => setLaneOrigin(undefined));

describe("isOriginAllowed", () => {
  it("allows the production origins", () => {
    for (const o of ["https://50mmretina.com", "https://www.50mmretina.com"]) {
      expect(isOriginAllowed(o), o).toBe(true);
    }
  });

  it("refuses the four hosts the prefix match let through", () => {
    // The measured bypasses. Anyone can register these.
    for (const o of [
      "https://50mmretina.com.evil.example",
      "https://50mmretina.com.attacker.net",
      "https://www.50mmretina.com.evil.io",
      "https://50mmretina.com.co",
    ]) {
      expect(isOriginAllowed(o), o).toBe(false);
    }
  });

  it("allows this lane's own origin when SITE_ORIGIN is set", () => {
    setLaneOrigin("https://staging.50mmretina.com");
    expect(isOriginAllowed("https://staging.50mmretina.com")).toBe(true);
  });

  it("refuses that same origin when SITE_ORIGIN is unset", () => {
    // Staging is not special-cased anywhere; it is allowed only because the
    // lane declares itself.
    setLaneOrigin(undefined);
    expect(isOriginAllowed("https://staging.50mmretina.com")).toBe(false);
  });

  it("the lane origin does not open look-alikes of ITSELF", () => {
    // The same prefix bug, one level down: a lane-supplied value must be
    // compared by equality too, or SITE_ORIGIN becomes a new way in.
    setLaneOrigin("https://staging.50mmretina.com");
    for (const o of [
      "https://staging.50mmretina.com.evil.example",
      "https://staging.50mmretina.com.attacker.net",
    ]) {
      expect(isOriginAllowed(o), o).toBe(false);
    }
  });

  it("normalises a trailing slash rather than refusing on it", () => {
    setLaneOrigin("https://staging.50mmretina.com/");
    expect(isOriginAllowed("https://staging.50mmretina.com")).toBe(true);
    expect(isOriginAllowed("https://www.50mmretina.com/")).toBe(true);
  });

  it("ignores a malformed SITE_ORIGIN while production keeps working", () => {
    // The reason laneOrigin() is lenient: these headers are built for every
    // response, including error responses, so a throw would turn one bad
    // variable into a total outage.
    for (const bad of ["", "   ", "not-a-url", "http://staging.50mmretina.com", "javascript:alert(1)"]) {
      setLaneOrigin(bad);
      expect(isOriginAllowed("https://www.50mmretina.com"), `production with SITE_ORIGIN=${bad}`).toBe(true);
      expect(isOriginAllowed("http://staging.50mmretina.com"), `http lane origin ${bad}`).toBe(false);
    }
  });

  it("preview hosts are https-only and anchored", () => {
    expect(isOriginAllowed("https://lens-lustre-learn.lovable.app")).toBe(true);
    expect(isOriginAllowed("https://any-preview-123.lovable.app")).toBe(true);
    // endsWith(".lovable.app") accepted every one of these.
    for (const o of [
      "http://lens-lustre-learn.lovable.app",
      "https://evil.lovable.app.attacker.net",
      "https://a.b.lovable.app",
      "https://lovable.app.evil.example",
    ]) {
      expect(isOriginAllowed(o), o).toBe(false);
    }
  });

  it("an empty Origin is never allowed", () => {
    // Absent is not allowed. A missing Origin header must not become "*".
    for (const o of ["", "   "]) expect(isOriginAllowed(o)).toBe(false);
  });
});
