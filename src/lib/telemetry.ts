import { supabase } from "@/integrations/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";
import { startVisibilityInterval } from "@/lib/timers/visibilityInterval";
import { reportNativeExits } from "@/lib/native/exitReasons";

/**
 * S2-A · CLIENT TELEMETRY. One way a device reports timings, uncaught errors,
 * realtime subscribe status and app starts.
 *
 * Gate: "Owner can read, without an editor: feed p95 yesterday, upload
 * failure %, crash rate per build, egress/1k views".
 *
 * Same shape as S12-F1 signals: events are queued in memory and sent in
 * batches every 15 s (and when the page is hidden) through ONE rate-limited
 * RPC, public.record_client_telemetry (20261028_0001). The server drops
 * anything that does not match its patterns and caps 50/call, 600/member/hour.
 *
 * Rules:
 *   1. NEVER throws, NEVER blocks the UI. Every path is wrapped; a failed send
 *      is dropped, not retried.
 *   2. NO PII. No member id is sent (the server knows the caller and stores
 *      none). Routes are reduced to a known first segment ("/post/:x").
 *      Errors are sent as their name and an 8-hex hash of the normalised
 *      message, never the text.
 *   3. Signed out → the queue is dropped (no anon writes).
 */

export type TelemetryKind = "timing" | "error" | "realtime" | "session";
type Platform = "web" | "android" | "ios";

interface TelemetryEvent {
  kind: TelemetryKind;
  metric: string;
  ok?: boolean;
  duration_ms?: number;
  platform: Platform;
  app_build: string;
  route?: string;
  error_name?: string;
  error_hash?: string;
}

export const FLUSH_MS = 15_000;
const BATCH = 50;
const MAX_QUEUE = 200;
const MAX_ERRORS_PER_LOAD = 30;
const MAX_SAME_ERROR = 3;
const MAX_DURATION_MS = 600_000;

/** Fraction of events kept per metric (default 1). Uploads, feed, errors and starts are never sampled. */
const SAMPLE: Record<string, number> = {
  "rpc.get_post_view_counts": 0.5,
  "rpc.get_public_roles_for_users": 0.5,
  "rpc.get_my_story_view_counts": 0.5,
};

/** Top-level routes we keep by name; anything else (e.g. a custom profile URL) becomes "/other". */
const KNOWN_ROUTES = new Set([
  "feed", "post", "profile", "admin", "competitions", "competition", "journal", "courses", "course",
  "friends", "notifications", "messages", "settings", "dashboard", "wallet", "judge", "judging",
  "stories", "story", "search", "login", "auth", "signup", "explore", "gallery", "discover",
  "photo-of-the-day", "certificates", "certificate", "about", "contact", "privacy", "terms", "help",
]);

const queue: TelemetryEvent[] = [];
const errorSeen = new Map<string, number>();
let errorCount = 0;
let installed = false;
let nativeBuild: string | null = null;

/* ── context ─────────────────────────────────────────────────────────────── */

export function telemetryPlatform(): Platform {
  try {
    const p = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
    return p === "android" || p === "ios" ? p : "web";
  } catch {
    return "web";
  }
}

function appBuild(): string {
  try {
    const raw = nativeBuild ?? (window as unknown as { __APP_BUILD?: string }).__APP_BUILD ?? "unknown";
    const clean = String(raw).replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 40);
    return clean || "unknown";
  } catch {
    return "unknown";
  }
}

