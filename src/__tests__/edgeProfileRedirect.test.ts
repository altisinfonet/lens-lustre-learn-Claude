import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequest } from "../../functions/profile/[id]";

/**
 * F-92-REDO — /profile/<uuid> must never be RENDERED, not merely corrected.
 *
 * The rejected F-92 was a client-side address correction: the browser really
 * requested /profile/<uuid>, Cloudflare really served it, React mounted, the
 * profile query returned, and only then did history.replaceState swap the
 * address. The internal id therefore sat in the address bar for the whole boot
 * + query time (long enough to read, screenshot or copy), and it still landed
 * in browser history, the server access log, and the Referer header of every
 * asset the page pulled. The Owner's rule is that the id URL is never what the
 * visitor is shown IN THE FIRST PLACE, and no amount of post-hoc correction can
 * satisfy that.
 *
 * This suite tests the replacement: a Pages Function that answers BEFORE any
 * HTML exists. Everything below is asserted against the real onRequest, with
 * only the network stubbed — there is no mock of the function under test.
 */

const UUID = "11111111-2222-4333-8444-555555555555";
const SHELL = "<!doctype html><html><head></head><body>app</body></html>";

const LANE = {
  SUPABASE_PROJECT_REF: "stgabcdefghijklmnopq",
  SUPABASE_ANON_KEY: "staging-anon-key",
  SITE_ORIGIN: "https://staging.50mmretina.com",
};

type Restful = { status?: number; body?: unknown; throws?: boolean; slow?: boolean };

let restCalls: string[] = [];

/**
 * Stub only the network. /index.html answers with the SPA shell (what
 * getShell fetches); anything on supabase.co answers per `rest`.
 */
