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
import { readSiteSettingState } from "@/lib/siteSettingsCache";
import { GALLERY_CACHE_PREFIX } from "@/lib/imageCachePurge";

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

/**
 * S7b-1b · THE REMOTE SWITCH (site_settings `app_image_sw`). Owner rule: never
 * switch a feature on without the Owner, so the worker runs only when the value
 * is "on". No row, or any other value, is OFF: the photo worker is unregistered
 * and its caches deleted. A switch that could not be READ (flight mode, a dead
 * link) is UNKNOWN and changes nothing — deleting the saved photos with no
 * network would destroy exactly what offline needs.
 */
export const IMAGE_SW_SETTING = "app_image_sw";
export type ImageWorkerSwitch = "on" | "off" | "unknown";

export function imageSwitchFrom(state: { known: boolean; value: unknown }): ImageWorkerSwitch {
  if (!state.known) return "unknown";
  return typeof state.value === "string" && state.value.trim().toLowerCase() === "on" ? "on" : "off";
}

export async function readImageWorkerSwitch(): Promise<ImageWorkerSwitch> {
  return imageSwitchFrom(await readSiteSettingState(IMAGE_SW_SETTING));
}

export interface ImageWorkerDeps {
  register(url: string): Promise<unknown>;
  getRegistrations(): Promise<ReadonlyArray<ServiceWorkerRegistration>>;
  cacheKeys(): Promise<string[]>;
  deleteCache(name: string): Promise<boolean>;
}

const IMAGE_WORKER_SCRIPT = "/sw-image-cache.js";

/** on → register; off → remove the photo worker and its caches; unknown → keep. Never throws. */
export async function applyImageWorkerSwitch(
  sw: ImageWorkerSwitch,
  workerUrl: string,
  deps: ImageWorkerDeps,
): Promise<"registered" | "removed" | "kept" | "failed"> {
  if (sw === "unknown") return "kept";
  try {
    if (sw === "on") {
      await deps.register(workerUrl);
      return "registered";
    }
    const regs = await deps.getRegistrations();
    const mine = regs.filter((r) => {
      const u = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || "";
      try {
        return new URL(u, "https://x.invalid").pathname === IMAGE_WORKER_SCRIPT;
      } catch {
        return false;
      }
    });
    await Promise.all(mine.map((r) => r.unregister()));
    const names = (await deps.cacheKeys()).filter((n) => n.startsWith(GALLERY_CACHE_PREFIX));
    await Promise.all(names.map((n) => deps.deleteCache(n)));
    return "removed";
  } catch {
    return "failed";
  }
}
