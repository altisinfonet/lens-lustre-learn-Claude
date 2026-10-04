/**
 * OFF-1 · THE DEVICE STORE. What the app shows when the network is slow or gone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, R-90 (2026-10-04): "the app must work on poor network and with no
 * network, like FB/Insta." OFF-1 is the first leg: the feed, profiles, the
 * member's own posts and notifications are kept ON THE DEVICE, so the app opens
 * from them instantly and then refreshes (cache first).
 *
 * STORAGE. IndexedDB (database `retina-offline`, object store `kv`): it holds
 * megabytes where localStorage holds ~5 MB shared with everything else, it is
 * asynchronous so a large read never blocks a frame, and it exists in every
 * browser and both Capacitor WebViews this app ships to. No dependency is
 * added (the dependency window is closed); the IndexedDB calls are wrapped
 * here, once, in a few lines.
 *
 * WHAT A RECORD IS. `{ id, userId, key, data, updatedAt, bytes }` where `id` is
 * `${userId}::${JSON.stringify(key)}`. Every read is filtered by userId, so one
 * member can never be shown another member's data on a shared device — and
 * sign-out deletes everything anyway (OFF-4 / F-D3-6).
 *
 * BOUNDS, so the store cannot grow without limit:
 *   • one record larger than MAX_RECORD_BYTES is not stored (and says so);
 *   • at most MAX_RECORDS_PER_USER records; the oldest `updatedAt` go first;
 *   • a record older than MAX_AGE_MS is ignored on read and deleted.
 *
 * FAILURE IS ALWAYS "NO CACHE", NEVER AN ERROR. Private mode, a full disk, a
 * WebView without IndexedDB, a corrupt database: every call resolves, the app
 * simply behaves as it did before OFF-1. `backend()` is swappable so tests can
 * drive the logic without a browser; the real-browser proof is in the evidence.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DB_NAME = "retina-offline";
export const STORE = "kv";
export const MAX_RECORD_BYTES = 512 * 1024;
export const MAX_RECORDS_PER_USER = 200;
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredRecord {
  id: string;
  userId: string;
  key: unknown[];
  data: unknown;
  updatedAt: number;
  bytes: number;
}

/** The minimal storage surface; IndexedDB in browsers, a Map in tests. */
export interface Backend {
  getAll(): Promise<StoredRecord[]>;
  put(rec: StoredRecord): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryBackend(): Backend & { map: Map<string, StoredRecord> } {
  const map = new Map<string, StoredRecord>();
  return {
    map,
    getAll: async () => [...map.values()].map((r) => structuredCloneSafe(r)),
    put: async (r) => { map.set(r.id, structuredCloneSafe(r)); },
    delete: async (id) => { map.delete(id); },
    clear: async () => { map.clear(); },
  };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function idbBackend(): Backend | null {
  if (typeof indexedDB === "undefined" || !indexedDB) return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("indexedDB open blocked"));
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  };
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    getAll: () => tx<StoredRecord[]>("readonly", (s) => s.getAll() as IDBRequest<StoredRecord[]>),
    put: async (r) => { await tx("readwrite", (s) => s.put(r)); },
    delete: async (id) => { await tx("readwrite", (s) => s.delete(id)); },
    clear: async () => { await tx("readwrite", (s) => s.clear()); },
  };
}

let current: Backend | null | undefined;
/** The active backend (IndexedDB unless a test set one). null = no storage on this device. */
export function backend(): Backend | null {
  if (current === undefined) current = idbBackend();
  return current;
}
/** Test seam. Pass undefined to go back to IndexedDB detection. */
export function setBackend(b: Backend | null | undefined) {
  current = b;
}

export const recordId = (userId: string, key: readonly unknown[]) => `${userId}::${JSON.stringify(key)}`;

/** Store one value for one member. Resolves to false when it was not stored (too big, no storage, failure). */
export async function putRecord(userId: string, key: readonly unknown[], data: unknown, now = Date.now()): Promise<boolean> {
  const b = backend();
  if (!b || !userId) return false;
  try {
    const json = JSON.stringify(data);
    if (json === undefined) return false;
    const bytes = json.length * 2; // UTF-16 upper bound; good enough for a cap
    if (bytes > MAX_RECORD_BYTES) return false;
    await b.put({ id: recordId(userId, key), userId, key: [...key], data: JSON.parse(json), updatedAt: now, bytes });
    await enforceCap(b, userId);
    return true;
  } catch {
    return false;
  }
}

async function enforceCap(b: Backend, userId: string) {
  const mine = (await b.getAll()).filter((r) => r.userId === userId).sort((x, y) => y.updatedAt - x.updatedAt);
  for (const r of mine.slice(MAX_RECORDS_PER_USER)) await b.delete(r.id);
}

/** Every fresh record for this member, newest first. Expired records are deleted on the way. */
export async function readAll(userId: string, now = Date.now()): Promise<StoredRecord[]> {
  const b = backend();
  if (!b || !userId) return [];
  try {
    const all = await b.getAll();
    const out: StoredRecord[] = [];
    for (const r of all) {
      if (r.userId !== userId) continue;
      if (now - r.updatedAt > MAX_AGE_MS) { await b.delete(r.id).catch(() => {}); continue; }
      out.push(r);
    }
    return out.sort((x, y) => y.updatedAt - x.updatedAt);
  } catch {
    return [];
  }
}

/** Delete everything for everyone on this device (sign-out). Never throws. */
export async function clearDeviceStore(): Promise<boolean> {
  const b = backend();
  if (!b) return false;
  try { await b.clear(); return true; } catch { return false; }
}
