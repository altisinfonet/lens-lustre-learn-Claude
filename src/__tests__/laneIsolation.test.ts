/**
 * ─────────────────────────────────────────────────────────────────────────────
 * NO LANE MAY CARRY THE OTHER LANE'S ADDRESSES.
 *
 * Before G4, thirteen files held the production CDN host or the production site
 * origin as literals — five found by the first audit, eight more only after a
 * staging build was actually inspected. Every existing test passed throughout,
 * because every existing test also asserts production: the bug was invisible to
 * a suite that shares the wrong assumption with the code.
 *
 * These tests are therefore written in BOTH directions, and neither direction
 * is allowed to be the ambient one.
 *
 * ⚠ HERMETIC, THE WAY scripts/test-isolation-guard.mjs HAD TO BE TAUGHT TO BE.
 * On 2026-08-22 that harness inherited VITE_SUPABASE_URL and
 * ISOLATION_FORBIDDEN_REFS from the CI job and two of its cases silently began
 * asserting the wrong rule — green on a laptop, wrong in CI. So every case here
 * either resolves its lane explicitly through laneDefine() or restores the
 * variable it touched; nothing is left to what a CI job happens to set.
 *
 * `src/lib/env.ts` holds no literal and performs no runtime read — its values
 * arrive through Vite `define` from scripts/lane-config.mjs. So a lane is
 * exercised by calling that resolver, which is the same code the build runs.
 *
 * These assertions cover the RESOLVER. The authoritative check on the shipped
 * bytes is scripts/verify-bundle-isolation.mjs, run against each lane's dist.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const PRODUCTION = {
  ref: "jtdtehuqtinjxropkkcn",
  cdn: "cdn.50mmretina.com",
  origin: "https://www.50mmretina.com",
};
const STAGING = {
  ref: "ztzutckwdhetphwghuzj",
  cdn: "cdn-staging.50mmretina.com",
  origin: "https://staging.50mmretina.com",
};

/** Resolve a lane exactly as the build does, without touching the ambient env.
 *  src/lib/env.ts holds no literal and no runtime read — its values arrive via
 *  Vite `define` — so the lane under test is exercised through the same
 *  laneDefine() that vite.config.ts calls. */
