/**
 * VID-1 · the real JobDeps: Supabase (as the member), the Pages Functions, and
 * the PUT to R2. Kept apart from uploadJobs.ts so the job logic is tested with
 * fakes and this file stays a thin, readable adapter.
 */
import { onlineManager } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getNetState } from "@/lib/offline/networkQuality";
import { siteFetch } from "@/lib/net/siteApi";
import type { JobDeps } from "./uploadJobs";

type Err = { message: string; code?: string } | null;
// The video tables are new (D1 #378–#380); the generated types catch up when
// D1 regenerates them. Until then they are addressed through this narrow,
// honest shape — only the calls this file makes — rather than `any`.
type Res = { data: Record<string, unknown> | null; error: Err };
interface Chain extends PromiseLike<Res> {
  select(columns: string): Chain;
  eq(column: string, value: unknown): Chain;
  maybeSingle(): PromiseLike<Res>;
  upsert(row: unknown, opts: { onConflict: string }): PromiseLike<Res>;
}
interface LooseDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
  from(table: string): Chain;
}
const db = supabase as unknown as LooseDb;

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

async function bearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export const realJobDeps: JobDeps = {
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    return { data, error: error as Err };
  },
  linkAdVideo: async (creativeId, videoId, categories) => {
    const prev = await db.from("ad_videos").select("video_id").eq("ad_creative_id", creativeId).maybeSingle();
    const { error } = await db.from("ad_videos").upsert(
      { ad_creative_id: creativeId, video_id: videoId, categories }, { onConflict: "ad_creative_id" },
    );
    if (error) return { error: error as Err };
    // The video this one REPLACED is no longer on any ad: mark it deleted so
    // video_housekeeping purges it (review #412 — it was left ready for ever).
    // Best effort: a failure here leaves an unlinked video nobody can play.
    const old = prev.data?.video_id;
    if (typeof old === "string" && old !== videoId) await db.rpc("video_delete", { _video_id: old });
    return { error: null };
  },
  videoState: async (videoId) => {
    const { data, error } = await db.from("videos").select("state").eq("id", videoId).maybeSingle();
    if (error) throw error;
    return (data?.state as string | undefined) ?? null;
  },
  api: async (path, body) => {
    const token = await bearer();
    const res = await siteFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    let parsed: Record<string, unknown> = {};
    try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* a non-JSON error page */ }
    return { status: res.status, body: parsed };
  },
  put: async (url, headers, data) => {
    const res = await fetch(url, { method: "PUT", headers, body: data });
    return res.status;
  },
  upload: (url, headers, data, onProgress, signal) => xhrPut(url, headers, data, onProgress, signal),
  sourceRow: async (sourceId) => {
    // The owner's own row through RLS (video_sources_owner_read); only the columns granted to them.
    const { data, error } = await db.from("video_sources").select("status, video_id, error").eq("id", sourceId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      status: String(data.status ?? ""),
      video_id: typeof data.video_id === "string" ? data.video_id : null,
      error: typeof data.error === "string" ? data.error : null,
    };
  },
  online: () => onlineManager.isOnline() && getNetState().online,
  now: () => Date.now(),
};
