/**
 * Service Worker — LRU cache for thumbnail/gallery images.
 *
 * Step 8: True LRU (not FIFO).
 *   - On cache HIT: re-`put` the response so it becomes the most-recently-used
 *     entry (Cache Storage preserves insertion order for `cache.keys()`).
 *   - On cache MISS: fetch + put + trim oldest until size <= MAX_CACHE_ENTRIES.
 *
 * Coverage: any image request whose URL points at one of our known thumbnail
 * sources (Supabase Storage public/render endpoints, Cloudflare R2 pub-*.r2.dev)
 * for the buckets we serve thumbnails from.
 *
 * Gate: returning to a previously rendered grid issues 0 network requests for
 * thumbnail URLs.
 */

/**
 * Bumped v2 -> v3 on 2026-08-05, deliberately.
 *
 * The `activate` handler below deletes every cache whose name is not
 * CACHE_NAME, so renaming purges the entire old image cache exactly once. That
 * is wanted here: entries stored by the previous version were written by code
 * that could not distinguish a healthy image from a failed one, and an image
 * cached under the old rules is never revalidated. Members re-download their
 * images once and then the cache refills under the corrected code.
 */
const CACHE_NAME = "gallery-images-v3";
const MAX_CACHE_ENTRIES = 200;

/**
 * OFF-4 (2026-10-04): a BYTE cap as well as an entry cap. 200 entries was the
 * only bound, and 200 full-size photographs can be 200+ MB on a phone. The cache
 * now also stays under MAX_CACHE_BYTES, evicting least-recently-used first.
 *
 * Each body is measured when it is stored. An entry with no recorded size
 * (stored before OFF-4) is counted at UNKNOWN_SIZE_ESTIMATE_BYTES — a deliberate
 * over-estimate for a feed thumbnail, so the cap errs towards evicting. The
 * sizes live in SIZE_INDEX_URL, a small JSON entry inside the same cache, so they
 * survive the worker being stopped; it is never served to a page.
 */
const MAX_CACHE_BYTES = 50 * 1024 * 1024;
const UNKNOWN_SIZE_ESTIMATE_BYTES = 250 * 1024;
const SIZE_INDEX_URL = "/__retina-image-cache-sizes__.json";

/**
 * Pure: which URLs to evict. `keysOldestFirst` is Cache Storage order (LRU
 * first, because a hit re-puts its entry). Evicts from the front until BOTH
 * caps hold. Exposed on `self` for the tests; the worker does not depend on it
 * being there.
 */
function planTrim(keysOldestFirst, sizes, maxEntries, maxBytes, unknownEstimate) {
  const sizeOf = (u) => (typeof sizes[u] === "number" ? sizes[u] : unknownEstimate);
  let count = keysOldestFirst.length;
  let bytes = keysOldestFirst.reduce((a, u) => a + sizeOf(u), 0);
  const evict = [];
  for (const u of keysOldestFirst) {
    if (count <= maxEntries && bytes <= maxBytes) break;
    evict.push(u);
    count -= 1;
    bytes -= sizeOf(u);
  }
  return { evict, count, bytes };
}
self.__retinaPlanTrim = planTrim;

const THUMB_BUCKETS = [
  "portfolio-images",
  "competition-photos",
  "post-images",
  "site-assets",
];

/** Match any image request that targets one of our thumbnail sources. */
function isGalleryImage(url) {
  let u;
  try { u = new URL(url); } catch { return false; }

  // Supabase Storage public OR render endpoint
  const sb = u.pathname.match(/^\/storage\/v1\/(?:object\/public|render\/image\/public)\/([^/]+)\//);
  if (sb && THUMB_BUCKETS.includes(sb[1])) return true;

  // Cloudflare R2 pub-XXXX.r2.dev/<bucket>/<key>
  if (u.hostname.endsWith(".r2.dev")) {
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length >= 2 && THUMB_BUCKETS.includes(parts[0])) return true;
  }
  return false;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (new URL(request.url).pathname === SIZE_INDEX_URL) return;
  if (request.method !== "GET") return;
  if (!isGalleryImage(request.url)) return;

  event.respondWith(handle(request));
});

