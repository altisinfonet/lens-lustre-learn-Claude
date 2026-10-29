/**
 * S2 · NATIVE EXIT REASONS → telemetry.
 *
 * The Android app's ExitInfo plugin (resources/android/java/.../ExitInfoPlugin.java)
 * returns the OS's own record of why this app's earlier processes ended. On
 * each app start we turn every NEW bad exit into one telemetry metric:
 *
 *   crash          → app.exit.crash
 *   crash_native   → app.exit.crash_native
 *   low_memory     → app.exit.low_memory   (only if it died ON SCREEN — the OS
 *                                           killing a backgrounded app for
 *                                           memory is normal Android, not a crash)
 *   anr            → app.exit.anr
 *
 * An exit is credited to the build that was RUNNING when it happened (the
 * build stored at the previous start), not to the build that reports it, so
 * an update straight after a crash does not move the crash onto the new build.
 *
 * First run of this code (nothing stored): we only remember "now" and report
 * nothing — older OS records cannot be tied to a build.
 *
 * NEVER throws. No plugin (web, iOS, an older app build) → nothing happens.
 */

export const EXIT_SINCE_KEY = "s2.exit.since";
export const EXIT_BUILD_KEY = "s2.exit.build";
/** At most this many exit rows per start (a crash loop must not flood the quota). */
export const MAX_EXITS_PER_START = 10;

export interface NativeExit {
  reason?: unknown;
  timestamp?: unknown;
  foreground?: unknown;
}
export interface ExitInfoPlugin {
  recent: () => Promise<{ supported?: unknown; exits?: unknown } | null | undefined>;
}
interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const METRIC: Record<string, string> = {
  crash: "app.exit.crash",
  crash_native: "app.exit.crash_native",
  low_memory: "app.exit.low_memory",
  anr: "app.exit.anr",
};

/** Pure: which exits after `since` count, as metrics, oldest first; and the newest timestamp seen. */
export function exitMetrics(exits: unknown, since: number): { metrics: string[]; newest: number } {
  const list = Array.isArray(exits) ? (exits as NativeExit[]) : [];
  let newest = since;
  const picked: { t: number; m: string }[] = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const t = Number(e.timestamp);
    if (!Number.isFinite(t) || t <= since) continue;
    newest = Math.max(newest, t);
    const reason = typeof e.reason === "string" ? e.reason : "";
    const m = METRIC[reason];
    if (!m) continue;
    if (reason === "low_memory" && e.foreground !== true) continue;
    picked.push({ t, m });
  }
  picked.sort((a, b) => a.t - b.t);
  return { metrics: picked.slice(0, MAX_EXITS_PER_START).map((p) => p.m), newest };
}

export function exitInfoPlugin(): ExitInfoPlugin | null {
  try {
    const p = (window as unknown as { Capacitor?: { Plugins?: { ExitInfo?: Partial<ExitInfoPlugin> } } }).Capacitor
      ?.Plugins?.ExitInfo;
    return p && typeof p.recent === "function" ? (p as ExitInfoPlugin) : null;
  } catch {
    return null;
  }
}

function defaultStorage(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the plugin once and calls `record(metric, build)` for each new bad exit.
 * Returns how many were recorded. Always stores the current build for next time.
 */
let ranThisLoad = false;
/** Tests only. */
export function __resetNativeExits(): void {
  ranThisLoad = false;
}

export async function reportNativeExits(
  currentBuild: string,
  record: (metric: string, build: string) => void,
  plugin: ExitInfoPlugin | null = exitInfoPlugin(),
  storage: KV | null = defaultStorage(),
  now: () => number = Date.now,
): Promise<number> {
  if (!plugin || !storage) return 0;
  // Once per page load: two calls would read the same `since` and report the same exits twice.
  if (ranThisLoad) return 0;
  ranThisLoad = true;
  let prevBuild: string | null = null;
  let since = NaN;
  try {
    prevBuild = storage.getItem(EXIT_BUILD_KEY);
    since = Number(storage.getItem(EXIT_SINCE_KEY) ?? NaN);
    storage.setItem(EXIT_BUILD_KEY, currentBuild);
  } catch {
    return 0;
  }
  try {
    if (!Number.isFinite(since)) {
      storage.setItem(EXIT_SINCE_KEY, String(now()));
      return 0;
    }
    const res = await plugin.recent();
    if (!res || res.supported !== true) return 0;
    const { metrics, newest } = exitMetrics(res.exits, since);
    storage.setItem(EXIT_SINCE_KEY, String(newest));
    const build = prevBuild || currentBuild;
    for (const m of metrics) record(m, build);
    return metrics.length;
  } catch {
    return 0;
  }
}
