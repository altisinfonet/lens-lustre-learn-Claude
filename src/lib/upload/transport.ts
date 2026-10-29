/**
 * S5 · THE ONE UPLOAD TRANSPORT (photo and video).
 *
 * Every presigned PUT on the platform goes through this file:
 *   - `xhrPut`        one PUT: real byte progress (XMLHttpRequest — fetch has
 *                     none), an AbortController to stop it, and a stall
 *                     watchdog so a silently dead mobile link fails instead
 *                     of hanging (moved here from video/jobDeps.ts, VID-1);
 *   - `putWithRetry`  the retry policy around it: network drops, 5xx, 408 and
 *                     429 back off exponentially with ±20 % jitter (the
 *                     outbox's `backoffMs`, the only copy); 403 (the 300 s
 *                     presign outlived by a slow link) asks the caller for a
 *                     fresh URL for the SAME key; any other 4xx is a wrong
 *                     request and is not repeated.
 * Retrying a PUT to the same key with the same bytes is exactly idempotent:
 * success after a retry is indistinguishable from success the first time.
 */
import { backoffMs } from "@/lib/offline/outbox";

/**
 * Server conversion: the ORIGINAL's PUT. XMLHttpRequest, not fetch — fetch
 * reports no upload progress, and a 500 MB original on a phone takes minutes.
 * Exactly the signed headers are sent (content-type application/octet-stream,
 * whatever the file is); the browser sets content-length from the file, which
 * is the size the URL was signed for. A network failure rejects as "Failed to
 * fetch" so the job's retry rules treat it like any other dropped link.
 *
 * THE STALL WATCHDOG (review #423): a mobile link can die without a word — no
 * error, no close — and the card would say "Uploading… 42%" until the phone's
 * own socket timeout, minutes later. So: no progress and no answer for
 * `stallMs` = the link is dropped; the request is stopped and rejected as
 * "Failed to fetch", and the job backs off and tries again by its own rules.
 * One timeout, re-armed by each progress event — not a repeating timer. Time
 * the app spent hidden is not counted (a suspended page gets no events, and
 * its timers fire the instant it returns): the window starts again on return.
 */
export const UPLOAD_STALL_MS = 60_000;

export function xhrPut(
  url: string, headers: Record<string, string>, data: Blob,
  onProgress: (sent: number, total: number) => void, signal: AbortSignal,
  stallMs: number = UPLOAD_STALL_MS,
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("The upload was cancelled", "AbortError")); return; }
    const x = new XMLHttpRequest();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let movedAt = Date.now();
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const done = () => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = undefined;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
    const check = () => {
      const quiet = Date.now() - movedAt;
      if (hidden() || quiet < stallMs) { watchdog = setTimeout(check, hidden() ? stallMs : stallMs - quiet); return; }
      done();
      reject(new TypeError("Failed to fetch")); // settled first: the abort below must not read as a Cancel
      x.abort();
    };
    const moved = () => {
      movedAt = Date.now();
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = setTimeout(check, stallMs);
    };
    function onVisible() { if (!hidden()) moved(); }
    x.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { moved(); onProgress(e.loaded, e.lengthComputable ? e.total : data.size); };
    x.onload = () => { done(); resolve(x.status); };
    x.onerror = () => { done(); reject(new TypeError("Failed to fetch")); };
    x.ontimeout = () => { done(); reject(new TypeError("Failed to fetch")); };
    x.onabort = () => { done(); reject(new DOMException("The upload was cancelled", "AbortError")); };
    signal.addEventListener("abort", () => x.abort(), { once: true });
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    moved();
    x.send(data);
  });
}

export type PutSend = (
  url: string, headers: Record<string, string>, data: Blob,
  onProgress: (sent: number, total: number) => void, signal: AbortSignal,
) => Promise<number>;

let send: PutSend = (url, headers, data, onProgress, signal) => xhrPut(url, headers, data, onProgress, signal);
/** Test seam: replace the single PUT (a unit test has no network). */
export function __setPutSend(s: PutSend | null): void {
  send = s ?? ((url, headers, data, onProgress, signal) => xhrPut(url, headers, data, onProgress, signal));
}

export const PUT_MAX_ATTEMPTS = 5;
/** Fresh URLs one PUT may ask for (403) before it gives up: the key never changes. */
export const PUT_MAX_REPRESIGNS = 2;

export interface PutOptions {
  /** Says which file failed, in the error text. */
  label: string;
  /** Exactly the headers the URL was signed with. */
  headers: Record<string, string>;
  /** A fresh URL for the SAME key (the presign outlived its 300 s). */
  represign?: () => Promise<string>;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  rnd?: () => number;
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";

export async function putWithRetry(uploadUrl: string, data: Blob, o: PutOptions): Promise<void> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = o.maxAttempts ?? PUT_MAX_ATTEMPTS;
  const signal = o.signal ?? new AbortController().signal;
  let url = uploadUrl;
  let represigns = 0;
  let wait = false;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < max; attempt++) {
    if (signal.aborted) throw new DOMException("The upload was cancelled", "AbortError");
    if (wait) await sleep(backoffMs(attempt, o.rnd));
    wait = true;
    let status: number;
    try {
      status = await send(url, o.headers, data, o.onProgress ?? (() => {}), signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      if (e instanceof TypeError) { lastErr = e; continue; } // dropped link or stalled: back off, same URL
      throw e;
    }
    if (status >= 200 && status < 300) return;
    if (status === 403 && o.represign && represigns < PUT_MAX_REPRESIGNS) {
      represigns++;
      url = await o.represign();
      lastErr = new Error(`${o.label} upload got 403; re-presigned and retrying`);
      wait = false; // a fresh URL is not a busy server: no back-off
      continue;
    }
    if (status >= 500 || status === 429 || status === 408) {
      lastErr = new Error(`${o.label} upload failed (${status}); retrying`);
      continue;
    }
    throw new Error(`${o.label} upload failed (${status})`);
  }
  throw lastErr ?? new Error(`${o.label} upload failed after retries`);
}
