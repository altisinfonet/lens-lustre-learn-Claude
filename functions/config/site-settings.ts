/**
 * site_settings, SERVED FROM THE EDGE AND VERSIONED. P4, D2 half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Configuration is read constantly and changes rarely, and this app does the
 * opposite of what that implies. `siteSettingsCache.ts` already fixed the worst
 * of it — 77 call sites batched into one `.in("key", …)` query, 23 requests on
 * the production feed down to 1 — but that is still **one PostgREST round trip
 * per tab per ten minutes, multiplied by every member**, for roughly 35 rows
 * that are the same for everybody.
 *
 * The same shape, on a permanently-open realtime channel, is the
 * 580,000-requests-for-35-rows problem this codebase already has a name for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 *
 * One Pages Function, one upstream read, one response the CDN can hold:
 *
 *   GET /config/site-settings  ->  { version, settings: { key: value, … } }
 *
 * with a strong `ETag` and `Cache-Control: public, max-age=60,
 * stale-while-revalidate=600`. A member arriving at the site gets it from the
 * edge, usually without the origin being touched at all; a client that already
 * has it sends `If-None-Match` and gets a 304 with no body.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERSION IS CONTENT-ADDRESSED, AND THAT IS NOT A DETAIL
 *
 * PostgREST does not guarantee row order without an ORDER BY, so an ETag
 * computed over the raw response would change when nothing changed — every
 * client would re-download on a row-order shuffle, and `stale-while-revalidate`
 * would be doing work for nothing. The keys are therefore sorted and the body
 * re-serialised canonically BEFORE the digest, so the version is a function of
 * the configuration and of nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAILURE PATH, WHICH IS THE WHOLE RISK
 *
 * An empty `{}` here would not read as an error anywhere downstream — it would
 * read as "every setting is unset", and the client would quietly fall back to
 * built-in defaults. `siteSettingsCache.ts`'s own log line already says what
 * that costs: *"THIS CHANGES WHAT MEMBERS SEE with nothing on screen saying
 * so — a setting an admin turned off may be back on."*
 *
 * So an upstream failure returns **503 with `Cache-Control: no-store`**, never
 * a 200 with an empty object, and never a cached one. The client treats a
 * non-200 as "the edge has nothing for me" and uses its existing PostgREST
 * path. Degraded, not wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LANE
 *
 * `SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` are already declared in the
 * Pages environment for both lanes and are already used by
 * `functions/page/[slug].ts`, which reads `site_settings` the same way. **No new
 * environment variable is needed** — checked against the running code, not
 * assumed. `site_settings` is readable with the anon key today; this route adds
 * no privilege it did not already have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D2 / PERF 2026-10-28: THE EDGE CACHE THE HEADERS PROMISED BUT NEVER GOT
 *
 * Measured with curl -w from outside, both lanes: ttfb 1.3-1.5 s on EVERY call,
 * `cf-cache-status: DYNAMIC`. Cloudflare does not cache the output of a Pages
 * Function on its own, so `Cache-Control: public, max-age=60` only ever reached
 * the browser; the edge ran this function and did a Supabase read each time,
 * and web and app both wait on this response at start-up.
 *
 * Now the settings payload is held in the colo's Cache API (`caches.default`,
 * same pattern as functions/profile/[id].ts): fresh for MAX_AGE_S, then served
 * stale for SWR_S while ONE background refresh runs. Only the CORS-free JSON
 * is cached; withCors() wraps the result afterwards, so a cached response gets
 * exactly the same Access-Control-* / Vary: Origin as an uncached one.
 *
 * SAFETY: a request carrying Authorization or a session cookie never reads or
 * writes the cache (nothing here varies per user, but the rule is cheap and
 * keeps this route from ever becoming a leak if it later does). Only a good
 * 200 is stored; the 503 failure path stays `no-store` and is never cached.
 * The query string is dropped from the key so ?x=1 cannot be used to force
 * database reads. This route returns public site configuration only.
 *
 * It does NOT reuse `sbGet` from `_seo.ts`: that helper returns only the first
 * row of an array, which is right for the single-row lookups it was written for
 * and silently wrong here.
 */

import { withCors } from "../_cors";

interface Env {
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_ANON_KEY?: string;
  /** This lane's site origin, for the CORS allow-list (functions/_cors.ts). */
  SITE_ORIGIN?: string;
}

/** Long enough that the CDN absorbs the traffic; short enough that an admin
 *  edit is visible in about a minute without anyone pressing anything. */
const MAX_AGE_S = 60;
/** Ten minutes of serve-stale-while-refreshing: a cold origin never costs a
 *  member a blank configuration. */
const SWR_S = 600;

type Settings = Record<string, unknown>;

/** Sorted keys, re-serialised. The digest must depend on the configuration and
 *  not on the order PostgREST happened to return the rows in. */
function canonical(settings: Settings): string {
  const sorted: Settings = {};
  for (const k of Object.keys(settings).sort()) sorted[k] = settings[k];
  return JSON.stringify(sorted);
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fail(reason: string): Response {
  return new Response(JSON.stringify({ error: "site_settings unavailable", reason }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Never cache a failure: a cached 503 would outlive the outage.
      "cache-control": "no-store",
    },
  });
}

