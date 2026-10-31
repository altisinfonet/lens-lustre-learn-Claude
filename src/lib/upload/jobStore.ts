/**
 * S5 · THE ONE ON-DEVICE STORE FOR UPLOAD JOBS (photo and video).
 *
 * A job (small JSON, keyed by its id = the idempotency key made once) and its
 * files (the exact bytes that go up, keyed `<jobId>/<name>`) live in one
 * IndexedDB database per media kind, so a dropped link, an offline hour or a
 * killed app costs nothing: the job resumes with the SAME keys and the SAME
 * bytes. Moved here from video/uploadJobs.ts (VID-1) so photos use the same
 * code, not a copy. Schema unchanged: stores "jobs" (keyPath id) and "files".
 */
export interface UploadJobStore<J extends { id: string }> {
  allJobs(): Promise<J[]>;
  putJob(j: J): Promise<void>;
  deleteJob(id: string): Promise<void>;
  putFile(jobId: string, name: string, data: Blob): Promise<void>;
  getFile(jobId: string, name: string): Promise<Blob | null>;
  deleteFiles(jobId: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryUploadStore<J extends { id: string }>(): UploadJobStore<J> & { jobs: Map<string, J>; files: Map<string, Blob> } {
  const jobs = new Map<string, J>();
  const files = new Map<string, Blob>();
  const clone = (j: J) => JSON.parse(JSON.stringify(j)) as J;
  return {
    jobs, files,
    allJobs: async () => [...jobs.values()].map(clone),
    putJob: async (j) => { jobs.set(j.id, clone(j)); },
    deleteJob: async (id) => { jobs.delete(id); },
    putFile: async (id, n, d) => { files.set(`${id}/${n}`, d); },
    getFile: async (id, n) => files.get(`${id}/${n}`) ?? null,
    deleteFiles: async (id) => { for (const k of [...files.keys()]) if (k.startsWith(`${id}/`)) files.delete(k); },
    clear: async () => { jobs.clear(); files.clear(); },
  };
}

/** null when this browser has no IndexedDB (the caller falls back to memory). */
export function idbUploadStore<J extends { id: string }>(dbName: string): UploadJobStore<J> | null {
  if (typeof indexedDB === "undefined" || !indexedDB) return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
          if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  };
  const run = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    allJobs: () => run<J[]>("jobs", "readonly", (s) => s.getAll() as IDBRequest<J[]>),
    putJob: async (j) => { await run("jobs", "readwrite", (s) => s.put(j)); },
    deleteJob: async (id) => { await run("jobs", "readwrite", (s) => s.delete(id)); },
    putFile: async (id, n, d) => { await run("files", "readwrite", (s) => s.put(d, `${id}/${n}`)); },
    getFile: async (id, n) => (await run<Blob | undefined>("files", "readonly", (s) => s.get(`${id}/${n}`) as IDBRequest<Blob | undefined>)) ?? null,
    deleteFiles: async (id) => { await run("files", "readwrite", (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`))); },
    clear: async () => { await run("jobs", "readwrite", (s) => s.clear()); await run("files", "readwrite", (s) => s.clear()); },
  };
}
