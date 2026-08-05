/**
 * A MISSING FILE UNDER /assets/* MUST RETURN 404 — NOT index.html.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS ENDS (owner-reported for ~30 days, root-caused 2026-08-05)
 *
 * Cloudflare Pages serves the SPA shell for any path it cannot find. That is
 * correct for routes — `/feed` has no file and must still render the app — but
 * catastrophic for `/assets/*`, because those filenames are content-hashed and
 * a deploy deletes the old ones.
 *
 * Measured against production before this function existed:
 *
 *     GET /assets/AdminPushBroadcast-D_bNnshh.js   ->  200   text/html
 *
 * The browser then refused it, correctly:
 *
 *     Failed to load module script: Expected a JavaScript-or-Wasm module script
 *     but the server responded with a MIME type of "text/html".
 *
 * And it got far worse than a single failed load, because `public/_headers`
 * gives everything under `/assets/*`:
 *
 *     Cache-Control: public, max-age=31536000, immutable
 *
 * So the browser stored that HTML **under a `.js` URL, marked immutable, for a
 * year**. Every later attempt was served the poisoned copy from disk. That is
 * why reloading never fixed it and why members hit it for a month.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 *
 * `context.next()` hands the request to the normal static-asset pipeline, so a
 * real asset is returned untouched — same bytes, same `_headers` caching. Only
 * when that pipeline answers with HTML do we intervene: nothing legitimately
 * served from `/assets/` is ever `text/html`, so an HTML response there is the
 * SPA fallback for a file that no longer exists.
 *
 * In that case we return a genuine 404 with `Cache-Control: no-store`, which is
 * the half that matters most: a 404 must never be cached, or we would simply
 * have replaced one poisoned cache entry with another.
 *
 * The client already knows what to do with a failed chunk — `lazyRetry` in
 * `src/App.tsx` evicts the cached `/assets/` entries, reports it, and reloads
 * with a cache-busting parameter to pick up the new `index.html`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `public/404.html` OR A `_redirects` RULE
 *
 * Adding `404.html` switches Pages out of SPA mode entirely, so `/feed` and
 * every other client route would start returning 404 — it trades a chunk bug
 * for a broken site. And `_redirects` officially supports rewrites and 3xx
 * redirects; relying on it to emit a 404 is not something to gamble a live
 * product on. A Function is explicit and verifiable, and this repo already uses
 * Pages Functions (see `functions/_seo.ts`).
 *
 * COST: one worker invocation per `/assets/*` request that reaches the origin.
 * Cloudflare caches these at the edge under the immutable header, so in
 * practice the vast majority never get here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const onRequest = async (context: any) => {
  const res = await context.next();

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    // A real asset — JS, CSS, a font, an image. Untouched.
    return res;
  }

  // HTML under /assets/ means "this file is gone". Say so, honestly.
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // NEVER cache a 404 here. Caching it would recreate the original bug in
      // a new shape: the file may well exist again after the next deploy.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
