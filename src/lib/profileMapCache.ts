/**
 * Global profile + badge + role fetcher, cached PER USER ID.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS KEYED BY ID AND NOT BY ID-SET (rewritten 2026-08-01)
 *
 * This module used to cache through React Query keyed on the sorted ID array:
 *
 *     queryKeys.profileMap([a, b, c])   // one cache entry
 *     queryKeys.profileMap([a])         // a DIFFERENT entry -> refetches `a`
 *     queryKeys.profileMap([b, c])      // a THIRD entry -> refetches b and c
 *
 * Every caller asks for its own slice of IDs, so almost no two keys matched and
 * the cache almost never hit. It batched perfectly WITHIN a call and never
 * ACROSS calls.
 *
 * Measured on the production feed before this change: **13 calls to
 * rawFetchProfileMap, each issuing 4 queries = 52 requests**, for a feed of
 * ~10 posts by ~8 distinct authors. Those 52 are most of the 106 Supabase
 * requests a single feed load was making. Full numbers in
 * PERFORMANCE_AUDIT.md.
 *
 * NOW: every profile is cached under its own id, and a request fetches only the
 * ids it does not already have. Requests raised within the same ~10 ms window
 * are coalesced into ONE round trip (the DataLoader pattern), and an id already
 * in flight is awaited rather than re-fetched. 52 requests become 4.
 *
 * The React Query layer in useProfileMap() is left in place on purpose — it now
 * caches the ASSEMBLED map per component, and its queryFn is nearly free
 * because it reads this entity cache instead of the network.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { supabase } from "@/integrations/supabase/client";
import { QueryClient } from "@tanstack/react-query";
import { profilesPublic } from "@/lib/profilesPublic";

import { logger } from "@/lib/logger";

const FILE = "src/lib/profileMapCache.ts";

export interface ProfileMapEntry {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  badges: string[];
  roles: string[];
  /** Presence heartbeat (5-min). Null for anon viewers or users who hide status. */
  last_active_at: string | null;
}

export type ProfileMap = Map<string, ProfileMapEntry>;

let _qc: QueryClient | null = null;
let _realtimeSubscribed = false;

export function setProfileMapQueryClient(qc: QueryClient) {
  _qc = qc;

  // Subscribe to realtime changes on user_badges to auto-invalidate cache
  if (!_realtimeSubscribed) {
    _realtimeSubscribed = true;
    supabase
      .channel("profile-map-badges")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_badges" },
        (payload: any) => {
          const changedUserId = payload?.new?.user_id ?? payload?.old?.user_id;
          // Was `invalidateQueries({ queryKey: queryKeys.profileMap([id]) })`,
          // which matched an ID-SET key of exactly one user — a key almost
          // nothing in the app ever uses, so badge/role changes silently never
          // invalidated anything. Go through invalidateProfileMap, which evicts
          // the entity and busts the whole ["profile-map"] prefix.
          if (changedUserId) invalidateProfileMap(changedUserId);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles" },
        (payload: any) => {
          const changedUserId = payload?.new?.user_id ?? payload?.old?.user_id;
          // Was `invalidateQueries({ queryKey: queryKeys.profileMap([id]) })`,
          // which matched an ID-SET key of exactly one user — a key almost
          // nothing in the app ever uses, so badge/role changes silently never
          // invalidated anything. Go through invalidateProfileMap, which evicts
          // the entity and busts the whole ["profile-map"] prefix.
          if (changedUserId) invalidateProfileMap(changedUserId);
        },
      )
      .subscribe();
  }
}

/**
 * Invalidate profile-map cache entries. Pass a userId to invalidate all
 * profile-map queries (any key starting with ["profile-map"] — single-user
 * keyed entries cannot be cherry-picked because most queries are keyed by
 * sorted multi-ID arrays). Pass nothing for a full bust.
 */
export function invalidateProfileMap(_userId?: string) {
  // Evict the entity cache too, or the React Query refetch would just re-read
  // the stale entity and nothing would actually change.
  clearProfileEntityCache(_userId);
  if (!_qc) return;
  void _qc.invalidateQueries({ queryKey: ["profile-map"] });
}

