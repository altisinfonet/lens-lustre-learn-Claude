// Global image fallback.
//
// ─────────────────────────────────────────────────────────────────────────────
// OWNER REPORT, 2026-08-05, repeated many times before that:
//
//   "Images are not coming. Many times told, still you not solved — all time
//    images are not coming."
//
// THIS FILE WAS THE REASON IT LOOKED LIKE THAT, AND THE REASON IT NEVER GOT
// FIXED. The original version did exactly one thing on an image error: it
// replaced the <img> with a dark branded placeholder, immediately, permanently,
// and silently. So:
//
//   * ONE dropped packet — a tunnel, a lift, a weak 4G moment, a CDN edge
//     hiccup — and the photo became a grey box.
//   * It NEVER retried. The placeholder is a data: URI, so once swapped in
//     there is no further error and nothing ever tries the real photo again.
//     The only cure was a full page reload, which most members will not do;
//     they just see a photography site with no photographs.
//   * It logged NOTHING, so no report ever carried a URL and there was never
//     anything to investigate.
//
// A placeholder is the right answer for content that is genuinely gone (the
// legacy external journal/course covers this was written for). It is the wrong
// answer for a photo that is merely late.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT DOES NOW: RETRY TWICE, THEN GIVE UP VISIBLY.
//
//   attempt 1 failed -> wait  400ms -> reload the SAME url with a cache-busting
//                                      param (so a poisoned cache entry, a 504
//                                      from the image service worker, or a
//                                      half-downloaded response is bypassed)
//   attempt 2 failed -> wait 1200ms -> one more try
//   attempt 3 failed -> placeholder, and the failure is reported with its URL
//                       by src/lib/reportImageError.ts
//
// The delays are deliberate and small: 400ms is below the threshold where a
// member reads the gap as "broken", and the total worst case (1.6s) is far less
// than the time it takes to notice a grey box and complain about it.
//
// WHY A CACHE-BUSTING PARAM AND NOT A PLAIN RE-ASSIGNMENT: re-setting `src` to
// the identical string is a no-op in every browser — the element is already at
// that URL. Even forcing it would usually be answered from the same broken HTTP
// cache entry that failed the first time. A unique query string guarantees a
// genuinely new request. Our image hosts ignore unknown query parameters, and
// the retry URL is never persisted anywhere.
//
// WHAT IS DELIBERATELY UNCHANGED: the placeholder itself, and the fact that a
// permanently-dead image ends up showing it rather than a broken-image icon.
// That part was right.

// Neutral dark, brand-tinted 3:2 placeholder (aperture ring + wordmark).
// Encoded as a data URI so it has ZERO network dependency and always renders.
const PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f1420"/>
      <stop offset="1" stop-color="#1b2436"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <g fill="none" stroke="#3b4a63" stroke-width="6" opacity="0.55" transform="translate(600 360)">
    <circle r="96"/>
    <circle r="62"/>
  </g>
  <text x="600" y="520" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-size="46" letter-spacing="8" fill="#5b6b86">50mm RETINA WORLD</text>
