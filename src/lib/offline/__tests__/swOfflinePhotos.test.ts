/**
 * S7b-1 · photos seen online are on the phone when the network is gone.
 *
 * Owner 2026-10-29 (app 1.2.29): "in no network, poor network … Instagram …
 * user can see like normally". Measured on live the same day: 192 of 192 feed
 * photos come from cdn.50mmretina.com, and public/sw-image-cache.js only
 * recognised Supabase Storage and *.r2.dev — so it saved NONE of them. And an
 * <img> without crossorigin is fetched "no-cors"; its opaque response is never
 * cached (OFF-4). The CDN sends Access-Control-Allow-Origin for both the site
 * and the app (https://localhost), so the worker asks for a CORS response.
 *
 * Same sandbox as swImageCacheCap.test.ts: the real worker file, a fake Cache
 * Storage and a fake network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadWorker() {
  const store = new Map<string, Map<string, Response>>();
  const listeners: Record<string, (e: unknown) => void> = {};
  const seen: { url: string; mode: string }[] = [];
  let online = true;
  let storageBroken = false;
  const caches = {
    async open(name: string) {
      if (storageBroken) throw new DOMException("QuotaExceededError");
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
    fetch: async (r: Request) => {
      seen.push({ url: r.url, mode: r.mode });
      if (!online) throw new TypeError("Failed to fetch");
      return new Response(new Uint8Array(30 * 1024), { status: 200, headers: { "content-type": "image/webp" } });
    },
  });
  vm.runInContext(readFileSync("public/sw-image-cache.js", "utf8"), ctx);

  /** Dispatch a fetch event like an <img> does (no-cors). Null = not intercepted. */
  const fetchImage = async (url: string): Promise<Response | null> => {
    let p: Promise<Response> | undefined;
    listeners.fetch({ request: new Request(url, { mode: "no-cors" }), respondWith: (x: Promise<Response>) => { p = x; } });
    const res = p ? await p : null;
    await new Promise((r) => setTimeout(r, 5));
    return res;
  };
  const entries = () => [...(store.get("gallery-images-v3")?.keys() ?? [])].filter((u) => !u.includes("__retina-image-cache-sizes__"));
  return {
    fetchImage, entries, seen,
    setOnline: (v: boolean) => { online = v; },
    breakStorage: () => { storageBroken = true; },
  };
}

const LIVE = "https://cdn.50mmretina.com/post-images/0b4c/posts/1793283700674-dgibftu4cje-w2560h1920-l3.webp";
const LIVE_THUMB = "https://cdn.50mmretina.com/post-images/0b4c/posts/1793283700674-dgibftu4cje-w2560h1920-l3-thumb.webp";
const STAGING = "https://cdn-staging.50mmretina.com/post-images/9a1e/posts/1-x-w1080h1080.webp";

describe("photos from our CDN are saved on the phone", () => {
  it("a live CDN photo and its thumbnail are intercepted and stored", async () => {
    const w = loadWorker();
    expect(await w.fetchImage(LIVE)).not.toBeNull();
    expect(await w.fetchImage(LIVE_THUMB)).not.toBeNull();
    expect(w.entries()).toEqual(expect.arrayContaining([LIVE, LIVE_THUMB]));
  });

  it("the staging CDN too (the same app build tests there first)", async () => {
    const w = loadWorker();
    await w.fetchImage(STAGING);
    expect(w.entries()).toContain(STAGING);
  });

  it("asks the CDN for a CORS response, so the photo is not opaque (opaque is never stored)", async () => {
    const w = loadWorker();
    await w.fetchImage(LIVE);
    expect(w.seen.find((s) => s.url === LIVE)?.mode).toBe("cors");
  });

  it("with no network, a photo seen before is shown from the phone", async () => {
    const w = loadWorker();
    await w.fetchImage(LIVE);
    w.setOnline(false);
    const res = await w.fetchImage(LIVE);
    expect(res?.status).toBe(200);
  });

  it("a photo never seen, with no network, still FAILS visibly (504), never a blank success", async () => {
    const w = loadWorker();
    w.setOnline(false);
    expect((await w.fetchImage(LIVE))?.status).toBe(504);
  });

  it("NEVER a private photo (a pass or signature in the URL, or the S3-d photo/ path)", async () => {
    const w = loadWorker();
    expect(await w.fetchImage("https://cdn.50mmretina.com/photo/u1/m1/w1080.webp?t=abc")).toBeNull();
    expect(await w.fetchImage("https://cdn.50mmretina.com/photo/u1/m1/w1080.webp")).toBeNull();
    expect(await w.fetchImage(`${LIVE}?t=abc`)).toBeNull();
    expect(await w.fetchImage(`${LIVE}?token=abc`)).toBeNull();
    expect(await w.fetchImage("https://x.supabase.co/storage/v1/object/sign/post-images/a.webp?token=abc")).toBeNull();
    expect(w.entries()).toEqual([]);
  });

  it("a size setting in the URL is still saved (render endpoint thumbnails)", async () => {
    const w = loadWorker();
    const u = "https://x.supabase.co/storage/v1/render/image/public/post-images/a.webp?width=600&quality=70";
    expect(await w.fetchImage(u)).not.toBeNull();
    expect(w.entries()).toContain(u);
  });

  it("if the phone's storage breaks, the photo still comes from the network", async () => {
    const w = loadWorker();
    w.breakStorage();
    expect((await w.fetchImage(LIVE))?.status).toBe(200);
  });

  it("other hosts and our own app files are left alone", async () => {
    const w = loadWorker();
    expect(await w.fetchImage("https://example.com/post-images/a/b.webp")).toBeNull();
    expect(await w.fetchImage("https://cdn.50mmretina.com/video/a/b.mp4")).toBeNull();
    expect(await w.fetchImage("https://www.50mmretina.com/assets/index-abc.js")).toBeNull();
  });
});
