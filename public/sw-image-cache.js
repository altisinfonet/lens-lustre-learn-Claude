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

async function trimCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_CACHE_ENTRIES;
  if (overflow > 0) {
    // keys() returns insertion order → oldest first → those are LRU victims.
    const toDelete = keys.slice(0, overflow);
    await Promise.all(toDelete.map((k) => cache.delete(k)));
  }
}
