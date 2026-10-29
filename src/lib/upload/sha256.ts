/**
 * S5-b · sha256 in a Web Worker (a 2560px WebP is megabytes; hashing it on
 * the main thread stalls the composer on a phone). Falls back to the main
 * thread wherever a Worker cannot start (old WebView, tests): the answer is
 * the same bytes' digest either way, so the fallback is never a different
 * result, only a slower one.
 */
let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, { resolve: (h: string) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === "undefined") return (worker = null);
    worker = new Worker(new URL("./sha256.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; hex?: string; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.hex) w.resolve(e.data.hex); else w.reject(new Error(e.data.error ?? "sha256 worker failed"));
    };
    worker.onerror = () => {
      // A worker that cannot load: every caller falls back to the main thread.
      for (const w of waiting.values()) w.reject(new Error("sha256 worker failed"));
      waiting.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

async function onMainThread(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  let hex = "";
  for (const b of d) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Lowercase hex sha256 of `buf`. The buffer is copied to the worker, never transferred (the caller keeps it). */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const w = getWorker();
  if (!w) return onMainThread(buf);
  try {
    return await new Promise<string>((resolve, reject) => {
      const id = ++seq;
      // A worker that never answers must not hang the post: 15 s, then the main thread.
      const t = setTimeout(() => { waiting.delete(id); reject(new Error("sha256 worker timed out")); }, 15_000);
      waiting.set(id, { resolve: (h) => { clearTimeout(t); resolve(h); }, reject: (e) => { clearTimeout(t); reject(e); } });
      w.postMessage({ id, buf });
    });
  } catch {
    return onMainThread(buf);
  }
}