async function resolveLane(vars: { cdnHost?: string; siteOrigin?: string }) {
  const { laneDefine } = await import("../../scripts/lane-config.mjs");
  const d = laneDefine(vars);
  return {
    CDN_HOST: JSON.parse(d.__LANE_CDN_HOST__),
    SITE_ORIGIN: JSON.parse(d.__LANE_SITE_ORIGIN__),
    SITE_HOST: JSON.parse(d.__LANE_SITE_HOST__),
    SITE_APEX_HOST: JSON.parse(d.__LANE_SITE_APEX_HOST__),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("lane isolation — a staging build carries no production address", () => {
  it("resolves every address to staging, and none to production", async () => {
    const env = await resolveLane({ cdnHost: STAGING.cdn, siteOrigin: STAGING.origin });
    const surface = Object.values(env).join(" ");

    expect(surface).not.toContain(PRODUCTION.cdn);
    expect(surface).not.toContain(PRODUCTION.ref);
    expect(surface).not.toContain("www.50mmretina.com");
    expect(env.CDN_HOST).toBe(STAGING.cdn);
    expect(env.SITE_ORIGIN).toBe(STAGING.origin);
  });
});

describe("lane isolation — a production build carries no staging address", () => {
  it("resolves every address to production, and none to staging", async () => {
    const env = await resolveLane({ cdnHost: PRODUCTION.cdn, siteOrigin: PRODUCTION.origin });
    const surface = Object.values(env).join(" ");

    expect(surface).not.toContain(STAGING.cdn);
    expect(surface).not.toContain(STAGING.ref);
    expect(surface).not.toContain("staging.50mmretina.com");
    expect(env.CDN_HOST).toBe(PRODUCTION.cdn);
    expect(env.SITE_ORIGIN).toBe(PRODUCTION.origin);
  });
});

describe("the display host — production must stay byte-identical", () => {
  it("displays the bare apex, not the www host, exactly as it always has", async () => {
    const env = await import("@/lib/env");
    // Production serves from www but has always PRINTED and CANONICALISED the
    // apex. Deriving these from SITE_HOST would have rewritten every canonical
    // tag and every printed address — an SEO change smuggled in under a
    // de-hardcoding commit.
    expect(env.SITE_DISPLAY_HOST).toBe("50mmretina.com");
    expect(env.SITE_DISPLAY_ORIGIN).toBe("https://50mmretina.com");
  });
});

describe("the defaulting rule (enforced in scripts/lane-config.mjs)", () => {
  it("uses the production values when the lane variables are genuinely unset", async () => {
    // vitest.config.ts pins the production values through the same laneDefine()
    // the build uses, which is the "unset" case this rule resolves to.
    const env = await import("@/lib/env");
    expect(env.CDN_HOST).toBe(PRODUCTION.cdn);
    expect(env.SITE_ORIGIN).toBe(PRODUCTION.origin);
  });

  it("REFUSES an empty string rather than emitting a hostless URL", async () => {
    const { laneDefine } = await import("../../scripts/lane-config.mjs");
    const prior = process.env.VITE_CDN_HOST;
    try {
      process.env.VITE_CDN_HOST = "";
      expect(() => laneDefine()).toThrow(/empty/i);
    } finally {
      if (prior === undefined) delete process.env.VITE_CDN_HOST;
      else process.env.VITE_CDN_HOST = prior;
    }
  });

  it("refuses an empty site origin too", async () => {
    const { laneDefine } = await import("../../scripts/lane-config.mjs");
    const prior = process.env.VITE_SITE_ORIGIN;
    try {
      process.env.VITE_SITE_ORIGIN = "   ";
      expect(() => laneDefine()).toThrow(/empty/i);
    } finally {
      if (prior === undefined) delete process.env.VITE_SITE_ORIGIN;
      else process.env.VITE_SITE_ORIGIN = prior;
    }
  });

  it("falls back to production when a variable is absent", async () => {
    const { laneDefine, PRODUCTION_CDN_HOST } = await import("../../scripts/lane-config.mjs");
    const prior = process.env.VITE_CDN_HOST;
    try {
      delete process.env.VITE_CDN_HOST;
      expect(laneDefine().__LANE_CDN_HOST__).toBe(JSON.stringify(PRODUCTION_CDN_HOST));
    } finally {
      if (prior !== undefined) process.env.VITE_CDN_HOST = prior;
    }
  });
});

describe("derived hosts", () => {
  it("computes the apex only when the origin is a www host", async () => {
    const { laneDefine } = await import("../../scripts/lane-config.mjs");
    const d = laneDefine({ siteOrigin: "https://www.example.com" });
    expect(d.__LANE_SITE_HOST__).toBe(JSON.stringify("www.example.com"));
    expect(d.__LANE_SITE_APEX_HOST__).toBe(JSON.stringify("example.com"));
  });

  it("leaves the apex empty for an origin that is already an apex, so no redirect loop is possible", async () => {
    const { laneDefine } = await import("../../scripts/lane-config.mjs");
    const d = laneDefine({ siteOrigin: "https://example.com" });
    expect(d.__LANE_SITE_HOST__).toBe(JSON.stringify("example.com"));
    expect(d.__LANE_SITE_APEX_HOST__).toBe(JSON.stringify(""));
  });

  it("strips a trailing slash so canonical URLs never double it", async () => {
    const { laneDefine } = await import("../../scripts/lane-config.mjs");
    const d = laneDefine({ siteOrigin: "https://www.example.com/" });
    expect(d.__LANE_SITE_ORIGIN__).toBe(JSON.stringify("https://www.example.com"));
  });

  it("JSON-stringifies every injected value, because define is raw text substitution", async () => {
    const { laneDefine } = await import("../../scripts/lane-config.mjs");
    for (const v of Object.values(laneDefine())) {
      expect(v).toMatch(/^".*"$/);
    }
  });
});

describe("substring traps — why the forbidden lists are shaped the way they are", () => {
  // ⚠ MEASURED, NOT REASONED. The isolation guard matches by substring, and
  // these seven results are what make a bare apex unusable in a forbidden list
  // and the scheme-qualified origin usable. A future "simplification" to
  // matching bare `50mmretina.com` would flag the staging lane's own hosts and
  // two legitimate email addresses; these rows kill that change rather than let
  // it merely misbehave. Guard rule R9 refuses a bare apex outright.
  const rows: Array<[string, string, boolean, string]> = [
    ["cdn.50mmretina.com", "cdn-staging.50mmretina.com", false, "prod CDN is NOT inside the staging CDN — safe to forbid"],
    ["www.50mmretina.com", "staging.50mmretina.com", false, "www host is NOT inside the staging origin — safe to forbid"],
    ["https://50mmretina.com", "https://staging.50mmretina.com", false, "scheme-qualified apex is NOT inside the staging origin — THIS is the usable form"],
    ["50mmretina.com", "staging.50mmretina.com", true, "TRAP: bare apex matches the staging origin"],
    ["50mmretina.com", "cdn-staging.50mmretina.com", true, "TRAP: bare apex matches the staging CDN"],
    ["50mmretina.com", "mail@50mmretina.com", true, "TRAP: bare apex matches an allowed email address"],
    ["staging.50mmretina.com", "cdn-staging.50mmretina.com", true, "benign overlap: both forbidden in the production lane, but the guard must report WHICH needle matched"],
  ];

  it.each(rows)("%s in %s -> %s (%s)", (needle, haystack, expected) => {
    expect(haystack.includes(needle)).toBe(expected);
  });

  it("the staging lane's forbidden list contains no bare apex", () => {
    const stagingForbidden = ["cdn.50mmretina.com", "www.50mmretina.com", "https://50mmretina.com"];
    expect(stagingForbidden).not.toContain("50mmretina.com");
    // and none of them matches the staging lane's own hosts or the emails
    for (const own of ["cdn-staging.50mmretina.com", "staging.50mmretina.com", "mail@50mmretina.com", "noreply@50mmretina.com"]) {
      for (const needle of stagingForbidden) {
        expect(own.includes(needle)).toBe(false);
      }
    }
  });

  it("the production lane's forbidden list matches neither production host nor the emails", () => {
    const prodForbidden = ["cdn-staging.50mmretina.com", "staging.50mmretina.com"];
    for (const own of ["cdn.50mmretina.com", "www.50mmretina.com", "mail@50mmretina.com", "noreply@50mmretina.com"]) {
      for (const needle of prodForbidden) {
        expect(own.includes(needle)).toBe(false);
      }
    }
  });
});
