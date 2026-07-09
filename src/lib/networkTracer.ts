/**
 * Runtime Network Tracer — DEBUG ONLY
 * Intercepts all fetch() calls, logs timing/size/duplicates,
 * and prints a forensic report after the initial load window.
 *
 * Usage: import and call `startNetworkTrace()` once in main.tsx or a useEffect.
 * Call `stopNetworkTrace()` to print the report early.
 */

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
      throw err;
    }
  };

  reportTimer = setTimeout(() => {
    printNetworkReport();
  }, windowMs);

  console.log(`%c[NetworkTracer] Started — will report in ${windowMs}ms`, "color: #0ea5e9; font-weight: bold");
}

export function stopNetworkTrace() {
  if (reportTimer) clearTimeout(reportTimer);
  printNetworkReport();
}

function printNetworkReport() {
  window.__networkTraceActive = false;
  if (originFetch) window.fetch = originFetch;

  const trace = window.API_TRACE ?? [];
  if (trace.length === 0) {
    console.log("%c[NetworkTracer] No API calls captured.", "color: orange");
    return;
  }

  const sorted = [...trace].sort((a, b) => a.startMs - b.startMs);

  // ── Section 1: Summary ──
  const endpoints = new Map<string, TraceEntry[]>();
  sorted.forEach((t) => {
    const list = endpoints.get(t.endpoint) ?? [];
    list.push(t);
    endpoints.set(t.endpoint, list);
  });

  const duplicates = [...endpoints.entries()].filter(([, v]) => v.length > 1);
  const totalSize = sorted.reduce((s, t) => s + (t.sizeBytes ?? 0), 0);

  console.log(
    `%c╔══════════════════════════════════════════╗\n` +
    `║       NETWORK FORENSIC REPORT            ║\n` +
    `╚══════════════════════════════════════════╝`,
    "color: #f59e0b; font-weight: bold; font-size: 14px"
  );

  console.log(`%c📊 SUMMARY`, "color: #10b981; font-weight: bold; font-size: 12px");
  console.log(`   Total API calls:     ${sorted.length}`);
  console.log(`   Unique endpoints:    ${endpoints.size}`);
  console.log(`   Duplicate endpoints: ${duplicates.length}`);
  console.log(`   Total payload:       ${(totalSize / 1024).toFixed(1)} KB`);
  console.log(`   Trace window:        ${sorted[sorted.length - 1]?.endMs ?? 0}ms`);

  // ── Section 2: Timeline ──
  console.log(`\n%c⏱️  TIMELINE`, "color: #10b981; font-weight: bold; font-size: 12px");
  console.table(
    sorted.map((t) => ({
      "#": t.id,
      "T+ms": t.startMs,
      endpoint: t.endpoint,
      method: t.method,
      duration: `${t.durationMs}ms`,
      status: t.status,
      size: t.sizeBytes ? `${(t.sizeBytes / 1024).toFixed(1)}KB` : "—",
      caller: t.caller,
    }))
  );

  // ── Section 3: Duplicates ──
  if (duplicates.length > 0) {
    console.log(`\n%c🔴 DUPLICATE REQUESTS`, "color: #ef4444; font-weight: bold; font-size: 12px");
    duplicates.forEach(([ep, calls]) => {
      const severity = calls.length > 2 ? "HIGH" : "MEDIUM";
      console.log(`   [${severity}] ${ep} — called ${calls.length}x`);
      calls.forEach((c) => console.log(`         T+${c.startMs}ms (${c.durationMs}ms) via ${c.caller}`));
    });
  } else {
    console.log(`\n%c✅ No duplicate requests`, "color: #10b981; font-weight: bold");
  }

  // ── Section 4: Slow requests ──
  const slow = sorted.filter((t) => t.durationMs > 200);
  if (slow.length > 0) {
    console.log(`\n%c🐢 SLOW REQUESTS (>200ms)`, "color: #f59e0b; font-weight: bold; font-size: 12px");
    slow.sort((a, b) => b.durationMs - a.durationMs).forEach((t) => {
      console.log(`   ${t.endpoint} — ${t.durationMs}ms (${t.caller})`);
    });
  }

  // ── Section 5: Large payloads ──
  const large = sorted.filter((t) => (t.sizeBytes ?? 0) > 50_000);
  if (large.length > 0) {
    console.log(`\n%c📦 LARGE PAYLOADS (>50KB)`, "color: #f59e0b; font-weight: bold; font-size: 12px");
    large.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)).forEach((t) => {
      console.log(`   ${t.endpoint} — ${((t.sizeBytes ?? 0) / 1024).toFixed(1)}KB (${t.caller})`);
    });
  }

  // ── Section 6: Parallel vs Sequential ──
  console.log(`\n%c⚡ CONCURRENCY ANALYSIS`, "color: #10b981; font-weight: bold; font-size: 12px");
  const buckets = new Map<number, TraceEntry[]>();
  sorted.forEach((t) => {
    const bucket = Math.floor(t.startMs / 50) * 50; // 50ms buckets
    const list = buckets.get(bucket) ?? [];
    list.push(t);
    buckets.set(bucket, list);
  });
  [...buckets.entries()].sort((a, b) => a[0] - b[0]).forEach(([ms, entries]) => {
    if (entries.length > 1) {
      console.log(`   T+${ms}ms: ${entries.length} parallel → ${entries.map((e) => e.endpoint).join(", ")}`);
    }
  });

  console.log(`\n%c══ END REPORT ══`, "color: #f59e0b; font-weight: bold");
}
