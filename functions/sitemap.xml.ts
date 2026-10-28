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
const UPSTREAM_TIMEOUT_MS = 4000;
const CACHED_AT = "x-cached-at";

export function locCount(xml: string): number {
  return (xml.match(/<loc>/g) || []).length;
}

/** Host of the first <loc>: the upstream must name the same site as this lane's build. */
export function firstLocHost(xml: string): string | null {
  const m = xml.match(/<loc>\s*https?:\/\/([^/<\s]+)/);
  return m ? m[1].toLowerCase() : null;
}

async function fetchUpstream(url: string, minLocs: number, host: string | null): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
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
            waitUntil(fetchUpstream(url, minLocs, host).then((x) => (x ? store(cache, key, x) : undefined)));
          }
          return xmlResponse(xml, "dynamic-cached");
        }
      }
    } catch { /* an unreadable cache is a miss */ }
  }

  const xml = await fetchUpstream(url, minLocs, host);
  if (!xml) return xmlResponse(staticXml, "static-fallback");
  if (cache) {
    const p = store(cache, key, xml);
    if (waitUntil) waitUntil(p); else await p;
  }
  return xmlResponse(xml, "dynamic");
};
