/**
 * Shared secure headers for all edge functions.
 * Includes CORS restrictions, security headers, and cache control.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ALLOW-LIST WAS MATCHED BY PREFIX, WHICH AN ATTACKER CONTROLS.
 *
 * `ALLOWED_ORIGINS.some(o => requestOrigin.startsWith(o))` accepts anything
 * that BEGINS with an allowed origin, and anyone can register a domain that
 * does. Measured against the previous implementation:
 *
 *   ALLOWED  <production-apex>.evil.example
 *   ALLOWED  <production-apex>.attacker.net
 *   ALLOWED  <production-www-host>.evil.io
 *   blocked  <the staging lane's own origin>     <- the only legitimate one
 *
 * (The attacker hosts are written as placeholders rather than literals so this
 *  comment is not itself a lane leak; the exact strings are pinned in
 *  src/__tests__/corsOriginAllowlist.test.ts, where they belong.)
 *
 * Every one of those got Access-Control-Allow-Origin echoed back with
 * credentials-bearing endpoints behind it. The one origin the lane work exists
 * to serve was the one refused.
 *
 * Origins are compared by EQUALITY. Preview hosts match an anchored pattern
 * that also pins the scheme: the old `endsWith(".lovable.app")` accepted
 * `http://` just as happily, so a downgrade was a supported entry route.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ALLOWED_ORIGINS = [
  "https://50mmretina.com", // isolation-allow: this list IS the CORS policy; the production origins are its content, not a leak into it
  "https://www.50mmretina.com", // isolation-allow: as above — every lane's allow-list names production, because production is a legitimate caller
  "https://fiftymmretinaworld.lovable.app",
  "https://lens-lustre-learn.lovable.app",
  "https://id-preview--8658c335-87a2-4e48-86ad-6c1fff54dead.lovable.app",
  // ⚠ THE ANDROID APP'S ORIGIN. capacitor.config.ts sets androidScheme: "https",
  // so the Capacitor WebView serves the app from https://localhost and sends
  // that as its Origin. It is NOT one of the site hostnames and never was in
  // this list — until now it reached these endpoints only through the
  // permissive "*" fallback below. Removing that fallback without naming the
  // app origin here would have broken every shipped Android build the moment
  // it called dashboard-init, get-wallet-summary, submit-deposit or any of the
  // other 27 functions built on these headers. The production R2 bucket CORS
  // policy carries the same entry, for the same reason.
  "https://localhost",
  "capacitor://localhost",
];

/** Anchored, https-only. `endsWith(".lovable.app")` matched http:// too. */
const PREVIEW_HOST = /^https:\/\/[a-z0-9-]+\.lovable\.app$/;

/**
 * This lane's own origin, from SITE_ORIGIN.
 *
 * ⚠ READ LENIENTLY, AND THIS MUST NEVER THROW. These headers are built for
 * EVERY response, including error responses. A throw here would turn one
 * missing or malformed variable into a total outage across every edge
 * function — the failure would be larger than the one it reported. Losing a
 * non-production lane's CORS entry is visible the moment someone uses that
 * lane, and it is recoverable by setting the variable. That asymmetry is why
 * this one place reads leniently while laneConfig.ts refuses: an email link is
 * sent once and cannot be recalled, a CORS header is re-evaluated every
 * request.
 */
function laneOrigin(): string | null {
  try {
    const raw = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } })
      .Deno?.env?.get("SITE_ORIGIN");
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim().replace(/\/+$/, "");
    return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Whether this exact origin may be echoed back in
 * Access-Control-Allow-Origin. Equality for known origins, anchored pattern
 * for preview hosts. An empty Origin is never allowed: absent is not allowed.
 */
export function isOriginAllowed(requestOrigin: string): boolean {
  const o = (requestOrigin || "").trim().replace(/\/+$/, "");
  if (o === "") return false;
  if (ALLOWED_ORIGINS.includes(o)) return true;
  if (PREVIEW_HOST.test(o)) return true;
  const lane = laneOrigin();
  // Equality again, so the lane's own origin cannot open look-alikes of itself.
  return lane !== null && o === lane;
}

/**
 * ⚠ THREE CASES, NOT TWO. The old code had one `origin` variable defaulting to
 * "*", which meant a DISALLOWED origin was answered with a wildcard — the
 * allow-list decided whose origin got echoed, and everybody else still got a
 * usable CORS grant. Browsers refuse "*" for credentialed requests, so cookie
 * flows were never exposed, but every non-credentialed call from any origin on
 * the internet was permitted.
 *
 *   no Origin header      -> not a CORS request at all. Keep "*": it is
 *                            meaningless to the caller and preserves the
 *                            behaviour of non-browser callers and of the call
 *                            sites that invoke getSecureHeaders() with no req.
 *   Origin, allowed       -> echo that exact origin.
 *   Origin, NOT allowed   -> emit NO Access-Control-Allow-Origin at all. The
 *                            browser then blocks the response, which is what
 *                            "not allowed" is supposed to mean.
 */
export function getSecureHeaders(req?: Request): Record<string, string> {
  const requestOrigin = req ? (req.headers.get("Origin") || "") : "";
  const isCorsRequest = requestOrigin !== "";
  const allowed = isCorsRequest && isOriginAllowed(requestOrigin);

  const acao: Record<string, string> = !isCorsRequest
    ? { "Access-Control-Allow-Origin": "*" }
    : allowed
      ? { "Access-Control-Allow-Origin": requestOrigin, "Vary": "Origin" }
      : { "Vary": "Origin" };

  return {
    ...acao,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Permitted-Cross-Domain-Policies": "none",
  };
}
