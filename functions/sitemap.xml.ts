/**
 * /sitemap.xml — THE DYNAMIC SITEMAP, FINALLY WIRED. F-D3-3 (S8).
 *
 * Traced in docs/evidence/d2/phase5/F-D3-3/TRACE.md: crawlers got the static
 * 12-route template (public/sitemap.xml via scripts/generate-seo-assets.mjs),
 * while the Supabase `sitemap` function, which lists journal articles,
 * courses, featured artists, pages, public profiles and public posts (~730
 * URLs on production), was deployed but never routed: the `_redirects`
 * cross-origin 200-proxy meant for it was rejected by Cloudflare, and the
 * "Pages Function or Worker route" its replacement comment asks for was never
 * built. This is that function.
 *
 * LANE. The build already decides whether this lane is indexable: a
 * non-production lane gets an EMPTY static sitemap and `Disallow: /`. That
 * decision is honoured here by reading it from the static file itself — no
 * `<loc>` in it means "not for indexing", and the static file is served as is.
 * The upstream is this lane's own Supabase (`SUPABASE_PROJECT_REF`); a lane
 * without it serves the static file.
 *
 * NEVER WORSE THAN BEFORE. The static template is the fallback for every
 * failure: upstream down, slow (4 s), non-200, not a <urlset>, or listing
 * fewer URLs than the template. A crawler never gets an empty 200 or a 5xx
 * from this route.
 *
 * CACHE. The colo's Cache API holds the upstream XML: fresh 1 h (the
 * function's own max-age), then served stale up to a day while one
 * background refresh runs (pattern: functions/config/site-settings.ts).
 */

interface Env { SUPABASE_PROJECT_REF?: string }
interface Ctx { request: Request; env: Env; next: () => Promise<Response>; waitUntil?: (p: Promise<unknown>) => void }

export const FRESH_S = 3600;
export const STALE_S = 86400;
/** The most a visitor (or crawler) waits for the generator before getting the static file. */
export const VISITOR_BUDGET_MS = 4000;
/**
 * The most a BACKGROUND read may take. Production's generator answers in ~4.7 s
 * (measured 2026-10-29), longer than the visitor budget: with one 4 s limit for
 * everything the dynamic sitemap was never served and the cache never filled
 * (and a stale entry was never refreshed). Pages keeps waitUntil work alive
 * for 30 s after the response.
 */
export const BACKGROUND_TIMEOUT_MS = 25000;
const CACHED_AT = "x-cached-at";

export function locCount(xml: string): number {
  return (xml.match(/<loc>/g) || []).length;
}

/** Host of the first <loc>: the upstream must name the same site as this lane's build. */
export function firstLocHost(xml: string): string | null {
  const m = xml.match(/<loc>\s*https?:\/\/([^/<\s]+)/);
  return m ? m[1].toLowerCase() : null;
}

async function fetchUpstream(url: string, minLocs: number, host: string | null, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/xml" } });
    if (!r.ok) return null;
    const xml = await r.text();
    if (!xml.includes("<urlset") || locCount(xml) < minLocs) return null;
    // A Pages project pointed at the wrong lane's ref must not publish that lane's URLs.
    if (firstLocHost(xml) !== host) return null;
    return xml;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * One upstream read at a time per isolate, URL and limit: a burst of crawler
 * requests (cold cache, or a stale entry) shares one ~5 s generator read.
 * The request that STARTS the read hands it to its own waitUntil at once, so a
 * visitor who disconnects cannot strand it; the read stores into the cache
 * itself (once); an entry older than its limit is never reused.
 */
const inFlight = new Map<string, { p: Promise<string | null>; at: number }>();
function sharedRead(
  url: string, minLocs: number, host: string | null, timeoutMs: number,
  keep: ((p: Promise<unknown>) => void) | undefined, cache: Cache | undefined, key: Request,
): Promise<string | null> {
  const k = `${url}|${minLocs}|${host}|${timeoutMs}`;
  const cur = inFlight.get(k);
  if (cur && Date.now() - cur.at <= timeoutMs + 1000) return cur.p;
  const p: Promise<string | null> = fetchUpstream(url, minLocs, host, timeoutMs)
    .then(async (x) => {
      if (x && cache) await store(cache, key, x);
      return x;
    })
    .finally(() => {
      if (inFlight.get(k)?.p === p) inFlight.delete(k);
    });
  inFlight.set(k, { p, at: Date.now() });
  keep?.(p);
  return p;
}
/** Tests only. */
export function __resetSitemapInFlight(): void {
  inFlight.clear();
}

async function store(cache: Cache, key: Request, xml: string): Promise<void> {
  try {
    await cache.put(key, new Response(xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": `max-age=${FRESH_S + STALE_S}`,
        [CACHED_AT]: String(Date.now()),
      },
    }));
  } catch { /* the next request pays one upstream read */ }
}

function xmlResponse(xml: string, source: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": `public, max-age=${FRESH_S}`,
      "x-sitemap-source": source,
    },
  });
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const fallback = await context.next();
  if (context.request.method !== "GET" || !fallback.ok) return fallback;

  const staticXml = await fallback.clone().text();
  const minLocs = locCount(staticXml);
  const host = firstLocHost(staticXml);
  // The build wrote an empty sitemap on purpose: this lane is not for indexing.
  if (minLocs === 0) return fallback;

  const ref = context.env?.SUPABASE_PROJECT_REF?.trim();
  if (!ref) return fallback;
  const url = `https://${ref}.supabase.co/functions/v1/sitemap`;
  const key = new Request(url, { method: "GET" });
  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const waitUntil = context.waitUntil?.bind(context);

  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const at = Number(hit.headers.get(CACHED_AT));
        const age = (Date.now() - at) / 1000;
        const xml = await hit.text();
        if (at > 0 && age >= 0 && locCount(xml) >= minLocs && firstLocHost(xml) === host) {
          if (age > FRESH_S && waitUntil) {
            void sharedRead(url, minLocs, host, BACKGROUND_TIMEOUT_MS, waitUntil, cache, key);
          }
          return xmlResponse(xml, "dynamic-cached");
        }
      }
    } catch { /* an unreadable cache is a miss */ }
  }

  // ONE upstream read with the background limit; the visitor waits for it at most
  // VISITOR_BUDGET_MS. Slower than that: the visitor gets the static file now and
  // the same read, still running under waitUntil, fills the cache for the next one.
  // The long limit only when a late answer can still be kept (cache + waitUntil).
  const read = sharedRead(url, minLocs, host, cache && waitUntil ? BACKGROUND_TIMEOUT_MS : VISITOR_BUDGET_MS, waitUntil, cache, key);
  const SLOW = Symbol("slow");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    read,
    new Promise<typeof SLOW>((r) => { timer = setTimeout(() => r(SLOW), VISITOR_BUDGET_MS); }),
  ]);
  clearTimeout(timer);
  // SLOW: the read is already held by its starter's waitUntil and fills the cache.
  if (first === SLOW || !first) return xmlResponse(staticXml, "static-fallback");
  return xmlResponse(first, "dynamic");
};
