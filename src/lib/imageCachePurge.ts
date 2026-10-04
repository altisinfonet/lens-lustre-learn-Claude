/**
 * Purge the image service worker's cache when a session ends. F-D3-6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. `public/sw-image-cache.js` keeps up to 200 images in Cache Storage
 * (`gallery-images-v3`), including `post-images` — Friends-only posts among
 * them. Nothing removed them at sign-out, so on a shared phone or computer the
 * next person to use the browser could read the previous member's private
 * images straight out of the cache (DevTools → Application → Cache Storage, or
 * simply by visiting a URL the cache answers). D-002 (PrivacyGapNotice) is about
 * the bucket; this is the same exposure one layer closer to the device.
 *
 * WHAT. Delete every cache whose name starts with GALLERY_CACHE_PREFIX — all
 * versions, not just the current one, so an old `v2` left behind by a worker
 * that never activated cannot survive either. Cache Storage is shared between a
 * page and its service worker, so the page can delete it directly; no message
 * to the worker is needed, and a worker that is not running is not a problem.
 *
 * WHERE IT IS CALLED. From the `SIGNED_OUT` branch of useAuth's
 * onAuthStateChange — the one place every way a session ends passes through:
 * the Log out button, a global sign-out from another device, a deleted account,
 * an expired refresh token, and another tab signing out (Supabase broadcasts
 * the event across tabs).
 *
 * NEVER BLOCKS AND NEVER THROWS. A sign-out must complete even where Cache
 * Storage is missing (old WebView), denied (private mode) or broken. The
 * return value says what happened so the test can see it; callers ignore it.
 *
 * KNOWN LIMIT, stated: an image request already in flight when the purge runs
 * can still be written by the worker a moment later. The next sign-in replaces
 * the cache's contents through LRU, and the worker only caches what the signed-
 * in member's own page requested.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const GALLERY_CACHE_PREFIX = "gallery-images-";

/** Deletes every gallery image cache. Resolves to the names deleted, or null when Cache Storage is unavailable. */
export async function purgeImageCache(): Promise<string[] | null> {
  try {
    if (typeof caches === "undefined" || !caches || typeof caches.keys !== "function") return null;
    const names = (await caches.keys()).filter((k) => k.startsWith(GALLERY_CACHE_PREFIX));
    const deleted: string[] = [];
    await Promise.all(
      names.map(async (n) => {
        try {
          if (await caches.delete(n)) deleted.push(n);
        } catch { /* one cache failing must not stop the others */ }
      }),
    );
    return deleted.sort();
  } catch {
    return null;
  }
}
