/**
 * Shared, batched reader for site_settings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (2026-08-01)
 *
 * site_settings was read with supabase.from("site_settings")… from **77
 * separate call sites**, with no shared accessor. Measured on the production
 * feed: **23 requests across only 8 distinct keys — 15 of them byte-for-byte
 * identical repeats.** Full numbers in PERFORMANCE_AUDIT.md.
 *
 * The worst offenders were fetchAdZones / fetchAdFrequency /
 * fetchAdZonesEnabled, which run once per <AdZone> instance — and the feed
 * renders several — so three requests multiplied by every ad slot on screen.
 *
 * This module caches each key by ITSELF and coalesces every key requested
 * within one ~10 ms window into a single .in("key", […]) query. 23 requests
 * become 1.
 *
 * Deliberately mirrors the design of profileMapCache.ts so the codebase has
 * ONE batching pattern rather than two subtly different ones.
 *
 * NOTE ON WRITES: this is a read cache. Anything that writes a setting must
 * call invalidateSiteSetting(key) or the admin will save a value and keep
 * seeing the old one for the full TTL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * P4 (2026-10-04): THE EDGE COMES FIRST, POSTGREST IS THE FALLBACK
 *
 * Batching fixed the multiplier but not the shape: this was still one PostgREST
 * round trip per tab per ten minutes, for ~35 rows that are identical for every
 * member. `/config/site-settings` is a Pages Function that reads them once at
 * the edge and returns them with a content-addressed ETag, so the CDN answers
 * almost everyone and a client that already has them gets a 304 with no body.
 *
 * The database path below is NOT removed. It is what runs when the edge route
 * is missing (the native app has no such origin), returns a non-200, or hands
 * back something the wrong shape. Degraded, never wrong — and because the edge
 * returns 503 rather than an empty object on any upstream failure, "the edge
 * had nothing" and "there are no settings" can never be confused.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { supabase } from "@/integrations/supabase/client";

import { logger } from "@/lib/logger";

const FILE = "src/lib/siteSettingsCache.ts";

/** Settings change rarely and are read constantly. */
const TTL_MS = 10 * 60_000;
/** A key with no row is cached briefly — long enough to stop a render loop
 *  hammering it, short enough that creating the row shows up quickly. */
const MISSING_TTL_MS = 60_000;
/** One frame. See profileMapCache for why this is not 0. */
const BATCH_WINDOW_MS = 10;

interface Cached { value: unknown; at: number; missing: boolean }

const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<void>>();

let pendingKeys = new Set<string>();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolve: (() => void) | null = null;
let pendingPromise: Promise<void> | null = null;

function isFresh(c: Cached | undefined, now: number, maxAgeMs?: number): c is Cached {
  if (!c) return false;
  const ttl = c.missing ? MISSING_TTL_MS : TTL_MS;
  return now - c.at < Math.min(ttl, maxAgeMs ?? ttl);
}

function enqueue(keys: string[]): Promise<void> {
  for (const k of keys) pendingKeys.add(k);
  if (!pendingPromise) {
    pendingPromise = new Promise<void>((resolve) => { pendingResolve = resolve; });
  }
  const promise = pendingPromise;
  if (pendingTimer === null) {
    pendingTimer = setTimeout(() => { void flush(); }, BATCH_WINDOW_MS);
  }
  for (const k of keys) inFlight.set(k, promise);
  return promise;
}

/* ── The edge read ────────────────────────────────────────────────────────── */

/** Where the Pages Function lives. Same origin: no CORS, no key in the client. */
const EDGE_PATH = "/config/site-settings";

/** The content-addressed version the edge last gave us, for diagnostics and so
 *  a caller can tell "unchanged" from "never loaded". */
let edgeVersion: string | null = null;

/**
 * Set once the edge has answered with something unusable — a 404 because the
 * route is not deployed on this lane, or because there is no such origin at all
 * inside the native app. Without this, every batch would pay for the same
 * failed request again. It is deliberately NOT set on a 5xx: that is an outage,
 * and an outage ends.
 */
let edgeUnavailable = false;

/** The version string of the last successful edge read, or null. */
export function siteSettingsVersion(): string | null {
  return edgeVersion;
}

/**
 * Fill the cache from the edge. Returns true only when every key is now known.
 *
 * The edge returns the WHOLE configuration, so a key absent from its payload is
 * genuinely unset — which makes `missing` accurate here in a way the keyed
 * query below cannot be.
 */
