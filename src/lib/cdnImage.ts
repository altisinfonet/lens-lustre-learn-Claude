/**
 * RIGHT-SIZED IMAGES FROM cdn.50mmretina.com, WITH A GUARANTEED WAY BACK.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE CHANGING ANYTHING HERE. THIS ENDPOINT HAS BROKEN THE SITE
 * ONCE ALREADY — it was "images are not coming", reported many times.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT HAPPENED IN AUGUST
 *   On 2026-08-01 every post image was routed through
 *   `https://50mmretina.com/cdn-cgi/image/…` — the APEX host. Bandwidth fell
 *   89%, and the owner then reported for four days that photographs were
 *   missing. On 2026-08-05 he produced the decisive experiment himself, two
 *   browser windows side by side: the identical request succeeded from the
 *   apex and was killed at network level from **www**, which is what every
 *   member actually uses. The Android app is a third origin again, so builds
 *   1035–1051 showed no photos at all. It was ripped out the same day (the
 *   removed code is still quoted in PostMedia.tsx).
 *
 * WHAT IS DIFFERENT NOW — measured on production 2026-08-10, from a www page:
 *
 *     https://50mmretina.com/cdn-cgi/image/…   -> FAILS      (this is what August shipped)
 *     https://www.50mmretina.com/cdn-cgi/…     -> 900x506 OK
 *     https://cdn.50mmretina.com/cdn-cgi/…     -> 900x506 OK
 *
 *   The zone rules have INVERTED. The single origin the old code hardcoded is
 *   now the only one that does not work. That is the whole lesson: this is
 *   Cloudflare zone configuration, it lives outside this repository, no deploy
 *   or test here can see it change, and it HAS changed.
 *
 * THE TWO RULES THAT FOLLOW FROM THAT, and neither may be dropped:
 *
 *   1. ASK THE IMAGE'S OWN HOST. Requests go to `cdn.50mmretina.com`, the same
 *      host the file is on — never to the apex, never to `location.origin`.
 *      A page on www, a page on the apex and the Android app's own scheme all
 *      produce the identical request, so there is no origin left to get wrong.
 *
 *   2. EVERY IMAGE MUST BE ABLE TO FALL BACK BY ITSELF. If the transformer is
 *      switched off tomorrow, the worst that may happen is a heavier picture —
 *      never a missing one. Callers wire `onError` to `originalOnError()`.
 *      This is condition (b) that PostMedia.tsx said did not exist in August.
 *
 * WHY %2C AND NOT A COMMA
 *   `srcset` is a comma-separated list. A raw comma inside a candidate URL
 *   makes the browser fail to parse the whole attribute — `currentSrc` comes
 *   back empty and NO image loads. That shipped for a few minutes on
 *   2026-08-01 and the cards showed only their blurred backdrop. Both forms
 *   return a correct image; only this one survives srcset.
 */
import { CDN_HOST } from "@/lib/env";

/** The one host these transforms are ever addressed to. See rule 1 above.
 *  Lane-derived since 2026-08-22 — production unless the build says otherwise. */

/** True for a file served from our own image CDN. Everything else is left alone. */
export function isCdnImage(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).host === CDN_HOST;
  } catch {
    return false;
  }
}

/**
 * Transformable = one of ours, not already transformed, and not a format that
 * a resize would damage. A GIF loses its animation and an SVG loses the point
 * of being a vector.
 */
export function isResizable(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  if (url.includes("/cdn-cgi/image/")) return false;
  if (/\.(gif|svg)(\?|$)/i.test(url)) return false;
  return isCdnImage(url);
}

/**
 * One resized variant. Returns the URL UNCHANGED when it is not ours, so a
 * caller can pass anything without checking first.
 *
 * quality 82 was chosen against measurements on a real photograph of his:
 * 900px comes to ~40 KB, against 535 KB for the 2560px original and 11 KB for
 * the 600px thumbnail that was being stretched across the slot.
 */
export function cdnResized(url: string, width: number, quality = 82): string {
  if (!isResizable(url)) return url;
  const opts = [`width=${width}`, `quality=${quality}`, "format=auto"].join("%2C");
  return `https://${CDN_HOST}/cdn-cgi/image/${opts}/${url}`;
}

/**
 * A `srcset` string, so the BROWSER picks the size using the real slot width
 * and the real screen density — the two things this code cannot know.
 *
 * Returns "" when the URL is not ours, which React renders as no attribute at
 * all, so `src` alone applies.
 */
export function cdnSrcSet(url: string, widths: number[], quality = 82): string {
  if (!isResizable(url)) return "";
  return widths.map((w) => `${cdnResized(url, w, quality)} ${w}w`).join(", ");
}

/**
 * The fallback from rule 2, as a ready-made `onError` handler.
 *
 * Swaps the element back to the untransformed original and clears `srcset` so
 * the browser cannot immediately re-pick a transformed candidate. Guarded by a
 * data attribute so a genuinely broken file cannot loop for ever.
 *
 * The result if the transformer ever dies again: a heavier photograph. Not a
 * missing one. That is the entire reason this function exists.
 */
export function originalOnError(original: string) {
  return (e: { currentTarget: HTMLImageElement }) => {
    const img = e.currentTarget;
    if (img.dataset.cdnFallback === "1") return; // already tried; let it fail
    img.dataset.cdnFallback = "1";
    img.srcset = "";
    img.src = original;
  };
}
