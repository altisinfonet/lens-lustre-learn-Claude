/**
 * THE EDGE IS AN OPTIMISATION, NOT A SINGLE POINT OF FAILURE. P4, D2 half.
 *
 * `/config/site-settings` makes the common case cheap. What matters more is
 * what happens when it does not answer, because the thing it is caching decides
 * what members see. `siteSettingsCache.ts` says so itself:
 *
 *   "THIS CHANGES WHAT MEMBERS SEE with nothing on screen saying so — a setting
 *    an admin turned off may be back on."
 *
 * So these assertions are mostly about failure: every path that is not a clean
 * 200 with a non-empty object must fall through to the database, and none of
 * them may leave the cache holding a configuration that is not the real one.
 *
 * The fail-first run is recorded in `docs/evidence/d2/phase3/p4-site-settings-edge.md`:
 * against the pre-P4 `siteSettingsCache.ts` the first two assertions are red,
 * because nothing fetched the edge at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  queries: 0,
  rows: [] as { key: string; value: unknown }[],
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async () => {
          db.queries += 1;
          return { data: db.rows, error: db.error };
        },
      }),
    }),
  },
}));

const cache = await import("@/lib/siteSettingsCache");

const EDGE = "/config/site-settings";
let realFetch: typeof fetch;
let calls: string[] = [];

/** One scripted answer from the edge. */
function edgeAnswers(reply: () => Response | Promise<Response> | never) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.includes(EDGE)) return reply();
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  // Vitest runs with import.meta.env.DEV = true, and the cache skips the edge in
  // dev (no Pages Functions on the Vite server). These tests describe a BUILT
  // app, so they run as one; the dev skip has its own test at the end.
  vi.stubEnv("DEV", false);
  realFetch = globalThis.fetch;
  calls = [];
  db.queries = 0;
  db.rows = [{ key: "site_logo", value: "from-the-database" }];
  db.error = null;
  cache.invalidateSiteSetting();
  cache.resetSiteSettingsEdgeState();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

describe("P4 · site_settings from the edge", () => {
  it("reads the edge, and does not touch the database at all", async () => {
    edgeAnswers(() => json({ version: "abc123", settings: { site_logo: "from-the-edge", nav: [1] } }));

    expect(await cache.getSiteSetting("site_logo")).toBe("from-the-edge");
    expect(calls.filter((u) => u.includes(EDGE))).toHaveLength(1);
    expect(
      db.queries,
      "the edge answered and the client queried PostgREST anyway — the round trip " +
        "this unit exists to remove is still being made.",
    ).toBe(0);
  });

  it("fills the WHOLE configuration in one read, so a second key is free", async () => {
    edgeAnswers(() => json({ version: "abc123", settings: { a: 1, b: 2, c: 3 } }));

    expect(await cache.getSiteSetting("a")).toBe(1);
    expect(await cache.getSiteSetting("b")).toBe(2);
    expect(calls.filter((u) => u.includes(EDGE))).toHaveLength(1);
    expect(db.queries).toBe(0);
  });

  it("reports the version the edge gave it, and forgets it on invalidate", async () => {
    edgeAnswers(() => json({ version: "v-1", settings: { a: 1 } }));
    await cache.getSiteSetting("a");
    expect(cache.siteSettingsVersion()).toBe("v-1");

    cache.invalidateSiteSetting();
    expect(
      cache.siteSettingsVersion(),
      "the version describes the whole payload; after a drop it describes a " +
        "configuration the cache no longer holds.",
    ).toBeNull();
  });

  it("a key the edge does not carry is UNSET, not a reason to query again", async () => {
    edgeAnswers(() => json({ version: "v", settings: { a: 1 } }));
    expect(await cache.getSiteSetting("not_a_setting")).toBeNull();
    expect(db.queries).toBe(0);
  });
});

describe("P4 · every failure falls through to the database", () => {
  const cases: { name: string; reply: () => Response }[] = [
    { name: "503 (the edge's own upstream failure)", reply: () => json({ error: "x" }, 503) },
    { name: "500", reply: () => json({ error: "x" }, 500) },
    { name: "200 with no settings object", reply: () => json({ version: "v" }) },
    { name: "200 with an EMPTY settings object", reply: () => json({ version: "v", settings: {} }) },
    { name: "200 with an array instead of an object", reply: () => json({ version: "v", settings: [] }) },
    { name: "200 that is not JSON at all", reply: () => new Response("<html>", { status: 200 }) },
  ];

  for (const c of cases) {
    it(`${c.name} -> the database answers`, async () => {
      edgeAnswers(c.reply);
      expect(await cache.getSiteSetting("site_logo")).toBe("from-the-database");
      expect(db.queries).toBe(1);
    });
  }

  it("a thrown fetch (offline, or no such origin in the app) falls through too", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await cache.getSiteSetting("site_logo")).toBe("from-the-database");
    expect(db.queries).toBe(1);
  });

  it("GUARD an EMPTY edge payload never blanks a real setting", async () => {
    // The dangerous direction: `{}` read as "every setting is unset" would put
    // built-in defaults in front of members with nothing on screen saying so.
    edgeAnswers(() => json({ version: "v", settings: {} }));
    expect(await cache.getSiteSetting("site_logo")).toBe("from-the-database");
  });
});

describe("P4 · the route being absent is remembered, an outage is not", () => {
  it("404 stops it asking again — the route is not on this lane, or there is no origin", async () => {
    edgeAnswers(() => json({ error: "not found" }, 404));

    await cache.getSiteSetting("site_logo");
    cache.invalidateSiteSetting();
    await cache.getSiteSetting("site_logo");

    expect(calls.filter((u) => u.includes(EDGE))).toHaveLength(1);
    expect(db.queries).toBe(2);
  });

  it("503 does NOT stop it asking again, because an outage ends", async () => {
    edgeAnswers(() => json({ error: "upstream" }, 503));

    await cache.getSiteSetting("site_logo");
    cache.invalidateSiteSetting();
    await cache.getSiteSetting("site_logo");

    expect(
      calls.filter((u) => u.includes(EDGE)),
      "a 5xx was treated as permanent. The edge would stay unused for the whole " +
        "session after one bad minute.",
    ).toHaveLength(2);
  });
});

describe("P4 · the dev server has no edge", () => {
  it("in dev it never asks /config/site-settings (a guaranteed 404 the UI gate reports) and reads keyed from the database", async () => {
    vi.stubEnv("DEV", true);
    edgeAnswers(() => json({ version: "v", settings: { site_logo: "from-the-edge" } }));

    expect(await cache.getSiteSetting("site_logo")).toBe("from-the-database");
    expect(
      calls.filter((u) => u.includes(EDGE)),
      "the dev server asked the edge route, which only exists as a Pages Function — " +
        "every harness page then logs a 404 and #328's UI gate goes red.",
    ).toHaveLength(0);
    expect(db.queries).toBe(1);
  });
});
