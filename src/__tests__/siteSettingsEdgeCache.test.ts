/**
 * /config/site-settings must hit the database once per TTL, not once per call
 * (measured 2026-10-28: 1.3-1.5 s every request, cf-cache-status DYNAMIC), and a
 * cached answer must carry the same CORS headers as an uncached one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { onRequestGet } from "../../functions/config/site-settings";

const env = { SUPABASE_PROJECT_REF: "ref", SUPABASE_ANON_KEY: "anon", SITE_ORIGIN: "https://staging.example" };
const ROWS = [{ key: "b", value: 2 }, { key: "a", value: 1 }];

function fakeCache() {
  const m = new Map<string, Response>();
  return {
    m,
    match: async (r: Request) => m.get(r.url)?.clone(),
    put: async (r: Request, res: Response) => { m.set(r.url, res.clone()); },
  };
}

let cache: ReturnType<typeof fakeCache>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cache = fakeCache();
  (globalThis as unknown as { caches: unknown }).caches = { default: cache };
  fetchMock = vi.fn(async () => new Response(JSON.stringify(ROWS), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); delete (globalThis as { caches?: unknown }).caches; });

const call = (headers: Record<string, string> = {}, url = "https://x.example/config/site-settings") =>
  onRequestGet({ request: new Request(url, { headers }), env, waitUntil: () => {} });

describe("site-settings edge cache", () => {
  it("reads the database once for repeated calls", async () => {
    const a = await call();
    await Promise.resolve();
    const b = await call();
    expect(a.status).toBe(200);
    expect(await b.json()).toEqual(await a.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keys on the path only, so a query string cannot force reads", async () => {
    await call({}, "https://x.example/config/site-settings?a=1");
    await call({}, "https://x.example/config/site-settings?b=2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never touches the cache for Authorization or session-cookie requests", async () => {
    await call({ authorization: "Bearer t" });
    await call({ cookie: "sb-abc-auth-token=1" });
    expect(cache.m.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives a cached response the same CORS headers as an uncached one", async () => {
    const h = { origin: "https://localhost" };
    const miss = await call(h);
    const hit = await call(h);
    for (const r of [miss, hit]) {
      expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
      expect(r.headers.get("vary")).toMatch(/Origin/);
    }
    expect(hit.headers.get("etag")).toBe(miss.headers.get("etag"));
  });

  it("answers 304 from the cached copy and does not cache a failure", async () => {
    const first = await call();
    const etag = first.headers.get("etag")!;
    expect((await call({ "if-none-match": etag })).status).toBe(304);

    cache.m.clear();
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    const bad = await call();
    expect(bad.status).toBe(503);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    expect(cache.m.size).toBe(0);
  });
});
