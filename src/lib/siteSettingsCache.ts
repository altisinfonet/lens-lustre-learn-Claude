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
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { supabase } from "@/integrations/supabase/client";

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

function isFresh(c: Cached | undefined, now: number): c is Cached {
  if (!c) return false;
  return now - c.at < (c.missing ? MISSING_TTL_MS : TTL_MS);
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
    console.warn("site_settings batch failed:", err);
  } finally {
    for (const k of keys) inFlight.delete(k);
    resolve?.();
  }
}

async function load(keys: string[]): Promise<void> {
  const now = Date.now();
  const missing: string[] = [];
  const waits: Promise<void>[] = [];
  for (const k of keys) {
    if (isFresh(cache.get(k), now)) continue;
    const pending = inFlight.get(k);
    if (pending) { waits.push(pending); continue; }
    missing.push(k);
  }
  if (missing.length > 0) waits.push(enqueue(missing));
  if (waits.length > 0) await Promise.all(waits);
}

/** Read one setting. Returns null when unset or unreadable — never throws. */
export async function getSiteSetting<T = unknown>(key: string): Promise<T | null> {
  const [v] = await getSiteSettings<T>([key]);
  return v ?? null;
}

/** Read several settings in ONE round trip. Order matches the input. */
export async function getSiteSettings<T = unknown>(keys: string[]): Promise<(T | null)[]> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  await load(unique);
  return keys.map((k) => (cache.get(k)?.value as T) ?? null);
}

/** Drop a cached setting after a write. No argument = drop everything. */
export function invalidateSiteSetting(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
