import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { startNetworkTrace } from "./lib/networkTracer";
import { runCacheBuster, stripCacheBusterParam } from "./lib/cacheBuster";
import { installImageFallback } from "./lib/imageFallback";
import { installImageErrorReporter } from "./lib/reportImageError";
import { installOverlayUnfreeze } from "./lib/unfreezeStuckOverlay";
import { initNativeAuthDeepLink } from "./lib/native/authDeepLink";

import "./index.css";

// BUILD MARKER — bump this string on any release where the UI "mysteriously"
// doesn't update. It is a window side-effect (NOT a bare export, which gets
// tree-shaken away) so it survives into the bundle and forces a new hashed
// entry filename, busting year-cached immutable copies of the old bundle.
(window as any).__APP_BUILD = "2026-08-06-8";

// DEVELOPMENT ONLY — owner decision, 2026-08-06.
//
// Until today this line ran UNCONDITIONALLY. The tracer wraps window.fetch,
// clones and fully reads the body of every API response to measure its size,
// and then prints a forensic report — on every member's phone, in production.
// The owner ruled: gate it to development AND convert it to the logger.
//
// The guard is duplicated inside startNetworkTrace() itself (same pattern as
// decisionParityProbe.ts), so a future call site cannot re-open this by
// accident. Vite evaluates import.meta.env.DEV at build time, so the whole
// branch is removed from the production bundle.
if (import.meta.env.DEV) {
  startNetworkTrace(8000);
}

// Inside the installed app only: complete Google/Apple sign-in when the OAuth
// deep link (app.fiftymmretina://auth-callback) fires. No-op on web/PWA.
initNativeAuthDeepLink();

/**
 * ORDER IS LOAD-BEARING — RECORD FIRST, THEN HIDE.
 *
 * Owner, 2026-08-05: *"Images are not coming. Many times told, still you not
 * solved."* Two lines of this file are why it was never solved:
 *
 *   * `installImageFallback()` below replaces ANY failed <img> with a dark
 *     branded "50mm RETINA WORLD" placeholder. So a failed photo does not look
 *     like an error — it looks like the app decided to show a grey box. That is
 *     the exact thing he keeps describing, and it swallowed the evidence.
 *   * Nothing recorded the URL. Chrome's console truncates an image failure to
 *     `Failed to load resource: … 404 ()` with no address, so even a screenshot
 *     of the console could not say WHICH image.
 *
 * Both listeners are capture-phase on `window` and therefore fire in
 * REGISTRATION order. The reporter must be registered FIRST so it sees the real
 * `currentSrc` before the fallback overwrites it with the placeholder data URI.
 * Swapping these two lines would silently disable the reporting again.
 */
installImageErrorReporter();

/**
 * "after just a touch report content entire screen got freezed. until app
 * restarted nothing working." — owner, 2026-08-05.
 *
 * A menu or dialog that dies mid-close leaves pointer-events: none on the body
 * and the whole page stops responding. This clears that lock, and ONLY when no
 * overlay is legitimately open. See src/lib/unfreezeStuckOverlay.ts.
 */
installOverlayUnfreeze();

// Replace any broken <img> (e.g. legacy external cover URLs) with a branded
// self-hosted placeholder so users never see a broken-image icon.
installImageFallback();

// Clean a leftover ?cb=<n> out of the address bar (no navigation, cosmetic).
stripCacheBusterParam();

// Fire-and-forget: if the global `cache_buster` site_setting was bumped,
// this will purge SW + Cache Storage and hard-reload before App mounts.
// First-time browsers are skipped inside — see cacheBuster.ts.
void runCacheBuster();

createRoot(document.getElementById("root")!).render(<App />);

// Register only image-caching service worker and clean stale app-shell workers.
// Guards: skip inside iframes, preview hosts, and non-production builds.
if ("serviceWorker" in navigator) {
  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true; // Assume iframe if cross-origin security blocks access
    }
  })();

  const isPreviewHost =
    window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com") ||
    window.location.hostname === "localhost";

  if (isPreviewHost || isInIframe) {
    // Unregister any existing service workers in preview/iframe/dev contexts
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((r) => r.unregister());
    });
  } else if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          const staleRegistrations = registrations.filter((registration) => {
            const scriptUrl =
              registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
            return scriptUrl.includes("/sw.js") || scriptUrl.includes("workbox");
          });

          await Promise.all(staleRegistrations.map((registration) => registration.unregister()));

          if ("caches" in window) {
            const cacheKeys = await caches.keys();
            const staleCacheKeys = cacheKeys.filter(
              (key) => key.startsWith("workbox-") || key.includes("precache") || key.includes("runtime"),
            );
            await Promise.all(staleCacheKeys.map((key) => caches.delete(key)));
          }
        } catch {
          // Best effort cleanup; continue to registration either way.
        }

        navigator.serviceWorker.register("/sw-image-cache.js").catch(() => {
          // SW registration failed — images will load normally without caching
        });
      })();
    });
  }
}
