// Global image fallback.
//
// Some legacy content (seed journal/course/lesson covers) references external
// image hosts (e.g. images.unsplash.com) that can rate-limit, 503, or be blocked
// by a network/egress policy. When any <img> fails to load, we swap in a
// self-hosted, inline-SVG branded placeholder so users never see a broken-image
// icon. This is a single app-wide safety net — no per-component wiring needed.

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

/**
 * Install a capture-phase listener that replaces any failed <img> with the
 * branded placeholder. `error` events don't bubble, so capture is required.
 * Idempotent per-image via a data flag to avoid loops.
 */
export function installImageFallback(): void {
  if (typeof window === "undefined") return;
  window.addEventListener(
    "error",
    (event) => {
      const el = event.target as HTMLElement | null;
      if (!el || el.tagName !== "IMG") return;
      const img = el as HTMLImageElement;
      if (img.dataset.fallbackApplied === "1") return;
      // Never override an image that already resolved.
      if (img.currentSrc === IMAGE_PLACEHOLDER || img.src === IMAGE_PLACEHOLDER) return;
      img.dataset.fallbackApplied = "1";
      img.srcset = "";
      img.src = IMAGE_PLACEHOLDER;
    },
    true,
  );
}
