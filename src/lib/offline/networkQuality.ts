/**
 * OFF-3 · how good is the network right now? One answer for the whole app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Three inputs, in order of strength:
 *   1. OFFLINE — `navigator.onLine === false` (and the `offline` event).
 *   2. SLOW, declared — the Network Information API says `slow-2g`/`2g`, or the
 *      member turned on Data Saver (`saveData`). Chromium/Android WebView only;
 *      absent elsewhere, which simply means "not declared".
 *   3. SLOW, observed — every Supabase read reports its outcome here (from
 *      `timeoutFetch` in the client). Over the last WINDOW reads: a median above
 *      SLOW_MEDIAN_MS, or TIMEOUTS_FOR_SLOW of OUR 25 s timeouts, is slow. An
 *      instant failure (refused, DNS) is not reported: it is not slowness, and a
 *      dead network is the browser's `offline`, input 1.
 *      This is the one input that works on every browser and on iOS.
 * It imports nothing: the Supabase client reports into it, and a module the
 * client imports must not import the client back.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type NetState = { online: boolean; slow: boolean; reason: "offline" | "declared" | "observed" | null };

export const WINDOW = 6;
export const SLOW_MEDIAN_MS = 3000;
export const TIMEOUTS_FOR_SLOW = 2;

type Outcome = { ms: number; failed: boolean };
let outcomes: Outcome[] = [];
const listeners = new Set<() => void>();
let state: NetState = compute();

interface NetInfo { effectiveType?: string; saveData?: boolean; addEventListener?: (t: string, f: () => void) => void }
function connection(): NetInfo | undefined {
  try { return (globalThis.navigator as unknown as { connection?: NetInfo } | undefined)?.connection; } catch { return undefined; }
}

function compute(): NetState {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav && nav.onLine === false) return { online: false, slow: true, reason: "offline" };
  const c = connection();
  if (c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g")) {
    return { online: true, slow: true, reason: "declared" };
  }
  const failures = outcomes.filter((o) => o.failed).length;
  const times = outcomes.filter((o) => !o.failed).map((o) => o.ms).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  if (failures >= TIMEOUTS_FOR_SLOW || (outcomes.length >= 3 && median > SLOW_MEDIAN_MS)) {
    return { online: true, slow: true, reason: "observed" };
  }
  return { online: true, slow: false, reason: null };
}

function update() {
  const next = compute();
  if (next.online === state.online && next.slow === state.slow && next.reason === state.reason) return;
  state = next;
  listeners.forEach((l) => { try { l(); } catch { /* a listener must not break the others */ } });
}

/** Called by the Supabase client for every read: how long it took, and whether it hit our timeout. */
export function noteOutcome(ms: number, failed: boolean) {
  outcomes = [...outcomes, { ms, failed }].slice(-WINDOW);
  update();
}

export function getNetState(): NetState { return state; }
export function subscribeNetState(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam. */
export function resetNetState() { outcomes = []; state = compute(); }

let wired = false;
/** Listen to the browser's own signals. Safe to call more than once. */
export function wireBrowserSignals() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  try { connection()?.addEventListener?.("change", update); } catch { /* not supported */ }
  update();
}
