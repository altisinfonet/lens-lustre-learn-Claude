/**
 * /images/* — ONE Cache-Control, not three concatenated. P14.
 *
 * ───────────────────────────────────────────────────────────
 * MEASURED BEFORE THIS FILE (2026-10-04 ~08:42 UTC, both lanes, by curl):
 *
 *   GET /images/logo-fallback.webp
 *   cache-control: no-store, no-cache, must-revalidate, proxy-revalidate,
 *                  public, max-age=2592000, immutable,
 *                  public, max-age=31536000, immutable
 *   cf-cache-status: BYPASS
 *
 * Cloudflare Pages gives a request EVERY matching `_headers` rule and joins a
 * repeated header with commas. `/*`, `/images/*` and `/*.webp` all matched, so
 * three policies were sent at once and `no-store` — first, and strongest —
 * won. The boot loader's logo (the harness's LCP element, F-D3-4) was
 * re-downloaded on every page load, and the edge never cached it.
 *
 * This is the same failure `functions/assets/[[path]].ts` already fixed for
 * `/assets/*`, fixed the same way: pass the real file through untouched and
 * SET the header, so exactly one policy reaches the browser. `_headers` has no
 * documented way to remove an inherited value inside the rule that replaces
 * it, so the Function is the mechanism this repository has already proven.
 *
 * POLICY (stated in docs/evidence/d2/P14/cache-policy.md):
 *   public, max-age=86400, stale-while-revalidate=604800
 * One day fresh, a week served-stale-while-refreshing. NOT `immutable` and
 * not a year: these names are not content-hashed (`logo.png` is replaced in
 * place), so a long immutable lifetime would pin an old logo for the life of
 * the cache. The ETag Pages already sends makes the daily revalidation a 304.
 *
 * A miss (Pages answers an absent file with the SPA's HTML) becomes a real 404
 * that is never cached — an HTML page under an image URL is the same poison
 * `/assets/` suffered.
 * ───────────────────────────────────────────────────────────
 */
const IMAGE_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

export const onRequest = async (context: { next: () => Promise<Response> }) => {
  const res = await context.next();
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", IMAGE_CACHE_CONTROL);
    return out;
  }
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
