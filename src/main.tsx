import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { startNetworkTrace } from "./lib/networkTracer";
import { runCacheBuster, stripCacheBusterParam } from "./lib/cacheBuster";
import { installImageFallback } from "./lib/imageFallback";
import { initNativeAuthDeepLink } from "./lib/native/authDeepLink";

import "./index.css";

// BUILD MARKER — bump this string on any release where the UI "mysteriously"
// doesn't update. It is a window side-effect (NOT a bare export, which gets
// tree-shaken away) so it survives into the bundle and forces a new hashed
// entry filename, busting year-cached immutable copies of the old bundle.
(window as any).__APP_BUILD = "2026-07-31-3";

startNetworkTrace(8000);

// Inside the installed app only: complete Google/Apple sign-in when the OAuth
// deep link (app.fiftymmretina://auth-callback) fires. No-op on web/PWA.
initNativeAuthDeepLink();

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
