/**
 * F-D3-6 — the image service worker's cache is purged when a session ends.
 *
 * 1. purgeImageCache deletes every `gallery-images-*` cache (all versions) and
 *    nothing else; it never throws, even with Cache Storage missing or broken.
 * 2. The prefix still matches the cache the worker actually writes
 *    (public/sw-image-cache.js) — a renamed CACHE_NAME must turn this red, or
 *    the purge would silently delete nothing.
 * (AuthProvider's wiring: imageCachePurgeOnSignOut.test.tsx.)
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { purgeImageCache, GALLERY_CACHE_PREFIX } from "@/lib/imageCachePurge";

type FakeCaches = { keys: () => Promise<string[]>; delete: (n: string) => Promise<boolean>; store: Set<string> };
function fakeCaches(names: string[], opts: { failDelete?: string; failKeys?: boolean } = {}): FakeCaches {
  const store = new Set(names);
  return {
    store,
    keys: async () => { if (opts.failKeys) throw new Error("SecurityError"); return [...store]; },
    delete: async (n) => { if (n === opts.failDelete) throw new Error("boom"); return store.delete(n); },
  };
}

const realCaches = (globalThis as { caches?: unknown }).caches;
afterEach(() => { (globalThis as { caches?: unknown }).caches = realCaches; });

describe("purgeImageCache", () => {
  it("deletes every gallery-images-* cache, every version, and nothing else", async () => {
    const c = fakeCaches(["gallery-images-v3", "gallery-images-v2", "workbox-precache", "other"]);
    (globalThis as { caches?: unknown }).caches = c;
    expect(await purgeImageCache()).toEqual(["gallery-images-v2", "gallery-images-v3"]);
    expect([...c.store].sort()).toEqual(["other", "workbox-precache"]);
  });

  it("one cache failing does not stop the others", async () => {
    const c = fakeCaches(["gallery-images-v3", "gallery-images-v2"], { failDelete: "gallery-images-v2" });
    (globalThis as { caches?: unknown }).caches = c;
    expect(await purgeImageCache()).toEqual(["gallery-images-v3"]);
  });

  it("never throws: no Cache Storage -> null; keys() throws -> null", async () => {
    (globalThis as { caches?: unknown }).caches = undefined;
    expect(await purgeImageCache()).toBeNull();
    (globalThis as { caches?: unknown }).caches = fakeCaches([], { failKeys: true });
    expect(await purgeImageCache()).toBeNull();
  });
});

describe("the prefix matches what the worker writes", () => {
  it("public/sw-image-cache.js CACHE_NAME starts with GALLERY_CACHE_PREFIX", () => {
    const sw = readFileSync("public/sw-image-cache.js", "utf8");
    const name = (sw.match(/const CACHE_NAME = "([^"]+)"/) || [])[1];
    expect(name, "CACHE_NAME not found in the worker").toBeTruthy();
    expect(name!.startsWith(GALLERY_CACHE_PREFIX)).toBe(true);
  });
});

