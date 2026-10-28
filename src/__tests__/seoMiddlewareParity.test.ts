/**
 * F-D3-1/2: functions/_middleware.ts must inject exactly what the Worker
 * `seo-edge-injector` injects today, so live is the same with or without the
 * Worker in front. Both run here over the same Pages response and the same
 * seo-route-metadata answer; a fake HTMLRewriter records what each strips and
 * appends.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain JS, dashboard-deployed; imported only to compare against it
import worker from "../../cloudflare/seo-edge-injector/worker.js";
import { onRequest, headBlock, FRESH_S } from "../../functions/_middleware";

type Rec = { stripped: string[]; appended: string[] };

class FakeRewriter {
  handlers: [string, { element(el: unknown): void }][] = [];
  on(sel: string, h: { element(el: unknown): void }) { this.handlers.push([sel, h]); return this; }
  transform(res: Response) {
    const rec: Rec = { stripped: [], appended: [] };
    for (const [sel, h] of this.handlers) {
      h.element({
        tagName: sel === "head" ? "head" : "x",
        remove: () => rec.stripped.push(sel),
        append: (html: string) => rec.appended.push(html),
      });
    }
    return new Response(JSON.stringify(rec), { status: res.status, headers: res.headers });
  }
}

const META = {
  title: `A "quoted" <title> & more`,
  description: "Desc with 'apostrophe'",
  ogImage: "https://cdn.example/x.jpg",
  ogType: "article",
  canonical: "https://50mmretina.com/journal/x",
  noindex: false,
  jsonLd: [{ "@type": "Article", headline: "</script><b>" }],
  source: "journal",
};

function fakeCache() {
  const m = new Map<string, Response>();
  return { m, match: async (r: Request) => m.get(r.url)?.clone(), put: async (r: Request, res: Response) => { m.set(r.url, res.clone()); } };
}

let cache: ReturnType<typeof fakeCache>;
let metaCalls: string[];

beforeEach(() => {
  cache = fakeCache();
  metaCalls = [];
  (globalThis as unknown as { caches: unknown }).caches = { default: cache };
  (globalThis as unknown as { HTMLRewriter: unknown }).HTMLRewriter = FakeRewriter;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
    const u = typeof input === "string" ? input : (input as Request).url;
    if (u.includes("seo-route-metadata")) { metaCalls.push(u); return new Response(JSON.stringify(META), { status: 200 }); }
    return new Response("<html><head><title>x</title></head></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { caches?: unknown }).caches;
  delete (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
});

const shell = () => new Response("<html><head></head></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
const pages = (path: string, env: Record<string, string> = { SUPABASE_PROJECT_REF: "ref" }, init: RequestInit = {}) =>
  onRequest({ request: new Request(`https://www.50mmretina.com${path}`, init), env, next: async () => shell(), waitUntil: () => {} });

describe("one SEO renderer: Pages middleware == Worker", () => {
  it("strips and appends exactly what the Worker does", async () => {
    const w = await (worker as { fetch: (r: Request, e: unknown) => Promise<Response> })
      .fetch(new Request("https://www.50mmretina.com/journal/x"), { ORIGIN_HOST: "o.example", SUPABASE_PROJECT_REF: "ref", ENABLE_REWRITE: "true" });
    const p = await pages("/journal/x");
    const wr = (await w.json()) as Rec;
    const pr = (await p.json()) as Rec;
    expect(pr).toEqual(wr);
    expect(pr.appended[0]).toBe(headBlock(META));
    expect(pr.appended[0]).not.toContain("</script><b>");
    expect(p.headers.get("x-seo-edge")).toBe(w.headers.get("x-seo-edge"));
    expect(metaCalls[1]).toBe(metaCalls[0]); // same metadata URL as the Worker's default
  });

  it("reads seo-route-metadata once per path per colo while fresh", async () => {
    await pages("/");
    await pages("/");
    await pages("/?utm=1");
    expect(metaCalls).toHaveLength(1);
    expect(FRESH_S).toBe(300);
  });

  it("fails open: no ref, kill switch, metadata down, non-GET, assets, shell sub-fetch", async () => {
    expect(await (await pages("/", {})).text()).toContain("<head></head>");
    expect((await pages("/", { SUPABASE_PROJECT_REF: "ref", SEO_INJECT: "off" })).headers.get("x-seo-render")).toBe("pages:off");
    expect(await (await pages("/", { SUPABASE_PROJECT_REF: "ref" }, { method: "POST", body: "x" })).text()).toContain("<head></head>");
    expect(await (await pages("/assets/a.js")).text()).toContain("<head></head>");
    expect(await (await pages("/index.html", undefined, { headers: { "x-seo-shell": "1" } })).text()).toContain("<head></head>");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await pages("/x")).headers.get("x-seo-render")).toBe("pages:fallback");
  });

  it("does not cache the edge function's own fallback-error answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...META, source: "fallback-error" }))));
    await pages("/y");
    expect(cache.m.size).toBe(0);
  });

  it("slow metadata (> 1.5 s): visitor gets the page untouched, the late answer still fills the cache", async () => {
    vi.useFakeTimers();
    try {
      const fills: Promise<unknown>[] = [];
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify(META))), 1700))));
      const first = onRequest({ request: new Request("https://www.50mmretina.com/post/1"), env: { SUPABASE_PROJECT_REF: "ref" }, next: async () => shell(), waitUntil: (p) => { fills.push(p); } });
      await vi.advanceTimersByTimeAsync(1500);
      expect((await first).headers.get("x-seo-render")).toBe("pages:fallback");
      await vi.advanceTimersByTimeAsync(300);
      await Promise.all(fills);
      expect(cache.m.size).toBe(1);
      const second = await pages("/post/1");
      expect(second.headers.get("x-seo-edge")).toBe("injected:journal");
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards the bare domain to www", async () => {
    const r = await onRequest({ request: new Request("https://50mmretina.com/a?b=1"), env: {}, next: async () => shell() });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://www.50mmretina.com/a?b=1");
  });
});
