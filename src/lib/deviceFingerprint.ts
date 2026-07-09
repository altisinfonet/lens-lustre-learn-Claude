/**
 * Lightweight device fingerprinting for session tracking.
 * Generates a stable device ID from browser characteristics (no MAC address).
 */

export interface DeviceInfo {
  deviceId: string;
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet";
}

function getBrowser(ua: string): string {
  if (ua.includes("Edg/")) return "Microsoft Edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Google Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("Firefox/")) return "Firefox";
  return "Unknown Browser";
}

function getOS(ua: string): string {
  if (ua.includes("Windows NT 10")) return "Windows 10/11";
  if (ua.includes("Windows NT")) return "Windows";
  if (ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  if (ua.includes("Linux")) return "Linux";
  if (ua.includes("CrOS")) return "Chrome OS";
  return "Unknown OS";
}

function getDeviceType(ua: string): "desktop" | "mobile" | "tablet" {
  if (/iPad|tablet/i.test(ua)) return "tablet";
  if (/Mobile|Android.*Mobile|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

/** Generate a stable device ID from browser characteristics. Stored in localStorage. */
function getOrCreateDeviceId(): string {
  const key = "device_fingerprint_id";
  let id = localStorage.getItem(key);
  if (id) return id;

  // Create a simple fingerprint from available data
  const canvas = (() => {
    try {
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      if (!ctx) return "no-canvas";
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillText("fp", 2, 2);
      return c.toDataURL().slice(-20);
    } catch {
      return "no-canvas";
    }
  })();

  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvas,
  ].join("|");

  // Simple hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }

  id = "dev_" + Math.abs(hash).toString(36) + "_" + Date.now().toString(36);
  localStorage.setItem(key, id);
  return id;
}

export function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  return {
    deviceId: getOrCreateDeviceId(),
    browser: getBrowser(ua),
    os: getOS(ua),
    deviceType: getDeviceType(ua),
  };
}
