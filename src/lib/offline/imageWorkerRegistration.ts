/**
 * S7b-1 · where the photo-saving service worker (public/sw-image-cache.js) runs.
 *
 * Before 2026-10-29 src/main.tsx unregistered it whenever the page's hostname
 * was "localhost", meaning "a developer's machine". The installed Android app's
 * origin is https://localhost (Capacitor), so the app never saved a single
 * photo for a weak or missing network. Capacitor 8.5 serves worker scripts
 * through its bridge on Android (`android.resolveServiceWorkerRequests`,
 * default true), so the worker runs there.
 *
 * iOS stays out: WKWebView does not run service workers for the app's own
 * scheme, and registering would only fail.
 */
export interface ImageWorkerContext {
  hostname: string;
  inIframe: boolean;
  /** import.meta.env.PROD */
  prod: boolean;
  /** Inside the installed Android app. */
  nativeAndroid: boolean;
  /** Inside the installed iOS app. */
  nativeIOS: boolean;
}

export type ImageWorkerDecision = "register" | "unregister" | "skip";

/**
 * The worker's URL carries this lane's CDN host (`?cdn=`), so the worker file
 * itself names no host and each lane's bundle names only its own CDN.
 */
export function imageWorkerUrl(cdnHost: string | null | undefined): string {
  const h = (cdnHost ?? "").trim();
  return h ? `/sw-image-cache.js?cdn=${encodeURIComponent(h)}` : "/sw-image-cache.js";
}

export function imageWorkerDecision(c: ImageWorkerContext): ImageWorkerDecision {
  if (c.nativeIOS) return "unregister";
  const previewHost =
    c.hostname.includes("id-preview--") ||
    c.hostname.includes("lovableproject.com") ||
    (c.hostname === "localhost" && !c.nativeAndroid);
  if (previewHost || c.inIframe) return "unregister";
  return c.prod ? "register" : "skip";
}
