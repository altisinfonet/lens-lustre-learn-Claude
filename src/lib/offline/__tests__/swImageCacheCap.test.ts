/**
 * OFF-4 · the image service worker keeps under a BYTE cap as well as the entry cap.
 *
 * public/sw-image-cache.js is loaded into a sandbox with a fake Cache Storage
 * (insertion-ordered, like the real one) and a fake network, and real fetch
 * events are dispatched to it. Before OFF-4 the only bound was 200 entries:
 * 200 × 1 MB photographs = 200 MB on a phone. Now the total stays ≤ 50 MB.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

type Plan = (k: string[], s: Record<string, number>, me: number, mb: number, est: number) => { evict: string[]; count: number; bytes: number };

function loadWorker(netBytes: (url: string) => number) {
  const store = new Map<string, Map<string, Response>>();
  const listeners: Record<string, (e: unknown) => void> = {};
  const caches = {
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      const k = (r: Request | string) => (typeof r === "string" ? new URL(r, "https://app.test").href : r.url);
      return {
        async match(r: Request | string) { const v = m.get(k(r)); return v ? v.clone() : undefined; },
        async put(r: Request | string, res: Response) { const key = k(r); m.delete(key); m.set(key, res); },
        async delete(r: Request | string) { return m.delete(k(r)); },
        async keys() { return [...m.keys()].map((u) => new Request(u)); },
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(n: string) { return store.delete(n); },
  };
  const self = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; },
    skipWaiting() {}, clients: { claim: async () => {} },
  } as Record<string, unknown>;
  const ctx = vm.createContext({
    self, caches, URL, Request, Response, Blob, Promise, JSON, console,
    fetch: async (r: Request) => new Response(new Uint8Array(netBytes(r.url)), { status: 200, headers: { "content-type": "image/webp" } }),
  });
  vm.runInContext(readFileSync("public/sw-image-cache.js", "utf8"), ctx);
  const fetchImage = async (url: string) => {
    let p: Promise<Response> | undefined;
    listeners.fetch({ request: new Request(url), respondWith: (x: Promise<Response>) => { p = x; } });
    await p;
    await new Promise((r) => setTimeout(r, 5));
  };
  const entries = () => [...(store.get("gallery-images-v3")?.keys() ?? [])].filter((u) => !u.includes("__retina-image-cache-sizes__"));
  return { plan: self.__retinaPlanTrim as Plan, fetchImage, entries };
}

const MB = 1024 * 1024;
const img = (i: number) => `https://x.supabase.co/storage/v1/object/public/post-images/p${i}.webp`;

describe("planTrim", () => {
  const { plan } = loadWorker(() => 1);
  it("under both caps evicts nothing", () => {
    expect(plan(["a", "b"], { a: 1, b: 1 }, 10, 10, 5).evict).toEqual([]);
  });
  it("over the entry cap evicts the oldest", () => {
    expect(plan(["a", "b", "c"], { a: 1, b: 1, c: 1 }, 2, 100, 5).evict).toEqual(["a"]);
  });
  it("over the byte cap evicts oldest until under", () => {
    const r = plan(["a", "b", "c"], { a: 6, b: 6, c: 6 }, 10, 12, 5);
    expect(r.evict).toEqual(["a"]);
    expect(r.bytes).toBe(12);
  });
  it("an entry with no recorded size counts at the estimate", () => {
    expect(plan(["a", "b"], { b: 1 }, 10, 3, 5).evict).toEqual(["a"]);
  });
});

describe("the worker under load", () => {
  it("120 photographs of 1 MB stay under 50 MB (before OFF-4: all 120 = 120 MB kept)", async () => {
    const w = loadWorker(() => MB);
    for (let i = 0; i < 120; i++) await w.fetchImage(img(i));
    const kept = w.entries();
    expect(kept.length).toBeLessThanOrEqual(50);
    expect(kept.length).toBeGreaterThan(40);
    // the NEWEST survive (LRU), the oldest went first
    expect(kept).toContain(img(119));
    expect(kept).not.toContain(img(0));
  });

  it("small thumbnails are still bounded by the 200-entry cap", async () => {
    const w = loadWorker(() => 1024);
    for (let i = 0; i < 230; i++) await w.fetchImage(img(i));
    expect(w.entries().length).toBe(200);
  });
});