async function loadFromEdge(): Promise<boolean> {
  // The Vite dev server (and the UI-gate harness that runs on it) does not run
  // Pages Functions, so `/config/site-settings` cannot exist there. Asking
  // anyway costs a guaranteed 404 on every page, and the UI gate correctly
  // reports every 404 as a fault — that is what turned #328's gate red
  // (2026-10-04). The cause is "no edge in dev", so dev skips the edge and
  // goes straight to the keyed database read, which is the same path a lane
  // without the route takes. Production and preview builds are unaffected.
  if (import.meta.env.DEV) return false;
  if (edgeUnavailable || typeof fetch !== "function") return false;
  try {
    const r = await fetch(EDGE_PATH, { headers: { accept: "application/json" } });
    if (r.status === 404 || r.status === 405) {
      edgeUnavailable = true;
      return false;
    }
    if (!r.ok) return false;

    const body = (await r.json()) as { version?: unknown; settings?: unknown };
    const settings = body?.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;

    const entries = Object.entries(settings as Record<string, unknown>);
    // An empty object cannot be the configuration; the edge answers 503 rather
    // than serve one, so seeing it here means something rewrote the response.
    if (entries.length === 0) return false;

    const now = Date.now();
    cache.clear();
    for (const [k, v] of entries) cache.set(k, { value: v ?? null, at: now, missing: false });
    edgeVersion = typeof body.version === "string" ? body.version : null;
    return true;
  } catch {
    // Offline, blocked, or no such origin. The database path handles it.
    return false;
  }
}

async function flush(): Promise<void> {
  const keys = [...pendingKeys].sort();
  const resolve = pendingResolve;
  // Reset before awaiting so keys arriving mid-request start a fresh batch.
  pendingKeys = new Set();
  pendingTimer = null;
  pendingResolve = null;
  pendingPromise = null;

  try {
    if (keys.length > 0) {
      // P4: one CDN-cached read for the whole configuration. When it works,
      // every requested key is already in the cache and the database is not
      // touched at all.
      if (await loadFromEdge()) {
        const now = Date.now();
        for (const k of keys) {
          if (!cache.has(k)) cache.set(k, { value: null, at: now, missing: true });
        }
        return;
      }

      const res: any = await supabase.from("site_settings").select("key, value").in("key", keys);
      // A query error is NOT "these keys are unset" — caching it would blank
      // real settings for the whole TTL. Leave them uncached so we retry.
      if (!res?.error) {
        const now = Date.now();
        const got = new Map<string, unknown>();
        for (const row of (res?.data as any[]) || []) got.set(row.key, row.value);
        for (const k of keys) {
          cache.set(k, { value: got.has(k) ? got.get(k) : null, at: now, missing: !got.has(k) });
        }
      }
    }
  } catch (err) {
    logger.warn({
      code: "SYS-9011",
      event: "SITE_SETTINGS_LOAD_FAILED",
      fn: "loadSiteSettings",
      file: FILE,
      message: "Site settings could not be loaded; built-in defaults are in use.",
      reason: err instanceof Error ? err.message : String(err),
      expected: "The stored site settings",
      actual: "Defaults",
      nextStep:
        "THIS CHANGES WHAT MEMBERS SEE with nothing on screen saying so — a setting an admin turned off may be back on. Check this before investigating any 'my setting did not save' report.",
    });
  } finally {
    for (const k of keys) inFlight.delete(k);
    resolve?.();
  }
}

async function load(keys: string[], maxAgeMs?: number): Promise<void> {
  const now = Date.now();
  const missing: string[] = [];
  const waits: Promise<void>[] = [];
  for (const k of keys) {
    if (isFresh(cache.get(k), now, maxAgeMs)) continue;
    const pending = inFlight.get(k);
    if (pending) { waits.push(pending); continue; }
    missing.push(k);
  }
  if (missing.length > 0) waits.push(enqueue(missing));
  if (waits.length > 0) await Promise.all(waits);
}

interface ReadOpts {
  /**
   * Treat a cached value older than this as stale, even inside the normal
   * 10-minute TTL. For settings an admin edits live and expects members to
   * see quickly (the ad zones — owner report 2026-08-04: "ad changed from
   * Admin panel but not updated on the App"). The batching still applies;
   * this only shortens how long a value may be served from memory.
   */
  maxAgeMs?: number;
}

/** Read one setting. Returns null when unset or unreadable — never throws. */
export async function getSiteSetting<T = unknown>(key: string, opts?: ReadOpts): Promise<T | null> {
  const [v] = await getSiteSettings<T>([key], opts);
  return v ?? null;
}

/** Read several settings in ONE round trip. Order matches the input. */
export async function getSiteSettings<T = unknown>(keys: string[], opts?: ReadOpts): Promise<(T | null)[]> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  await load(unique, opts?.maxAgeMs);
  return keys.map((k) => (cache.get(k)?.value as T) ?? null);
}

/** Drop a cached setting after a write. No argument = drop everything. */
export function invalidateSiteSetting(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
  // The version describes the whole payload, so it stops being true the moment
  // any key is dropped. Leaving it set would report a configuration the cache
  // no longer holds.
  edgeVersion = null;
}

/** Test seam: forget that the edge was unavailable. Not used by the app. */
export function resetSiteSettingsEdgeState() {
  edgeUnavailable = false;
  edgeVersion = null;
}
