/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CORS FOR THE PAGES FUNCTIONS THE NATIVE APP CALLS. ONE HELPER.
 *
 * The Android app serves its page from https://localhost (capacitor.config.ts,
 * androidScheme "https"); an iOS build would be capacitor://localhost. Its
 * calls to /api/video/* and /config/site-settings therefore cross origins
 * (src/lib/net/siteApi.ts). Before this file every one of them answered the
 * preflight with 405 and no Access-Control-Allow-Origin, so the WebView threw
 * the response away — the live "This video can't play right now" in app
 * 1.2.22 (2026-10-17).
 *
 * THE RULES, AND WHY
 *   · An allow-list matched by EQUALITY: the two app origins plus this lane's
 *     own SITE_ORIGIN. Never a prefix or suffix match (see
 *     src/__tests__/corsOriginAllowlist.test.ts for what startsWith let in),
 *     never "*".
 *   · A stranger origin gets NO Access-Control-Allow-Origin at all — the
 *     browser then refuses to hand it the response. The request itself is
 *     still answered as before (CORS is not authentication; every route keeps
 *     its own bearer / RLS checks).
 *   · No Access-Control-Allow-Credentials: the app sends a bearer header, not
 *     cookies, so credentialed CORS is never needed and never offered.
 *   · `Vary: Origin` on every response, so no cache keyed on the URL alone
 *     can hand one origin's headers to another.
 *   · Error responses carry the same headers, or the app would see a CORS
 *     failure instead of the error code it knows how to show.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The native app's own origins. Android: https://localhost; iOS: capacitor://localhost. */
export const APP_ORIGINS = ["capacitor://localhost"] as const;

export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
/** What the client actually sends: siteFetch adds content-type and authorization; site-settings asks with accept / if-none-match. */
export const CORS_ALLOW_HEADERS = "authorization, content-type, accept, if-none-match";
/** Preflights are cached by the WebView for this long (seconds). */
const CORS_MAX_AGE = "600";

export interface CorsEnv { SITE_ORIGIN?: string }

/** The origin to echo, or null when this request's origin is not allowed. */
export function allowedOrigin(request: Request, env: CorsEnv | undefined): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if ((APP_ORIGINS as readonly string[]).includes(origin)) return origin;
  const own = typeof env?.SITE_ORIGIN === "string" ? env.SITE_ORIGIN.trim().replace(/\/+$/, "") : "";
  return own !== "" && origin === own ? origin : null;
}

/** A copy of `res` with this request's CORS headers. Always adds Vary: Origin. */
export function withCorsHeaders(res: Response, request: Request, env: CorsEnv | undefined): Response {
  const out = new Response(res.body, res);
  const vary = out.headers.get("vary");
  if (!vary || !/(^|,)\s*origin\s*(,|$)/i.test(vary)) out.headers.set("vary", vary ? `${vary}, Origin` : "Origin");
  const origin = allowedOrigin(request, env);
  if (origin) {
    out.headers.set("access-control-allow-origin", origin);
    out.headers.set("access-control-allow-methods", CORS_ALLOW_METHODS);
    out.headers.set("access-control-allow-headers", CORS_ALLOW_HEADERS);
    out.headers.set("access-control-expose-headers", "etag");
    out.headers.set("access-control-max-age", CORS_MAX_AGE);
  }
  return out;
}

/**
 * Run a route with CORS: OPTIONS is answered 204 here (the route never sees
 * it), every other response — success or error — gets the headers above.
 */
export async function withCors(request: Request, env: CorsEnv | undefined, run: () => Promise<Response>): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCorsHeaders(new Response(null, { status: 204, headers: { "cache-control": "no-store" } }), request, env);
  }
  return withCorsHeaders(await run(), request, env);
}
