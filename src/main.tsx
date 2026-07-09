import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { startNetworkTrace } from "./lib/networkTracer";
import { runCacheBuster } from "./lib/cacheBuster";
import { installImageFallback } from "./lib/imageFallback";

import "./index.css";

startNetworkTrace(8000);

// Replace any broken <img> (e.g. legacy external cover URLs) with a branded
// self-hosted placeholder so users never see a broken-image icon.
installImageFallback();

// Fire-and-forget: if the global `cache_buster` site_setting was bumped,
// this will purge SW + Cache Storage and hard-reload before App mounts.
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