</svg>`.trim();

export const IMAGE_PLACEHOLDER =
  "data:image/svg+xml," + encodeURIComponent(PLACEHOLDER_SVG);

/** Two retries, then the placeholder. */
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [400, 1200];

/** The query key used to force a fresh request. Stripped before re-adding. */
const RETRY_PARAM = "__r";

/**
 * The address with our own retry bookkeeping removed, so a URL can be compared
 * against data-original-src no matter which attempt it is currently on.
 */
function stripRetryParam(url: string): string {
  if (!url || /^(data|blob):/i.test(url)) return url;
  try {
    const u = new URL(url, location.href);
    u.searchParams.delete(RETRY_PARAM);
    return u.toString();
  } catch {
    return url;
  }
}

function withRetryParam(url: string, attempt: number): string {
  // A data: or blob: URL can never be retried usefully.
  if (/^(data|blob):/i.test(url)) return url;
  try {
    const u = new URL(url, location.href);
    u.searchParams.set(RETRY_PARAM, String(attempt));
    return u.toString();
  } catch {
    return url + (url.includes("?") ? "&" : "?") + RETRY_PARAM + "=" + attempt;
  }
}

/**
 * Install a capture-phase listener that retries a failed <img> and, only after
 * the retries are exhausted, replaces it with the branded placeholder.
 *
 * `error` events from <img> do NOT bubble, so capture is required — a normal
 * listener would never fire at all.
 *
 * NOTE ON ORDER: src/main.tsx installs the error REPORTER before this. Both are
 * capture listeners on `window` and fire in registration order, so the reporter
 * still sees the real failing URL rather than the placeholder. Do not reorder.
 */
export function installImageFallback(): void {
  if (typeof window === "undefined") return;

  window.addEventListener(
    "error",
    (event) => {
      const el = event.target as HTMLElement | null;
      if (!el || el.tagName !== "IMG") return;
      const img = el as HTMLImageElement;

      // Never override an image that already resolved to the placeholder.
      if (img.currentSrc === IMAGE_PLACEHOLDER || img.src === IMAGE_PLACEHOLDER) return;

      /**
       * THE RETRY STATE BELONGS TO A URL, NOT TO A DOM NODE.
       *
       * REGRESSION SHIPPED EARLIER TODAY, reported by the owner within the
       * hour: "search whatever we have developped all malfucnting, app hang
       * after a search, backspace not working."
       *
       * React REUSES <img> elements. A search box re-renders its result list on
       * every keystroke and hands the same node a different person's photo.
       * data-* attributes are not cleared by React, so the retry bookkeeping
       * from the PREVIOUS occupant survived onto the next one:
       *
       *   * fallbackApplied="1" made a healthy new photo skip straight to the
       *     grey placeholder with no attempt at all;
       *   * retryCount="2" did the same;
       *   * and worst, a pending 400ms / 1200ms timer would fire after the node
       *     had been recycled and overwrite the NEW person's avatar with the OLD
       *     person's URL — wrong faces, flickering, and on a phone a storm of
       *     cache-busting requests (__r= deliberately bypasses the cache) with
       *     every letter typed. That is the hang.
       *
       * Resetting whenever the underlying URL changes makes the state follow the
       * image instead of the element, which is what it always meant.
       */
      const liveSrc = stripRetryParam(img.currentSrc || img.src);
      if (img.dataset.originalSrc && img.dataset.originalSrc !== liveSrc) {
        delete img.dataset.originalSrc;
        delete img.dataset.retryCount;
        delete img.dataset.fallbackApplied;
      }

      // Already given up on THIS url.
      if (img.dataset.fallbackApplied === "1") return;

      const attempts = Number(img.dataset.retryCount || "0");

      if (attempts < MAX_RETRIES) {
        // Remember the ORIGINAL url once, so retry N+1 is built from the clean
        // address rather than from one that already carries a retry param.
        // Stored WITHOUT any retry parameter so it compares equal to liveSrc on
        // every later error for this same image. Storing the raw src would make
        // attempt 2 look like a different photo and reset the counter forever —
        // an unbounded retry loop.
        if (!img.dataset.originalSrc) {
          img.dataset.originalSrc = liveSrc;
        }
        const original = img.dataset.originalSrc;
        if (!original || /^data:/i.test(original)) {
          img.dataset.fallbackApplied = "1";
          img.srcset = "";
          img.src = IMAGE_PLACEHOLDER;
          return;
        }

        const next = attempts + 1;
        img.dataset.retryCount = String(next);

        window.setTimeout(() => {
          // The element may have been unmounted while we waited — React
          // recycles feed rows aggressively during a scroll.
          if (!img.isConnected) return;
          if (img.dataset.fallbackApplied === "1") return;
          /**
           * AND IT MAY HAVE BEEN GIVEN A DIFFERENT PHOTO WHILE WE WAITED.
           *
           * Without this line the timer wrote the OLD person's URL over the NEW
           * person's avatar — see the regression note above. Re-reading the
           * dataset (rather than trusting the original captured in the closure)
           * is the check: if anything reset or replaced it, this retry is stale
           * and must be dropped silently.
           */
          if (img.dataset.originalSrc !== original) return;
          /**
           * AND THE COMPONENT ITSELF MAY HAVE MOVED ON.
           *
           * "IMAGE BROKEN" INCIDENT, 2026-08-07 (owner screenshots: many posts
           * showing the branded placeholder). A component-level fallback — like
           * ProgressiveImage swapping a failed thumbnail for the original — sets
           * a NEW src on this same element via React. The dataset check above
           * cannot see that: the dataset was written by US for the OLD url, and
           * React setting `src` clears nothing. So the timer fired, overwrote
           * React's healthy fallback url with the dead one it was retrying, the
           * dead url failed again, and after two rounds this handler planted the
           * permanent placeholder — even though the component had a working url
           * on screen the whole time. The retry may only proceed if the element
           * is still actually showing the url it is a retry OF; if anything gave
           * the element a different address, that address wins and this retry is
           * stale.
           */
          if (stripRetryParam(img.currentSrc || img.src) !== original) return;
          // `srcset` would win over `src` and re-serve the same failing
          // candidate, so it has to go before the retry can mean anything.
          img.srcset = "";
          img.src = withRetryParam(original, next);
        }, RETRY_DELAYS_MS[attempts] ?? 1200);

        return;
      }

      // Out of retries: this image is genuinely unavailable. Show the
      // placeholder. The URL has already been recorded by the reporter.
      img.dataset.fallbackApplied = "1";
      img.srcset = "";
      img.src = IMAGE_PLACEHOLDER;
    },
    true,
  );
}
