/**
 * Cache-Buster Bootstrap
 *
 * Reads the global `cache_buster` site_setting:
 *   { enabled: boolean, version: number }
 *
 * When `enabled=true` and the persisted local version differs from the
 * server version, this:
 *   1. Unregisters every Service Worker registration.
 *   2. Wipes Cache Storage (PWA / Workbox / image caches).
 *   3. Persists the new version to localStorage.
 *   4. Hard-reloads the tab with a `?cb=<version>` query so the
 *      browser HTTP cache is forced to revalidate the bundle.
 *
 * Safe to call once on app start; failures are swallowed so the app
 * never gets blocked by a cache-bust attempt.
 */
import { supabase } from "@/integrations/supabase/client";

const LOCAL_KEY = "lov:cache_buster_version";
const QUERY_KEY = "cb";

type CacheBusterValue = { enabled?: boolean; version?: number } | null;

export async function runCacheBuster(): Promise<void> {
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "cache_buster")
      .maybeSingle();

    const value = (data?.value ?? null) as CacheBusterValue;
    if (!value || !value.enabled) return;

    const serverVersion = Number(value.version ?? 0);
    if (!Number.isFinite(serverVersion) || serverVersion <= 0) return;

    const localRaw = localStorage.getItem(LOCAL_KEY);
    const localVersion = localRaw ? Number(localRaw) : 0;
    if (localVersion === serverVersion) return; // already up to date

    // Persist BEFORE reload so we don't loop forever.
    localStorage.setItem(LOCAL_KEY, String(serverVersion));

    // Best-effort: drop service workers and caches.
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      }
    } catch {
      /* noop */
    }
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
      }
    } catch {
      /* noop */
    }

    // Hard-reload with cache-bust query so HTTP caches must revalidate.
    const url = new URL(window.location.href);
    url.searchParams.set(QUERY_KEY, String(serverVersion));
    window.location.replace(url.toString());
  } catch {
    /* swallow — never block the app */
  }
}
