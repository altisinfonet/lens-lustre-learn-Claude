/**
 * Device facts worth attaching to an upload failure.
 *
 * Owner instruction, 2026-08-06: every upload failure must carry the stage, the
 * app build, the Android version and the device.
 *
 * Everything here is read defensively and returns null rather than throwing —
 * this is called from inside failure handlers, and rule 1 of the logging
 * standard is that the logger never becomes the incident.
 *
 * NOTHING IDENTIFYING. Model and OS version describe the hardware, not the
 * person. No advertising id, no serial, no fingerprinting beyond what every
 * request already sends in its User-Agent header.
 */

export interface DeviceContext {
  /** "app" inside the installed Capacitor build, "web" everywhere else. */
  runtime: "app" | "web";
  /** The web bundle marker, e.g. "2026-08-06-6" — which code is actually running. */
  appBuild: string | null;
  /** Android major version, e.g. "14". Null off Android. */
  androidVersion: string | null;
  /** Device model as the User-Agent reports it, e.g. "SM-A546E". */
  deviceModel: string | null;
  /** Physical screen, which is how a rotation shows up in a log. */
  viewport: string | null;
  /** Rough device memory in GB where the browser exposes it. */
  deviceMemoryGb: number | null;
  /** Online at the moment of failure — separates a dead connection from a bad file. */
  online: boolean | null;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Pull the Android version and device model out of the User-Agent.
 *
 * Android UA looks like:
 *   Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 …
 */
function parseAndroid(ua: string): { androidVersion: string | null; deviceModel: string | null } {
  const version = ua.match(/Android\s+([\d.]+)/)?.[1] ?? null;
  // The model is the segment after the Android version, before the closing paren.
  const model = ua.match(/Android\s+[\d.]+;\s*([^;)]+)\)/)?.[1]?.trim() ?? null;
  return {
    androidVersion: version,
    // "K" is the placeholder Android 13+ sends when the model is frozen for
    // privacy. Recording it as a model would be a lie.
    deviceModel: model && model !== "K" && model !== "wv" ? model : null,
  };
}

export function deviceContext(): DeviceContext {
  const ua = safe(() => (typeof navigator !== "undefined" ? navigator.userAgent : "")) ?? "";
  const { androidVersion, deviceModel } = parseAndroid(ua);

  return {
    runtime: safe(() => Boolean((window as any)?.Capacitor?.isNativePlatform?.())) ? "app" : "web",
    appBuild: safe(() => (window as any)?.__APP_BUILD ?? null),
    androidVersion,
    deviceModel,
    viewport: safe(() => `${window.innerWidth}x${window.innerHeight}`),
    deviceMemoryGb: safe(() => (navigator as any)?.deviceMemory ?? null),
    online: safe(() => (typeof navigator !== "undefined" ? navigator.onLine : null)),
  };
}
