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

const CACHE_NAME = "gallery-images-v2";
const MAX_CACHE_ENTRIES = 200;

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
      cache.put(request, response.clone()).then(() => trimCache(cache)).catch(() => {});
    }
    return response;
  } catch {
    // Offline fallback — transparent 1x1 GIF
    return new Response(
      new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
        0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
        0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
        0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
        0x01, 0x00, 0x3b,
      ]),
      { headers: { "Content-Type": "image/gif" } }
    );
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_CACHE_ENTRIES;
  if (overflow > 0) {
    // keys() returns insertion order → oldest first → those are LRU victims.
    const toDelete = keys.slice(0, overflow);
    await Promise.all(toDelete.map((k) => cache.delete(k)));
  }
}
