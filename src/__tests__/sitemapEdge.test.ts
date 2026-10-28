/**
 * F-D3-3: /sitemap.xml serves this lane's dynamic sitemap, cached at the edge,
 * and falls back to the static template on any failure. A lane whose build
 * wrote an empty sitemap (non-production) keeps it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { onRequest } from "../../functions/sitemap.xml";

const STATIC = `<?xml version="1.0"?><urlset><url><loc>https://a/</loc></url><url><loc>https://a/journal</loc></url></urlset>`;
const EMPTY = `<?xml version="1.0"?><urlset></urlset>`;
const DYN = `<?xml version="1.0"?><urlset>${"<url><loc>https://a/x</loc></url>".repeat(30)}</urlset>`;

function fakeCache() {
  const m = new Map<string, Response>();
  return { m, match: async (r: Request) => m.get(r.url)?.clone(), put: async (r: Request, res: Response) => { m.set(r.url, res.clone()); } };
}
let cache: ReturnType<typeof fakeCache>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cache = fakeCache();
  (globalThis as unknown as { caches: unknown }).caches = { default: cache };
  fetchMock = vi.fn(async () => new Response(DYN, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); delete (globalThis as { caches?: unknown }).caches; });

const call = (staticXml = STATIC, env: Record<string, string> = { SUPABASE_PROJECT_REF: "ref" }) =>
  onRequest({
    request: new Request("https://x.example/sitemap.xml"),
    env,
    next: async () => new Response(staticXml, { status: 200, headers: { "content-type": "application/xml" } }),
    waitUntil: () => {},
  });

describe("/sitemap.xml edge function", () => {
  it("serves the lane's dynamic sitemap and reads upstream once while fresh", async () => {
    const a = await call();
    const b = await call();
    expect(a.headers.get("x-sitemap-source")).toBe("dynamic");
    expect(b.headers.get("x-sitemap-source")).toBe("dynamic-cached");
    expect(await b.text()).toBe(DYN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://ref.supabase.co/functions/v1/sitemap");
  });

  it("keeps a non-production lane's empty sitemap and never calls upstream", async () => {
    const r = await call(EMPTY);
    expect(await r.text()).toBe(EMPTY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the static template: upstream down, non-200, not a urlset, thinner than static, no ref", async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error("down"); });
    expect(await (await call()).text()).toBe(STATIC);
    fetchMock.mockImplementationOnce(async () => new Response("x", { status: 500 }));
    expect(await (await call()).text()).toBe(STATIC);
    fetchMock.mockImplementationOnce(async () => new Response("<html>", { status: 200 }));
    expect(await (await call()).text()).toBe(STATIC);
    fetchMock.mockImplementationOnce(async () => new Response("<urlset><loc>x</loc></urlset>", { status: 200 }));
    const thin = await call();
    expect(thin.headers.get("x-sitemap-source")).toBe("static-fallback");
    expect(thin.status).toBe(200);
    expect(await (await call(STATIC, {})).text()).toBe(STATIC);
    fetchMock.mockImplementationOnce(async () => new Response(DYN.replace(/https:\/\/a\//g, "https://other-lane/"), { status: 200 }));
    expect((await call()).headers.get("x-sitemap-source")).toBe("static-fallback");
    expect(cache.m.size).toBe(0);
  });
});