async function handle(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    // LRU touch: re-insert clone so this URL becomes most-recently-used.
    // Fire-and-forget; do not block the response.
    cache.put(request, cached.clone()).catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Only `ok` responses are cached, exactly as before OFF-4. An OPAQUE
      // response (an <img> without crossorigin) is still not cached: Chromium
      // charges each opaque entry ~7 MB of padding against the origin's quota,
      // and quota pressure would evict the OFF-1 device store first.
      const copy = response.clone();
      const measure = response.clone().blob().then((b) => b.size).catch(() => null);
      Promise.all([cache.put(request, copy), measure])
        .then(([, size]) => recordSize(cache, request.url, size))
        .then(() => trimCache(cache))
        .catch(() => {});
    }
    return response;
  } catch (err) {
    /**
     * ───────────────────────────────────────────────────────────────────────
     * OWNER REPORT, 2026-08-05: "Images are not coming. Many times told, still
     * you not solved — all time images are not coming."
     *
     * THIS IS WHY IT WAS NEVER SOLVED.
     *
     * This branch used to return a **transparent 1x1 GIF** as an "offline
     * fallback". Read what that actually did:
     *
     *   * The browser treats a 1x1 GIF as a SUCCESSFUL image load.
     *   * So `<img onerror>` never fires — no retry anywhere in the app,
     *     because every retry path in this codebase hangs off onerror.
     *   * So no error is logged, nothing reaches the console, and nothing
     *     reaches `client_errors`.
     *   * The member sees an invisible picture. Permanently, until they
     *     happen to reload while the network is healthy.
     *
     * One dropped packet on mobile data and the photo silently disappeared,
     * leaving no trace for anyone to debug. That is the exact shape of a bug
     * that gets reported over and over and never gets found: the fallback was
     * destroying the evidence.
     *
     * A 1x1 GIF is only ever the right answer for a decorative tracking pixel.
     * For a photography community, where the image IS the product, a failure
     * must LOOK like a failure.
     *
     * ───────────────────────────────────────────────────────────────────────
     * WHAT IT DOES NOW
     *
     * Returns a real error response (504). The browser fires `onerror`, so:
     *   * `<img>` elements with a fallback show it;
     *   * the page can retry;
     *   * and the reporter added in src/lib/reportImageError.ts records the
     *     EXACT failing URL to `client_errors`, which is how the next report
     *     of this arrives as a URL instead of a screenshot.
     *
     * `Cache-Control: no-store` because a transient network failure must never
     * be remembered — that would be the /assets blank-page bug all over again.
     */
    return new Response("Image fetch failed: " + (err && err.message ? err.message : "network error"), {
      status: 504,
      statusText: "Image Fetch Failed",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}

async function readSizes(cache) {
  try {
    const r = await cache.match(SIZE_INDEX_URL);
    return r ? await r.json() : {};
  } catch {
    return {};
  }
}

async function writeSizes(cache, sizes) {
  await cache.put(SIZE_INDEX_URL, new Response(JSON.stringify(sizes), { headers: { "Content-Type": "application/json" } }));
}

async function recordSize(cache, url, size) {
  if (typeof size !== "number") return;
  const sizes = await readSizes(cache);
  sizes[url] = size;
  await writeSizes(cache, sizes);
}

async function trimCache(cache) {
  const keys = (await cache.keys()).map((k) => k.url).filter((u) => new URL(u).pathname !== SIZE_INDEX_URL);
  const sizes = await readSizes(cache);
  // keys() returns insertion order → oldest first → those are LRU victims.
  const { evict } = planTrim(keys, sizes, MAX_CACHE_ENTRIES, MAX_CACHE_BYTES, UNKNOWN_SIZE_ESTIMATE_BYTES);
  if (evict.length === 0) return;
  await Promise.all(evict.map((u) => cache.delete(u)));
  for (const u of evict) delete sizes[u];
  await writeSizes(cache, sizes);
}
