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

/**
 * Remove a leftover `?cb=<n>` from the address bar without navigating.
 * The bust itself needs the query to force a revalidation, but once the page
 * has loaded there is no reason to keep it — it was sticking in the URL bar,
 * in bookmarks and in shared links forever (owner report 2026-07-30).
 */
export function stripCacheBusterParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(QUERY_KEY)) return;
    url.searchParams.delete(QUERY_KEY);
    const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash;
    window.history.replaceState(window.history.state, "", clean);
  } catch {
    /* noop — cosmetic only */
  }
}

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

    // FIRST-VISIT FAST PATH (fix 2026-07-30).
    // A browser with no recorded version has never loaded this app before: it
    // has no service worker and no Cache Storage from us, and it just fetched
    // the CURRENT index.html and the CURRENT hashed bundle. There is nothing
    // stale to bust. Reloading it anyway fired location.replace() while React
    // was still mounting, which is exactly the "page is blank the first time,
    // fine after a refresh" report — and it left ?cb=<n> stuck in the URL.
    // Record the version and return; the emergency lever below still works for
    // returning users, who are the ones that can actually hold a stale build.
    if (localVersion === 0) return;

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