function stubFetch(rest: Restful) {
  restCalls = [];
  return vi.fn(async (input: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (url.includes("/index.html")) {
      return new Response(SHELL, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.includes("supabase.co")) {
      restCalls.push(url);
      if (rest.throws) throw new TypeError("network error");
      return new Response(JSON.stringify(rest.body ?? []), {
        status: rest.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function ctx(opts: {
  path?: string;
  id?: string;
  method?: string;
  env?: Record<string, string> | undefined;
  rest?: Restful;
}) {
  const path = opts.path ?? `/profile/${UUID}`;
  const request = new Request(`https://staging.50mmretina.com${path}`, { method: opts.method ?? "GET" });
  const next = vi.fn(async () => new Response("next()", { status: 200 }));
  globalThis.fetch = stubFetch(opts.rest ?? { body: [] }) as any;
  return {
    request,
    params: { id: opts.id ?? UUID },
    // "in" and not "=== undefined": passing env:undefined explicitly MUST mean
    // an unconfigured lane. Written the obvious way first, this helper quietly
    // substituted LANE and the unconfigured-lane test could never have failed.
    env: "env" in opts ? opts.env : LANE,
    next,
  };
}

const withHandle = (custom_url: string | null) => ({ body: [{ custom_url }] });

let realFetch: typeof globalThis.fetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe("functions/profile/[id].ts — the id URL is answered at the edge, never rendered", () => {
  it("redirects a member WITH a handle before any HTML is served", async () => {
    const c = ctx({ rest: withHandle("liwei") });
    const res = await onRequest(c);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/liwei");
    // The decisive assertion: nothing was rendered. No shell was even fetched.
    expect(await res.text()).toBe("");
    expect(c.next).not.toHaveBeenCalled();
  });

  it("302 and NOT 301 — a handle can be changed once a year under F-93", async () => {
    const res = await onRequest(ctx({ rest: withHandle("liwei") }));
    expect(res.status).toBe(302);
    expect(res.status).not.toBe(301);
  });

  it("the redirect is not stored, so a changed handle is never served from cache", async () => {
    const res = await onRequest(ctx({ rest: withHandle("liwei") }));
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("carries the query string across, so /profile/<id>?section=wall keeps its section", async () => {
    const res = await onRequest(ctx({ path: `/profile/${UUID}?section=wall`, rest: withHandle("liwei") }));
    expect(res.headers.get("location")).toBe("/liwei?section=wall");
  });

  it("reads the CURRENT handle by id — it does not go near custom_url_history", async () => {
    await onRequest(ctx({ rest: withHandle("liwei") }));
    expect(restCalls).toHaveLength(1);
    expect(restCalls[0]).toContain("profiles_public_data");
    expect(restCalls[0]).toContain(`id=eq.${UUID}`);
    expect(restCalls[0]).not.toContain("custom_url_history");
    expect(restCalls[0]).not.toContain("resolve_custom_url");
  });

  it("serves the app unchanged for a member with NO handle (15 such on production)", async () => {
    const res = await onRequest(ctx({ rest: withHandle(null) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("app");
  });

  it("serves the app when the handle is present but blank", async () => {
    const res = await onRequest(ctx({ rest: withHandle("   ") }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("serves the app when the member is not found at all", async () => {
    const res = await onRequest(ctx({ rest: { body: [] } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app");
  });
});

describe("functions/profile/[id].ts — it fails SOFT, because a 500 is worse than an id URL", () => {
  it("serves the app when Supabase errors", async () => {
    const res = await onRequest(ctx({ rest: { status: 500, body: { message: "boom" } } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app");
  });

  it("serves the app when the lookup throws (network down / timeout)", async () => {
    const res = await onRequest(ctx({ rest: { throws: true } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app");
  });

  it("serves the app when the lane is not configured at all", async () => {
    const res = await onRequest(ctx({ env: undefined as any, rest: withHandle("liwei") }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app");
  });

  it("serves the app when the lane env is present but empty", async () => {
    const res = await onRequest(ctx({ env: {}, rest: withHandle("liwei") }));
    expect(res.status).toBe(200);
  });
});

describe("functions/profile/[id].ts — it only claims what is actually its own", () => {
  it("leaves a non-uuid /profile/<something> alone", async () => {
    const c = ctx({ path: "/profile/settings", id: "settings", rest: withHandle("liwei") });
    const res = await onRequest(c);
    expect(res.status).not.toBe(302);
    expect(restCalls).toHaveLength(0);
  });

  it("leaves a sub-path such as /profile/<id>/photos alone", async () => {
    const c = ctx({ path: `/profile/${UUID}/photos`, rest: withHandle("liwei") });
    const res = await onRequest(c);
    expect(res.status).not.toBe(302);
    expect(restCalls).toHaveLength(0);
  });

  it("leaves a non-GET request alone", async () => {
    const c = ctx({ method: "POST", rest: withHandle("liwei") });
    const res = await onRequest(c);
    expect(res.status).not.toBe(302);
    expect(restCalls).toHaveLength(0);
  });
});

describe("functions/profile/[id].ts — a handle can never send a visitor off-site", () => {
  const HOSTILE = ["//evil.com", "/\\evil.com", "https://evil.com", "..%2F..%2Fevil", "\\\\evil.com"];

  it.each(HOSTILE)("never emits an off-origin Location for %j", async (handle) => {
    const res = await onRequest(ctx({ rest: withHandle(handle) }));
    const loc = res.headers.get("location");
    if (loc !== null) {
      // Resolved against this origin it must STAY on this origin.
      expect(new URL(loc, "https://staging.50mmretina.com").origin).toBe("https://staging.50mmretina.com");
      expect(loc.startsWith("//")).toBe(false);
    }
  });

  it("does not redirect to a value the column's own CHECK could never hold", async () => {
    // profiles_custom_url_format: ^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$ and no ".."
    for (const bad of ["UPPER", "has space", "a", "..", "x..y", "-hyphen-"]) {
      const res = await onRequest(ctx({ rest: withHandle(bad) }));
      expect(res.status, `handle ${JSON.stringify(bad)} must not be redirected to`).toBe(200);
    }
  });

  it("does redirect for the shapes the column DOES allow", async () => {
    for (const ok of ["liwei", "phani.anindya", "50mmretinaworld", "a_b", "x".repeat(30)]) {
      const res = await onRequest(ctx({ rest: withHandle(ok) }));
      expect(res.status, `handle ${JSON.stringify(ok)} should redirect`).toBe(302);
      expect(res.headers.get("location")).toBe(`/${ok}`);
    }
  });
});

describe("one mechanism, not two — the client-side address rewrite is gone", () => {
  const read = async (rel: string) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(process.cwd(), rel), "utf8");
  };

  it("the profile page does no address rewriting of its own", async () => {
    const src = await read("src/pages/PublicProfile.tsx");
    expect(src).not.toContain("useVanityUrlAddress");
    expect(src).not.toContain("replaceState");
    expect(src).not.toContain("pushState");
  });

  it("the vanity-address hook no longer exists", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(process.cwd(), "src/pages/useVanityUrlAddress.ts"))).toBe(false);
  });

  it("the /:customUrl resolver is untouched — F-85/F-86 keep rendering in place", async () => {
    // Its in-place render is what makes /membername survive and what makes the
    // branded 404 reachable for a single-segment path. Neither is this unit's
    // to change, and a redirect added here would undo both.
    const src = await read("src/pages/CustomUrlProfile.tsx");
    expect(src).toContain("<PublicProfileInner");
    expect(src).toContain("<NotFound />");
    expect(src).not.toContain("replaceState");
  });
});

/**
 * THE CACHE. Owner's ruling: Cloudflare's Cache API, not KV — KV's free tier
 * allows 1,000 writes/day and the one-time fill alone would spend 111 of them
 * on production, so a few test re-runs could hit the ceiling. The cache has no
 * quota. A HIT must cost ZERO database reads; that is the whole point.
 */
describe("functions/profile/[id].ts — the cache carries it, the database barely runs", () => {
  /** A minimal stand-in for caches.default, so the real code path is exercised. */
  function fakeCache() {
    const store = new Map<string, { body: string; headers: Headers }>();
    return {
      store,
      puts: [] as Array<{ key: string; body: string; cacheControl: string | null }>,
      async match(req: Request) {
        const e = store.get(req.url);
        return e ? new Response(e.body, { headers: e.headers }) : undefined;
      },
      async put(req: Request, res: Response) {
        const body = await res.text();
        store.set(req.url, { body, headers: new Headers(res.headers) });
        this.puts.push({ key: req.url, body, cacheControl: res.headers.get("cache-control") });
      },
    };
  }

  function withCache(cache: any) {
    (globalThis as any).caches = { default: cache };
  }

  afterEach(() => { delete (globalThis as any).caches; });

  const call = async (cache: any, opts: Parameters<typeof ctx>[0] = {}) => {
    withCache(cache);
    const c = ctx(opts);
    const waited: any[] = [];
    (c as any).waitUntil = (p: any) => waited.push(p);
    const res = await onRequest(c);
    await Promise.all(waited);
    return res;
  };

  it("a MISS does exactly one database read, redirects, and stores the answer", async () => {
    const cache = fakeCache();
    const res = await call(cache, { rest: withHandle("liwei") });
    expect(res.status).toBe(302);
    expect(restCalls).toHaveLength(1);
    expect(cache.puts).toHaveLength(1);
    expect(cache.puts[0].body).toBe("liwei");
  });

  it("a HIT redirects with ZERO database reads", async () => {
    const cache = fakeCache();
    await call(cache, { rest: withHandle("liwei") });          // fill
    const res = await call(cache, { rest: withHandle("liwei") }); // hit
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/liwei");
    expect(restCalls, "a cache hit must not touch the database").toHaveLength(0);
  });

  it("the NEGATIVE answer is cached too — no handle must not mean a read every visit", async () => {
    const cache = fakeCache();
    const first = await call(cache, { rest: withHandle(null) });
    expect(first.status).toBe(200);
    expect(cache.puts).toHaveLength(1);
    expect(cache.puts[0].body).toBe("-");

    const second = await call(cache, { rest: withHandle(null) });
    expect(second.status).toBe(200);
    expect(restCalls, "a cached negative must not touch the database").toHaveLength(0);
  });

  it("stores with the one-hour TTL that custom_url_history makes safe", async () => {
    const cache = fakeCache();
    await call(cache, { rest: withHandle("liwei") });
    expect(cache.puts[0].cacheControl).toBe("max-age=3600");
  });

  it("A FAILURE IS NEVER CACHED — one bad minute must not poison the hour", async () => {
    const cache = fakeCache();
    const bad = await call(cache, { rest: { status: 500 } });
    expect(bad.status).toBe(200);
    expect(cache.puts, "a failed lookup must store nothing").toHaveLength(0);

    // The very next request must try again, not serve a cached failure.
    const good = await call(cache, { rest: withHandle("liwei") });
    expect(good.status).toBe(302);
    expect(restCalls).toHaveLength(1);
  });

  it("a thrown lookup is not cached either", async () => {
    const cache = fakeCache();
    await call(cache, { rest: { throws: true } });
    expect(cache.puts).toHaveLength(0);
  });

  it("keys on the id alone, so ?section=wall does not shard the cache", async () => {
    const cache = fakeCache();
    await call(cache, { rest: withHandle("liwei") });
    const res = await call(cache, { path: `/profile/${UUID}?section=wall`, rest: withHandle("liwei") });
    expect(restCalls, "the query string must not cause a second read").toHaveLength(0);
    expect(res.headers.get("location")).toBe("/liwei?section=wall");
    expect(cache.store.size).toBe(1);
    expect([...cache.store.keys()][0]).not.toContain("section=wall");
  });

  it("an unreadable cache entry is re-resolved rather than trusted", async () => {
    const cache = fakeCache();
    await call(cache, { rest: withHandle("liwei") });
    cache.store.set([...cache.store.keys()][0], { body: "//evil.com", headers: new Headers() });
    const res = await call(cache, { rest: withHandle("liwei") });
    expect(res.headers.get("location")).toBe("/liwei");
  });

  it("still works when there is no cache at all", async () => {
    delete (globalThis as any).caches;
    const res = await onRequest(ctx({ rest: withHandle("liwei") }));
    expect(res.status).toBe(302);
  });

  it("stores even when the platform gives no waitUntil", async () => {
    const cache = fakeCache();
    withCache(cache);
    const c = ctx({ rest: withHandle("liwei") }); // no waitUntil on this context
    await onRequest(c);
    // The put is INITIATED synchronously and settles on its own; without
    // waitUntil nothing holds it open, so let the microtasks drain before
    // asserting. What is being pinned is that it was started at all — an
    // optional call would not have evaluated cache.put(...) in the first place.
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.puts, "an optional-call would never have started the put").toHaveLength(1);
  });
});

describe("functions/profile/[id].ts — the fire rate is instrumented from day one", () => {
  let logs: any[];
  let spy: any;
  beforeEach(() => {
    logs = [];
    spy = vi.spyOn(console, "log").mockImplementation((line: any) => {
      try { logs.push(JSON.parse(String(line))); } catch { logs.push(String(line)); }
    });
  });
  afterEach(() => { spy?.mockRestore(); });

  it("logs EDGE-9101 for every id-URL request, with the cache outcome", async () => {
    await onRequest(ctx({ rest: withHandle("liwei") }));
    expect(logs).toHaveLength(1);
    expect(logs[0].code).toBe("EDGE-9101");
    expect(logs[0].event).toBe("PROFILE_ID_URL_REQUESTED");
    expect(logs[0].outcome).toBe("redirect");
    expect(logs[0].cache).toBe("miss");
    expect(typeof logs[0].n).toBe("number");
  });

  it("the counter actually COUNTS — a constant would pass a typeof check", async () => {
    // Caught by planting `n: 0`: asserting only that n is a number let a
    // hardcoded zero through, and a counter that never moves is not a counter.
    await onRequest(ctx({ rest: withHandle("liwei") }));
    await onRequest(ctx({ rest: withHandle("liwei") }));
    await onRequest(ctx({ rest: withHandle("liwei") }));
    const ns = logs.map((l) => l.n);
    expect(ns).toHaveLength(3);
    expect(ns[1]).toBe(ns[0] + 1);
    expect(ns[2]).toBe(ns[1] + 1);
  });

  it("records the REFERER, which is what turns a rate into a place in the code", async () => {
    const c = ctx({ rest: withHandle("liwei") });
    (c as any).request = new Request(c.request.url, { headers: { referer: "https://staging.50mmretina.com/feed" } });
    await onRequest(c);
    expect(logs[0].ref).toBe("https://staging.50mmretina.com/feed");
  });

  it("counts a member with no handle too — that link was still generated", async () => {
    await onRequest(ctx({ rest: withHandle(null) }));
    expect(logs[0].outcome).toBe("no-handle");
  });

  it("counts a failed lookup rather than hiding it", async () => {
    await onRequest(ctx({ rest: { throws: true } }));
    expect(logs[0].outcome).toBe("lookup-failed");
  });

  it("does NOT count requests that were never id URLs", async () => {
    await onRequest(ctx({ path: "/profile/settings", id: "settings" }));
    await onRequest(ctx({ path: `/profile/${UUID}/photos` }));
    await onRequest(ctx({ method: "POST" }));
    expect(logs, "only a real /profile/<uuid> document request is the signal").toHaveLength(0);
  });
});
