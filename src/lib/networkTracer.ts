/**
 * Runtime Network Tracer — DEVELOPMENT ONLY.
 *
 * Intercepts fetch(), records timing/size/duplicates for API calls, and emits
 * a structured forensic report once the initial load window closes.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * OWNER DECISION, 2026-08-06: "Gate to dev AND convert."
 *
 * WHAT THIS FILE USED TO DO, AND WHY IT WAS WRONG.
 * `main.tsx` called `startNetworkTrace(8000)` with no environment guard, so
 * every one of these ran in PRODUCTION, on every member's phone:
 *   * window.fetch was replaced for the first 8 seconds of every visit;
 *   * every API response was `.clone()`d and read to the end just to measure
 *     its length — real work and real memory on a mobile device;
 *   * a 22-call console report was printed into the member's console.
 * None of that is a member feature. It is a developer tool that had escaped.
 *
 * THE THREE GUARDS, IN ORDER. Any one of them is enough; all three are here
 * because this already shipped to members once.
 *   1. `main.tsx` only calls startNetworkTrace() inside `import.meta.env.DEV`.
 *      Vite resolves that at build time, so the call disappears from the
 *      production bundle entirely.
 *   2. `startNetworkTrace()` and `stopNetworkTrace()` below each return
 *      immediately outside development, so a future call site added anywhere
 *      cannot re-open this. Same pattern as decisionParityProbe.ts.
 *   3. Every log this file emits is `debug`, which logger.ts neither prints in
 *      production nor ever persists to the database.
 *
 * WHAT IS LOGGED, AND WHAT IS NOT.
 * The tracer logs the ENDPOINT (`table:posts`, `fn:notify`), never the raw
 * URL. guessEndpoint() drops the query string, and the query string is where
 * row ids, filters and OAuth parameters live. The raw URL stays on
 * window.API_TRACE for interactive inspection in devtools, where it never
 * leaves the machine that produced it.
 *
 * Usage: `startNetworkTrace()` once in main.tsx or a useEffect.
 * `stopNetworkTrace()` reports early. `window.API_TRACE` holds every entry,
 * untruncated — the logged timeline is capped (see MAX_DETAIL_ENTRIES).
 * ───────────────────────────────────────────────────────────────────────────
 */
import { logger } from "@/lib/logger";

const FILE = "src/lib/networkTracer.ts";

/** A call slower than this is worth a developer's attention. */
const SLOW_MS = 200;

/** A response bigger than this costs the member real mobile data. */
const LARGE_BYTES = 50_000;

/**
 * How many timeline rows travel inside a log's `detail`.
 *
 * redact() in logger.ts slices arrays at 20 entries, so anything beyond that
 * would be silently dropped and the log would quietly lie about how much it
 * carried. The cap is stated here, reported in the log itself as
 * `timelineTruncated`, and the complete list is always on window.API_TRACE.
 */
const MAX_DETAIL_ENTRIES = 20;

interface TraceEntry {
  id: number;
  url: string;
  endpoint: string;
  method: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: number;
  sizeBytes: number | null;
  caller: string;
}

declare global {
  interface Window {
    API_TRACE: TraceEntry[];
    __networkTraceActive?: boolean;
  }
}

let counter = 0;
let originFetch: typeof fetch | null = null;
let traceStart = 0;
let reportTimer: ReturnType<typeof setTimeout> | null = null;

function guessEndpoint(url: string): string {
  try {
    const u = new URL(url);
    // Edge function
    const fnMatch = u.pathname.match(/\/functions\/v1\/(.+)/);
    if (fnMatch) return `fn:${fnMatch[1]}`;
    // PostgREST table
    const restMatch = u.pathname.match(/\/rest\/v1\/(.+)/);
    if (restMatch) return `table:${restMatch[1].split("?")[0]}`;
    // Auth
    if (u.pathname.includes("/auth/")) return `auth:${u.pathname.split("/auth/")[1]?.split("?")[0]}`;
    // Storage
    if (u.pathname.includes("/storage/")) return `storage:${u.pathname.split("/storage/")[1]?.split("?")[0]}`;
    return u.pathname;
  } catch {
    return url.slice(0, 80);
  }
}