/** "/post/abc-123?x" → "/post/:x"; "/someone" → "/other"; "/" → "/". */
export function normaliseRoute(pathname: string): string {
  const segs = String(pathname || "/").split(/[?#]/)[0].split("/").filter(Boolean);
  if (segs.length === 0) return "/";
  const first = segs[0].toLowerCase();
  const head = KNOWN_ROUTES.has(first) ? first : "other";
  return segs.length > 1 ? `/${head}/:x` : `/${head}`;
}

function currentRoute(): string | undefined {
  try {
    return normaliseRoute(location.pathname);
  } catch {
    return undefined;
  }
}

/** FNV-1a 32-bit of the message with numbers, URLs and quoted values removed: same bug → same hash. */
export function hashMessage(message: string): string {
  const norm = String(message ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/(["'`]).*?\1/g, "<v>")
    .replace(/[0-9a-f]{8,}/g, "<id>")
    .replace(/\d+/g, "0")
    .slice(0, 200);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/* ── record ──────────────────────────────────────────────────────────────── */

/** `build` overrides the app build (a native exit is credited to the build that was running). */
function push(e: Omit<TelemetryEvent, "platform" | "app_build" | "route">, build?: string): void {
  try {
    if (queue.length >= MAX_QUEUE) return;
    const b = build ? String(build).replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 40) || appBuild() : appBuild();
    queue.push({ ...e, platform: telemetryPlatform(), app_build: b, route: currentRoute() });
  } catch {
    /* rule 1 */
  }
}

export function recordTiming(metric: string, durationMs: number, ok: boolean): void {
  try {
    const rate = SAMPLE[metric] ?? 1;
    if (rate < 1 && Math.random() >= rate) return;
    const d = Math.max(0, Math.min(MAX_DURATION_MS, Math.round(Number(durationMs) || 0)));
    push({ kind: "timing", metric, ok: Boolean(ok), duration_ms: d });
  } catch {
    /* rule 1 */
  }
}

export function recordError(metric: "onerror" | "unhandledrejection" | "react", err: unknown): void {
  try {
    if (errorCount >= MAX_ERRORS_PER_LOAD) return;
    const e = err as { name?: unknown; message?: unknown } | null;
    const rawName = err instanceof Error || (e && typeof e.name === "string") ? String(e?.name) : "NonError";
    const name = rawName.replace(/[^A-Za-z]/g, "").slice(0, 40) || "Error";
    const message = typeof err === "string" ? err : e && e.message != null ? String(e.message) : String(err);
    const hash = hashMessage(`${name}:${message}`);
    const seen = errorSeen.get(hash) ?? 0;
    if (seen >= MAX_SAME_ERROR) return;
    errorSeen.set(hash, seen + 1);
    errorCount++;
    push({ kind: "error", metric, error_name: name, error_hash: hash });
  } catch {
    /* rule 1 */
  }
}

export function recordRealtime(status: string): void {
  try {
    const s = String(status).toLowerCase().replace(/[^a-z_]/g, "");
    if (!s || s === "closed") return; // CLOSED is the normal teardown
    push({ kind: "realtime", metric: `realtime.${s}` });
  } catch {
    /* rule 1 */
  }
}

/* ── send ────────────────────────────────────────────────────────────────── */

let flushing = false;

export async function flushTelemetry(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      queue.length = 0; // rule 3: signed out → drop
      return;
    }
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH);
      // The RPC is newer than the generated types.
      const { error } = await supabase.rpc("record_client_telemetry" as never, { _events: batch } as never);
      if (error) break; // rule 1: drop, do not retry
    }
  } catch {
    /* rule 1 */
  } finally {
    flushing = false;
  }
}

/** Tests only. */
export function __telemetryQueue(): readonly TelemetryEvent[] {
  return queue;
}
export function __resetTelemetry(): void {
  queue.length = 0;
  errorSeen.clear();
  errorCount = 0;
}

/* ── install (once, at app start: web and the Android/iOS WebView) ──────── */

function patchRealtime(): void {
  const proto = RealtimeChannel?.prototype as unknown as {
    subscribe: (cb?: (status: string, err?: Error) => void, timeout?: number) => unknown;
    __s2Patched?: boolean;
  };
  if (!proto || proto.__s2Patched || typeof proto.subscribe !== "function") return;
  const original = proto.subscribe;
  proto.subscribe = function (this: unknown, cb?: (status: string, err?: Error) => void, timeout?: number) {
    let reported = 0;
    const wrapped = (status: string, err?: Error) => {
      try {
        // First outcome of this subscribe, then at most 2 more failures (reconnect loops).
        if (reported === 0 || (status !== "SUBSCRIBED" && reported < 3)) {
          reported++;
          recordRealtime(status);
        }
      } catch {
        /* rule 1 */
      }
      if (cb) cb(status, err);
    };
    return original.call(this, wrapped, timeout);
  };
  proto.__s2Patched = true;
}

export function installTelemetry(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    window.addEventListener("error", (ev: ErrorEvent) => {
      // Resource load errors do not bubble to window; this is a script error.
      recordError("onerror", ev.error ?? ev.message);
    });
    window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
      recordError("unhandledrejection", ev.reason);
    });
    patchRealtime();

    const app = (window as unknown as {
      Capacitor?: { Plugins?: { App?: { getInfo?: () => Promise<{ build?: string }> } } };
    }).Capacitor?.Plugins?.App;
    const start = () => {
      push({ kind: "session", metric: "app.start" });
      // Native crash / OOM / ANR of an EARLIER process, from the OS's own record
      // (Android ExitInfo plugin; absent on web, iOS and older app builds).
      if (telemetryPlatform() === "android") {
        void reportNativeExits(appBuild(), (metric, build) => push({ kind: "session", metric }, build)).then(
          (n) => {
            if (n > 0) void flushTelemetry(); // send now: a crash loop may not live 15 s
          },
          () => undefined,
        );
      }
    };
    if (telemetryPlatform() !== "web" && app?.getInfo) {
      app.getInfo().then(
        (i) => {
          if (i?.build) nativeBuild = `v${i.build}`;
          start();
        },
        start,
      );
    } else {
      start();
    }

    startVisibilityInterval(() => void flushTelemetry(), FLUSH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushTelemetry();
    });
  } catch {
    /* rule 1 */
  }
}