function dedupeAndSort(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

/* ── Entity cache + micro-batcher ─────────────────────────────────────────── */

/** How long a cached profile is considered fresh. Matches useProfileMap's staleTime. */
const ENTITY_TTL_MS = 5 * 60_000;

/**
 * How long to hold new ids before firing. One frame. Long enough for every
 * component in a single React commit to land in the same batch, short enough
 * that nobody perceives it. Set to 0 and each effect pass fires its own query
 * again — which is the bug this module exists to prevent.
 */
const BATCH_WINDOW_MS = 10;

/**
 * A profile the database did not return is cached only briefly. Caching a
 * "not found" for the full 5 minutes means one transient failure leaves a blank
 * name and avatar on screen for five minutes with no retry — found while
 * writing the failure test for this file. 30 s still stops a genuinely deleted
 * user being re-queried on every render.
 */
const NEGATIVE_TTL_MS = 30_000;

interface CachedEntity { entry: ProfileMapEntry; at: number; negative: boolean }

const entityCache = new Map<string, CachedEntity>();
/** ids currently being fetched -> the batch promise that will fill them. */
const inFlight = new Map<string, Promise<void>>();

let pendingIds = new Set<string>();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolve: (() => void) | null = null;
let pendingPromise: Promise<void> | null = null;

function isFresh(c: CachedEntity | undefined, now: number): c is CachedEntity {
  if (!c) return false;
  return now - c.at < (c.negative ? NEGATIVE_TTL_MS : ENTITY_TTL_MS);
}

function placeholder(id: string): ProfileMapEntry {
  return { id, full_name: null, avatar_url: null, badges: [], roles: [], last_active_at: null };
}

/** Queue ids for the next batch and return a promise that settles when it lands. */
function enqueue(ids: string[]): Promise<void> {
  for (const id of ids) pendingIds.add(id);

  if (!pendingPromise) {
    pendingPromise = new Promise<void>((resolve) => { pendingResolve = resolve; });
  }
  const promise = pendingPromise;

  if (pendingTimer === null) {
    pendingTimer = setTimeout(() => { void flush(); }, BATCH_WINDOW_MS);
  }
  for (const id of ids) inFlight.set(id, promise);
  return promise;
}

async function flush(): Promise<void> {
  const ids = [...pendingIds].sort();
  const resolve = pendingResolve;
  // Reset BEFORE awaiting, so ids arriving during the request start a new batch
  // instead of silently joining one that has already been sent.
  pendingIds = new Set();
  pendingTimer = null;
  pendingResolve = null;
  pendingPromise = null;

  try {
    if (ids.length > 0) {
      const { map, found, failed } = await rawFetchProfileMap(ids);
      if (!failed) {
        const now = Date.now();
        for (const id of ids) {
          entityCache.set(id, {
            entry: map.get(id) ?? placeholder(id),
            at: now,
            negative: !found.has(id),
          });
        }
      }
    }
  } catch (err) {
    // A failed batch must not poison the cache or hang its waiters. The ids stay
    // uncached, so the next request retries them.
    logger.warn({
      code: "DB-3005",
      event: "PROFILE_MAP_BATCH_FAILED",
      fn: "fetchProfileMap",
      file: FILE,
      message: "A batch lookup of member names and avatars failed.",
      reason: err instanceof Error ? err.message : String(err),
      expected: "A name, avatar and badges for each member id",
      actual: "An empty map; callers fall back to generic identities",
      nextStep:
        "READ THIS BEFORE CONCLUDING AN ACCOUNT WAS DELETED. When this fires, posts and comments render the generic name 'Photographer' with a letter-placeholder avatar — which is EXACTLY what a deleted account looks like (Bug 1 screenshots, 2026-08-06). One is a lookup that failed; the other is a profile that is gone.",
    });
  } finally {
    for (const id of ids) inFlight.delete(id);
    resolve?.();
  }
}

/**
 * Resolve these ids from the entity cache, fetching only what is missing.
 * Concurrent callers within BATCH_WINDOW_MS share one round trip.
 */
async function loadIntoCache(sortedIds: string[]): Promise<void> {
  const now = Date.now();
  const missing: string[] = [];
  const waits: Promise<void>[] = [];

  for (const id of sortedIds) {
    if (isFresh(entityCache.get(id), now)) continue;
    const pending = inFlight.get(id);
    if (pending) { waits.push(pending); continue; }
    missing.push(id);
  }

  if (missing.length > 0) waits.push(enqueue(missing));
  if (waits.length > 0) await Promise.all(waits);
}

function assemble(sortedIds: string[]): ProfileMap {
  const out: ProfileMap = new Map();
  for (const id of sortedIds) out.set(id, entityCache.get(id)?.entry ?? placeholder(id));
  return out;
}

/** Drop cached entities. No argument = drop everything. Exported for tests. */
export function clearProfileEntityCache(userId?: string) {
  if (userId) entityCache.delete(userId);
  else entityCache.clear();
}

/**
 * Run a Supabase query up to `attempts` times, backing off, until it comes back
 * without an error.
 *
 * Takes a FACTORY, not a promise: a supabase-js query builder is a one-shot
 * thenable, so re-awaiting the same object replays the settled result instead
 * of issuing a second request. Calling this with `withRetry(builder)` rather
 * than `withRetry(() => builder)` would silently do nothing at all, which is
 * the failure mode this comment exists to prevent.
 *
 * A rejected promise is caught and reshaped into the `{ data, error }` result
 * supabase-js would have returned, so callers keep one shape to handle. The
 * last attempt's failure is the one returned — this never throws.
 */
/**
 * The constraint carries `data` as well as `error` because the catch branch
 * below synthesises `{ data: null, error }`. Without it the inferred `T` narrows
 * to `{ error: unknown }`, `.data` disappears from the result, and every caller
 * has to cast — which is what the two-year-old `as any` at the call sites was
 * papering over. `npx tsc -b` reported this as TS2339; it had never been caught
 * because CI's typecheck ran `-p tsconfig.json`, which compiles zero files.
 */
async function withRetry<T extends { data: unknown; error: unknown }>(
  run: () => PromiseLike<T>,
  attempts = 3,
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await run();
      if (!last?.error) return last;
    } catch (err) {
      last = { data: null, error: err } as unknown as T;
    }
    // 250ms, 500ms. Short on purpose: a member is looking at a "P" circle while
    // this runs, so the recovery has to feel like a late paint, not a reload.
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  return last as T;
}