function guessCaller(): string {
  try {
    const stack = new Error().stack ?? "";
    const lines = stack.split("\n").slice(3); // skip Error, interceptor, guessCaller
    for (const line of lines) {
      // Match component/hook names from source paths
      const srcMatch = line.match(/src\/([\w/.-]+)\.(tsx?|jsx?)/);
      if (srcMatch) return srcMatch[1].replace(/.*\//, "");
      // Match hook names
      const hookMatch = line.match(/(use[A-Z]\w+)/);
      if (hookMatch) return hookMatch[1];
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function startNetworkTrace(windowMs = 8000) {
  // GUARD 2 of 3 — see the header. Not redundant with main.tsx: this one
  // protects every future call site, and Vite tree-shakes the branch away.
  if (!import.meta.env.DEV) return;

  if (window.__networkTraceActive) return;
  window.__networkTraceActive = true;
  window.API_TRACE = [];
  traceStart = performance.now();
  originFetch = window.fetch;

  window.fetch = async function tracedFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (!window.__networkTraceActive || !originFetch) {
      return originFetch!(input, init);
    }

    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");

    // Skip non-API calls (HMR, assets, etc.)
    const isApi = url.includes("/rest/v1/") || url.includes("/functions/v1/") || url.includes("/auth/") || url.includes("/storage/");
    if (!isApi) return originFetch!(input, init);

    const id = ++counter;
    const startMs = Math.round(performance.now() - traceStart);
    const caller = guessCaller();

    try {
      const resp = await originFetch!(input, init);
      const endMs = Math.round(performance.now() - traceStart);
      const clone = resp.clone();
      let sizeBytes: number | null = null;
      try {
        const body = await clone.text();
        sizeBytes = body.length;
      } catch { /* ignore */ }

      const entry: TraceEntry = {
        id, url, endpoint: guessEndpoint(url), method: method.toUpperCase(),
        startMs, endMs, durationMs: endMs - startMs,
        status: resp.status, sizeBytes, caller,
      };
      window.API_TRACE.push(entry);
      return resp;
    } catch (err) {
      const endMs = Math.round(performance.now() - traceStart);
      window.API_TRACE.push({
        id, url, endpoint: guessEndpoint(url), method: method.toUpperCase(),
        startMs, endMs, durationMs: endMs - startMs,
        status: 0, sizeBytes: null, caller,
      });
      // Deliberately NOT logged here. This runs inside every fetch the app
      // makes; the caller logs its own failure with the code that means
      // something, and a second line from the interceptor would double every
      // network incident in the console for no new information.
      throw err;
    }
  };

  reportTimer = setTimeout(() => {
    printNetworkReport();
  }, windowMs);

  logger.debug({
    code: "SYS-9003",
    event: "NETWORK_TRACE_STARTED",
    fn: "startNetworkTrace",
    file: FILE,
    message: "The development network tracer began intercepting fetch().",
    reason: "startNetworkTrace() was called in a development build.",
    expected: `A forensic report ${windowMs}ms from now, or sooner if stopNetworkTrace() is called.`,
    actual: "window.fetch wrapped; API calls are being recorded.",
    detail: { windowMs, slowThresholdMs: SLOW_MS, largePayloadBytes: LARGE_BYTES },
  });
}

export function stopNetworkTrace() {
  // GUARD 2 of 3, again — stopNetworkTrace is exported and could be called
  // from anywhere. Outside development there is nothing to stop and nothing
  // to report.
  if (!import.meta.env.DEV) return;

  if (reportTimer) clearTimeout(reportTimer);
  printNetworkReport();
}

/**
 * Emit the report as structured logs.
 *
 * Named "print" for continuity with the call sites; nothing here writes to the
 * console directly any more. One SYS-9004 line carries the whole picture, then
 * one line per finding a developer can act on — the duplicates, the slow calls
 * and the large payloads — so each is groupable by code in the Error Log
 * viewer's filters rather than buried inside one blob.
 */
function printNetworkReport() {
  window.__networkTraceActive = false;
  if (originFetch) window.fetch = originFetch;

  const trace = window.API_TRACE ?? [];
  if (trace.length === 0) {
    logger.debug({
      code: "SYS-9004",
      event: "NETWORK_TRACE_REPORT",
      fn: "printNetworkReport",
      file: FILE,
      message: "The development network tracer window closed with nothing recorded.",
      reason: "No request matched /rest/v1/, /functions/v1/, /auth/ or /storage/ during the window.",
      expected: "At least one API call during the initial load.",
      actual: "0 API calls captured.",
      nextStep:
        "Confirm the page under test actually loads data, and that the tracer started before that data was requested.",
      detail: { totalCalls: 0 },
    });
    return;
  }

  const sorted = [...trace].sort((a, b) => a.startMs - b.startMs);

  // ── Grouping ──
  const endpoints = new Map<string, TraceEntry[]>();
  sorted.forEach((t) => {
    const list = endpoints.get(t.endpoint) ?? [];
    list.push(t);
    endpoints.set(t.endpoint, list);
  });

  const duplicates = [...endpoints.entries()].filter(([, v]) => v.length > 1);
  const totalSize = sorted.reduce((s, t) => s + (t.sizeBytes ?? 0), 0);
  const slow = sorted.filter((t) => t.durationMs > SLOW_MS).sort((a, b) => b.durationMs - a.durationMs);
  const large = sorted
    .filter((t) => (t.sizeBytes ?? 0) > LARGE_BYTES)
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));

  // ── Concurrency: how many calls started inside the same 50ms bucket ──
  const buckets = new Map<number, TraceEntry[]>();
  sorted.forEach((t) => {
    const bucket = Math.floor(t.startMs / 50) * 50;
    const list = buckets.get(bucket) ?? [];
    list.push(t);
    buckets.set(bucket, list);
  });
  const parallelBatches = [...buckets.entries()]
    .filter(([, entries]) => entries.length > 1)
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_DETAIL_ENTRIES)
    .map(([ms, entries]) => ({
      atMs: ms,
      count: entries.length,
      endpoints: entries.map((e) => e.endpoint).join(", "),
    }));

  // ── Section 1: the whole picture, one groupable line ──
  logger.debug({
    code: "SYS-9004",
    event: "NETWORK_TRACE_REPORT",
    fn: "printNetworkReport",
    file: FILE,
    message: "The development network tracer window closed; here is the forensic report.",
    reason: "The trace window elapsed, or stopNetworkTrace() was called.",
    expected: "No duplicate endpoints, and no call over the slow or payload thresholds.",
    actual: `${sorted.length} calls · ${endpoints.size} unique endpoints · ${duplicates.length} duplicated · ${slow.length} slow · ${large.length} large`,
    durationMs: sorted[sorted.length - 1]?.endMs ?? 0,
    nextStep:
      "Read the SYS-9005 / SYS-9006 / SYS-9007 lines that follow for the individual findings. window.API_TRACE holds every entry untruncated.",
    detail: {
      totalCalls: sorted.length,
      uniqueEndpoints: endpoints.size,
      duplicateEndpoints: duplicates.length,
      totalPayloadKb: Number((totalSize / 1024).toFixed(1)),
      traceWindowMs: sorted[sorted.length - 1]?.endMs ?? 0,
      parallelBatches,
      // redact() slices arrays at 20 — say so rather than silently truncate.
      timelineTruncated: sorted.length > MAX_DETAIL_ENTRIES,
      timeline: sorted.slice(0, MAX_DETAIL_ENTRIES).map((t) => ({
        id: t.id,
        atMs: t.startMs,
        endpoint: t.endpoint,
        method: t.method,
        durationMs: t.durationMs,
        status: t.status,
        sizeBytes: t.sizeBytes,
        caller: t.caller,
      })),
    },
  });

  // ── Section 2: duplicate endpoints ──
  duplicates.forEach(([endpoint, calls]) => {
    logger.debug({
      code: "SYS-9005",
      event: "NETWORK_TRACE_DUPLICATE_ENDPOINT",
      fn: "printNetworkReport",
      file: FILE,
      message: `The same endpoint was requested ${calls.length} times during the trace window.`,
      reason:
        calls.length > 2
          ? "Called three or more times — usually a hook running on every render."
          : "Called twice — usually two components asking for the same data.",
      expected: "One request per endpoint during the initial load.",
      actual: `${calls.length} requests to ${endpoint}`,
      detail: {
        endpoint,
        count: calls.length,
        calls: calls.slice(0, MAX_DETAIL_ENTRIES).map((c) => ({
          atMs: c.startMs,
          durationMs: c.durationMs,
          caller: c.caller,
        })),
      },
    });
  });

  // ── Section 3: slow requests ──
  slow.forEach((t) => {
    logger.debug({
      code: "SYS-9006",
      event: "NETWORK_TRACE_SLOW_REQUEST",
      fn: "printNetworkReport",
      file: FILE,
      message: "A single API call was slower than the tracer's threshold.",
      reason: "Measured wall-clock time from request start to response received.",
      expected: `${SLOW_MS}ms or less`,
      actual: `${t.durationMs}ms`,
      durationMs: t.durationMs,
      detail: {
        endpoint: t.endpoint,
        method: t.method,
        status: t.status,
        sizeBytes: t.sizeBytes,
        caller: t.caller,
        atMs: t.startMs,
      },
    });
  });

  // ── Section 4: large payloads ──
  large.forEach((t) => {
    logger.debug({
      code: "SYS-9007",
      event: "NETWORK_TRACE_LARGE_PAYLOAD",
      fn: "printNetworkReport",
      file: FILE,
      message: "A single API response was larger than the tracer's payload threshold.",
      reason: "Response body length measured from a clone of the response.",
      expected: `${(LARGE_BYTES / 1024).toFixed(0)}KB or less`,
      actual: `${((t.sizeBytes ?? 0) / 1024).toFixed(1)}KB`,
      detail: {
        endpoint: t.endpoint,
        method: t.method,
        sizeBytes: t.sizeBytes,
        caller: t.caller,
        atMs: t.startMs,
      },
    });
  });
}
