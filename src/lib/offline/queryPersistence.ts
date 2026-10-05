/**
 * OFF-1 · which React Query data is kept on the device, and how it comes back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WRITE. Every successful fetch of an allow-listed query is written to the
 * device store (deviceStore.ts), debounced per key so a burst of updates is one
 * write. Infinite queries (the feed, a wall) keep their FIRST page only: that is
 * what fills the first screen, and it bounds the size.
 *
 * READ. When a member is known (sign-in, or the app opening with a session),
 * `hydrateFromDevice` puts every stored record back into the query cache — but
 * only where the cache has nothing yet, and with the record's own `updatedAt`,
 * so React Query treats it as OLD data: the screen renders it at once and the
 * normal refetch replaces it when the network answers (cache first, then
 * refresh). Offline, React Query pauses the refetch and the stored data stays
 * on screen instead of a spinner or a blank page.
 *
 * THE ALLOW-LIST is deliberately short — the four things OFF-1 names:
 *   feed               ["feed", categories]
 *   profiles           ["profile-core", userId]
 *   the member's posts ["user-wall-posts", <own id only>]
 *   notifications      ["notifications", <own id only>]
 * Nothing else is persisted: admin data, search, drafts and anything not
 * named here stay in memory only.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { putRecord, readAll } from "./deviceStore";

export const WRITE_DEBOUNCE_MS = 800;

/** Is this query key kept on the device for this member? */
export function isPersisted(key: QueryKey, userId: string | null): boolean {
  if (!userId || !Array.isArray(key) || key.length === 0) return false;
  const [root, arg] = key as unknown[];
  switch (root) {
    case "feed": return key.length <= 2;
    case "profile-core": return typeof arg === "string" && arg.length > 0;
    case "user-wall-posts": return arg === userId;
    case "notifications": return arg === userId;
    default: return false;
  }
}

/** Infinite-query data keeps its first page only; anything else is stored as is. */
export function trimForStorage(data: unknown): unknown {
  if (data && typeof data === "object" && Array.isArray((data as { pages?: unknown }).pages)) {
    const d = data as { pages: unknown[]; pageParams?: unknown[] };
    return { pages: d.pages.slice(0, 1), pageParams: (d.pageParams ?? [0]).slice(0, 1) };
  }
  return data;
}

let currentUser: string | null = null;
/** The member whose data is being written. Set by the app when auth changes. */
export function setPersistenceUser(userId: string | null) {
  currentUser = userId;
}

/**
 * Start writing allow-listed queries to the device. Returns the unsubscribe.
 * `schedule` is injectable so tests do not wait on timers.
 */
export function startQueryPersistence(
  qc: QueryClient,
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): () => void {
  const pending = new Map<string, unknown>();
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const key = event.query.queryKey;
    const user = currentUser;
    if (!user || !isPersisted(key, user)) return;
    const id = JSON.stringify(key);
    if (pending.has(id)) return;
    pending.set(id, true);
    schedule(() => {
      pending.delete(id);
      const data = qc.getQueryData(key);
      if (data === undefined || currentUser !== user) return;
      void putRecord(user, key as unknown[], trimForStorage(data));
    }, WRITE_DEBOUNCE_MS);
  });
}

/** Put this member's stored data into the cache where the cache is empty. Resolves to the keys restored. */
export async function hydrateFromDevice(qc: QueryClient, userId: string): Promise<string[]> {
  const restored: string[] = [];
  for (const r of await readAll(userId)) {
    if (!isPersisted(r.key, userId)) continue;
    if (qc.getQueryData(r.key) !== undefined) continue;
    qc.setQueryData(r.key, r.data, { updatedAt: r.updatedAt });
    restored.push(JSON.stringify(r.key));
  }
  return restored;
}