/**
 * The native app reads this too (src/lib/net/siteApi.ts asks the lane's site
 * origin from https://localhost), so GET and its OPTIONS preflight go through
 * the shared CORS helper. Public, anon-readable, GET-only data: opening it to
 * the app's origin gives that origin nothing a plain page load does not.
 */
export const onRequestGet = (context: Ctx) => withCors(context.request, context.env, () => siteSettings(context));
export const onRequestOptions = (context: Ctx) => withCors(context.request, context.env, () => siteSettings(context));

interface Ctx { request: Request; env: Env; waitUntil?: (p: Promise<unknown>) => void }

/** Cache API entry lives for fresh + stale; freshness is judged from CACHED_AT. */
const CACHED_AT = "x-cached-at";

/** A request that might carry a user identity must not touch the shared cache. */
function isIdentified(request: Request): boolean {
  if (request.headers.get("authorization")) return true;
  const cookie = request.headers.get("cookie") ?? "";
  return /(^|;\s*)([^=;]*(sb-|session|auth|token)[^=;]*)=/i.test(cookie);
}

/** Read the table once and build the payload. Returns a failure Response instead of throwing. */
async function loadPayload(env: Env): Promise<{ body: string; version: string } | Response> {
  const ref = env?.SUPABASE_PROJECT_REF;
  const anon = env?.SUPABASE_ANON_KEY;
  if (!ref || !anon) {
    // Pages Functions have no build step, so `context.env` is the only lane
    // signal there is. A missing variable is a deployment fault, not a reason
    // to invent a configuration.
    return fail("SUPABASE_PROJECT_REF or SUPABASE_ANON_KEY is not set for this lane");
  }

  let rows: { key?: unknown; value?: unknown }[];
  try {
    const r = await fetch(
      `https://${ref}.supabase.co/rest/v1/site_settings?select=key,value`,
      { headers: { apikey: anon, authorization: `Bearer ${anon}` } },
    );
    if (!r.ok) return fail(`upstream ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j)) return fail("upstream did not return an array");
    rows = j;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  // Zero rows is not a configuration. It is what a wrong key, a revoked grant
  // or an RLS change looks like, and serving it as 200 would reset every
  // setting to its built-in default with nothing on screen saying so.
  if (rows.length === 0) return fail("upstream returned zero rows");

  const settings: Settings = {};
  for (const row of rows) {
    if (typeof row?.key === "string") settings[row.key] = row.value ?? null;
  }
  if (Object.keys(settings).length === 0) return fail("no row carried a string key");

  const version = await sha256Hex(canonical(settings));
  return { version, body: JSON.stringify({ version, settings }) };
}

async function siteSettings(context: Ctx): Promise<Response> {
  const cache = typeof caches === "undefined" || isIdentified(context.request) ? undefined : caches.default;
  let key: Request | null = null;
  if (cache) {
    const k = new URL(context.request.url);
    k.search = "";
    key = new Request(k.toString(), { method: "GET" });
  }

  let payload: { body: string; version: string } | null = null;

  if (cache && key) {
    try {
      const stored = await cache.match(key);
      if (stored) {
        const body = await stored.text();
        const version = stored.headers.get("etag")?.replace(/"/g, "") ?? "";
        const age = (Date.now() - Number(stored.headers.get(CACHED_AT))) / 1000;
        if (version && body && age >= 0) {
          payload = { body, version };
          if (age > MAX_AGE_S && typeof context.waitUntil === "function") {
            // Stale: serve it now, refresh once in the background.
            context.waitUntil(refresh(cache, key, context.env));
          }
        }
      }
    } catch {
      // A cache that cannot be read is not a reason to fail the route.
    }
  }

  if (!payload) {
    const loaded = await loadPayload(context.env);
    if (loaded instanceof Response) return loaded;
    payload = loaded;
    if (cache && key) {
      const stored = store(cache, key, payload);
      if (typeof context.waitUntil === "function") context.waitUntil(stored);
    }
  }

  const etag = `"${payload.version}"`;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${MAX_AGE_S}, stale-while-revalidate=${SWR_S}`,
    etag,
    // The body varies with nothing: it is the same for every member, signed in
    // or not. Said explicitly so no proxy invents a Vary of its own. (The CORS
    // helper adds Origin, because Access-Control-Allow-Origin does vary.)
    vary: "Accept-Encoding",
  };

  // A client that already has this exact configuration gets no body at all.
  const inm = context.request.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(payload.body, { status: 200, headers });
}

async function store(cache: Cache, key: Request, p: { body: string; version: string }): Promise<void> {
  try {
    await cache.put(key, new Response(p.body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `max-age=${MAX_AGE_S + SWR_S}`,
        etag: `"${p.version}"`,
        [CACHED_AT]: String(Date.now()),
      },
    }));
  } catch {
    // Failing to store only costs the next request a database read.
  }
}

async function refresh(cache: Cache, key: Request, env: Env): Promise<void> {
  const loaded = await loadPayload(env);
  // A failed refresh keeps serving the stale copy; never overwrite with an error.
  if (!(loaded instanceof Response)) await store(cache, key, loaded);
}