/**
 * Returns the assembled map AND the set of ids the profiles query actually
 * returned a row for. The caller needs the difference to know which entries are
 * real and which are placeholders — see NEGATIVE_TTL_MS.
 */
async function rawFetchProfileMap(
  sortedIds: string[],
): Promise<{ map: ProfileMap; found: Set<string>; failed: boolean }> {
  if (sortedIds.length === 0) return { map: new Map(), found: new Set(), failed: false };

  const [profilesRes, badgesRes, rolesRes, presenceRes] = await Promise.all([
    /**
     * ⚠ THIS ONE RETRIES. THE OTHER THREE DO NOT, AND THAT ASYMMETRY IS THE FIX.
     *
     * Owner, 2026-08-12: *"Very often every names are showing as ? then coming
     * to names automatically."*
     *
     * This is the query that supplies the NAME. When it dropped on a weak
     * signal the whole batch returned placeholders, every author on screen
     * became "Photographer" with a "?" circle, and it stayed that way until the
     * 30-second negative TTL expired and something happened to ask again —
     * which is exactly the "then coming to names automatically" half of his
     * sentence. One dropped request, thirty seconds of a feed full of question
     * marks.
     *
     * Badges, roles and presence are decorations: if one of them blips the
     * member sees a missing tick or a missing green dot for a moment, and
     * retrying all four would triple the traffic of the app's single busiest
     * lookup to protect things nobody notices. The name is not a decoration.
     * It gets three attempts; the rest get one.
     */
    withRetry(() => profilesPublic().select("id, full_name, avatar_url").in("id", sortedIds)),
    supabase.from("user_badges").select("user_id, badge_type").in("user_id", sortedIds),
    // F2: anon-safe RPC; returns only registered_photographer/student/content_editor
    supabase.rpc("get_public_roles_for_users", { _user_ids: sortedIds } as any),
    // Presence (online dot). last_active_at is readable ONLY by authenticated users
    // (and null for users who hid their active status), so for anon this query
    // returns an error we ignore -> no dots for logged-out visitors, by design.
    profilesPublic().select("id, last_active_at").in("id", sortedIds),
  ]);

  const presenceMap = new Map<string, string | null>();
  ((presenceRes.data as any[]) || []).forEach((p: any) => {
    presenceMap.set(p.id, p.last_active_at ?? null);
  });

  const badgeMap = new Map<string, string[]>();
  ((badgesRes.data as any[]) || []).forEach((b: any) => {
    const arr = badgeMap.get(b.user_id) || [];
    arr.push(b.badge_type);
    badgeMap.set(b.user_id, arr);
  });

  const roleMap = new Map<string, string[]>();
  ((rolesRes.data as any[]) || []).forEach((r: any) => {
    const arr = roleMap.get(r.user_id) || [];
    arr.push(r.role);
    roleMap.set(r.user_id, arr);
  });

  const result: ProfileMap = new Map();
  const found = new Set<string>();
  ((profilesRes.data as any[]) || []).forEach((p: any) => {
    found.add(p.id);
    result.set(p.id, {
      id: p.id,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      badges: badgeMap.get(p.id) || [],
      roles: roleMap.get(p.id) || [],
      last_active_at: presenceMap.get(p.id) ?? null,
    });
  });

  // Ensure every requested ID exists in the map (even if not found in DB).
  // These are placeholders, NOT data — `found` is what tells the caller apart.
  for (const id of sortedIds) {
    if (!result.has(id)) result.set(id, placeholder(id));
  }

  // A query ERROR is not the same as "this user has no row". The first must not
  // be cached at all or a transient blip blanks a name for the whole TTL; the
  // second is a real answer and is cached (briefly — see NEGATIVE_TTL_MS).
  return { map: result, found, failed: !!(profilesRes as any)?.error };
}

/**
 * Direct fetch (no QueryClient indirection). Safe to use inside useQuery queryFn.
 */
export async function fetchProfileMapDirect(ids: string[]): Promise<ProfileMap> {
  const sorted = dedupeAndSort(ids);
  if (sorted.length === 0) return new Map();
  await loadIntoCache(sorted);
  return assemble(sorted);
}

/**
 * Fetch profiles + badges + roles for a set of user IDs.
 * Uses QueryClient cache when available for imperative callers.
 */
export async function fetchProfileMap(ids: string[]): Promise<ProfileMap> {
  // Goes straight through the entity cache. The old QueryClient.fetchQuery
  // indirection keyed by ID-SET is exactly what made this slow — see the header.
  return fetchProfileMapDirect(ids);
}
