/// <reference path="./pages-runtime.d.ts" />
/**
 * ONE SEO RENDERER, INSIDE PAGES. F-D3-1 / F-D3-2 (S8).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG (measured 2026-10-28 from India)
 *
 * The production site is fronted by the hand-deployed Worker `seo-edge-injector`
 * (cloudflare/seo-edge-injector/worker.js). On EVERY visit it fetches the page
 * from ORIGIN_HOST and then asks Supabase `seo-route-metadata` for the route's
 * tags before it answers: live home server time 0.55–0.83 s, the same Pages
 * build reached directly 0.07–0.45 s. And there were two renderers (that
 * Worker, and functions/_seo.ts on the content routes), so when the Worker's
 * 1.5 s metadata budget ran out the page fell back to the other renderer's
 * tags and the canonical host flipped between requests (F-D3-1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 *
 * The Worker's job, done here, once: for an HTML GET it takes whatever Pages
 * produced (static shell or a content-route function), strips the same tags
 * the Worker strips and appends the same block the Worker appends, from the
 * same `seo-route-metadata` answer. The tags are therefore identical to what
 * the Worker injects today, byte for byte (src/__tests__/seoMiddlewareParity.test.ts
 * runs both on the same input and compares).
 *
 * The difference is where the metadata comes from on the hot path: the colo's
 * Cache API (`caches.default`, the pattern in functions/config/site-settings.ts),
 * fresh for FRESH_S and then served stale for STALE_S while ONE background
 * refresh runs. A visitor waits on Supabase only on a cold colo.
 *
 * WITH OR WITHOUT THE WORKER IN FRONT. The Worker strips `head > title`,
 * `meta[name=description|robots]`, `link[rel=canonical]`, `og:*`, `twitter:*`
 * and appends its own block, so running it over this output yields the same
 * tags again. When the Owner unroutes it, nothing changes for crawlers.
 * The apex → www 301 the Worker does is repeated here for the case the apex
 * reaches Pages directly.
 *
 * FAIL OPEN, like the Worker: no metadata, a timeout, a non-HTML response, an
 * error status, a non-GET → the Pages response goes out untouched.
 * Kill switch: SEO_INJECT=off in the Pages environment.
 */

interface Env {
  SUPABASE_PROJECT_REF?: string;
  /** Optional override, same meaning as the Worker's METADATA_FUNCTION_URL. */
  SEO_METADATA_URL?: string;
  /** "off" disables injection (passthrough). Anything else, or unset: on. */
  SEO_INJECT?: string;
}

interface Ctx {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface RouteMeta {
  title?: string;
  description?: string;
  ogImage?: string;
  ogType?: string;
  canonical?: string;
  noindex?: boolean;
  jsonLd?: unknown[];
  source?: string;
}

/** The Worker's own budget for the metadata call. */
const META_TIMEOUT_MS = 1500;
/** The Worker asked Cloudflare to hold the metadata 300 s (cf.cacheTtl). */
export const FRESH_S = 300;
/** Serve-stale window while one refresh runs; same as seo-route-metadata's own SWR. */
export const STALE_S = 86400;
const CACHED_AT = "x-cached-at";

// Copied from cloudflare/seo-edge-injector/worker.js — the same paths are never rewritten.
const SKIP_PREFIXES = [
  "/assets/", "/static/", "/_app/", "/favicon", "/robots.txt", "/sitemap",
  "/manifest", "/api/", "/functions/", "/auth/v1/", "/rest/v1/", "/storage/v1/",
];
const SKIP_EXTENSIONS = [
  ".js", ".css", ".map", ".json", ".xml", ".txt",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp4", ".webm", ".mp3", ".wav", ".pdf", ".zip",
];

export function shouldSkip(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (SKIP_PREFIXES.some((pre) => p.startsWith(pre))) return true;
  if (SKIP_EXTENSIONS.some((ext) => p.endsWith(ext))) return true;
  return false;
}

function escapeHtml(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The block the Worker appends to <head>, built exactly the way it builds it. */
export function headBlock(m: RouteMeta): string {
  const title = escapeHtml(m.title || "");
  const desc = escapeHtml(m.description || "");
  const ogImage = m.ogImage ? escapeHtml(m.ogImage) : "";
  const canonical = m.canonical ? escapeHtml(m.canonical) : "";
  const ogType = escapeHtml(m.ogType || "website");
  const robots = m.noindex ? "noindex, nofollow" : "index, follow";

  let html = "";
  html += `<title data-seo="edge">${title}</title>`;
  html += `<meta name="description" content="${desc}" data-seo="edge">`;
  html += `<meta name="robots" content="${robots}" data-seo="edge">`;
  if (canonical) {
    html += `<link rel="canonical" href="${canonical}" data-seo="edge">`;
    html += `<meta property="og:url" content="${canonical}" data-seo="edge">`;
  }
  html += `<meta property="og:title" content="${title}" data-seo="edge">`;
  html += `<meta property="og:description" content="${desc}" data-seo="edge">`;
  html += `<meta property="og:type" content="${ogType}" data-seo="edge">`;
  if (ogImage) {
    html += `<meta property="og:image" content="${ogImage}" data-seo="edge">`;
    html += `<meta name="twitter:image" content="${ogImage}" data-seo="edge">`;
  }
  html += `<meta name="twitter:card" content="summary_large_image" data-seo="edge">`;
  html += `<meta name="twitter:title" content="${title}" data-seo="edge">`;
  html += `<meta name="twitter:description" content="${desc}" data-seo="edge">`;

  if (Array.isArray(m.jsonLd)) {
    for (const obj of m.jsonLd) {
      try {
        // Inserted raw, so `<` must not survive: it could close the script element.
        const json = JSON.stringify(obj).replace(/</g, "\\u003c");
        html += `<script type="application/ld+json" data-seo="edge">${json}</script>`;
      } catch { /* skip */ }
    }
  }
  return html;
}

/** The tags the Worker removes before appending its block, in its order. */
export const STRIP_SELECTORS = [
  "head > title",
  'head > meta[name="description"]',
  'head > meta[name="robots"]',
  'head > link[rel="canonical"]',
  'head > meta[property^="og:"]',
  'head > meta[name^="twitter:"]',
];

function metadataUrl(env: Env, pathname: string): string | null {
  const base = env?.SEO_METADATA_URL?.trim() ||
    (env?.SUPABASE_PROJECT_REF?.trim()
      ? `https://${env.SUPABASE_PROJECT_REF.trim()}.functions.supabase.co/seo-route-metadata`
      : "");
  if (!base) return null; // a lane without its ref gets no tags, never another lane's
  return `${base}?path=${encodeURIComponent(pathname)}`;
}

/** A background fill may run past the visitor's budget, up to the edge function's own 5 s. */
const FILL_TIMEOUT_MS = 6000;

async function fetchMeta(url: string, timeoutMs: number): Promise<RouteMeta | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as RouteMeta;
    // The edge function answers 200 with source "fallback-error" when it timed
    // out inside; that one is served (the Worker serves it too) but not cached.
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function store(cache: Cache, key: Request, meta: RouteMeta): Promise<void> {
  try {
    await cache.put(key, new Response(JSON.stringify(meta), {
      headers: {
        "content-type": "application/json",
        "cache-control": `max-age=${FRESH_S + STALE_S}`,
        [CACHED_AT]: String(Date.now()),
      },
    }));
  } catch { /* the next visit pays one metadata call */ }
}

function cacheable(meta: RouteMeta | null): meta is RouteMeta {
  return !!meta && !!meta.title && meta.source !== "fallback-error";
}

/** Metadata for a path: colo cache first (stale-while-revalidate), Supabase on a miss. */
export async function routeMeta(env: Env, pathname: string, waitUntil?: (p: Promise<unknown>) => void): Promise<RouteMeta | null> {
  const url = metadataUrl(env, pathname);
  if (!url) return null;
  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const key = new Request(url, { method: "GET" });

  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const age = (Date.now() - Number(hit.headers.get(CACHED_AT))) / 1000;
        const meta = (await hit.json()) as RouteMeta;
        if (cacheable(meta) && age >= 0) {
          if (age > FRESH_S && typeof waitUntil === "function") {
            waitUntil(fetchMeta(url, FILL_TIMEOUT_MS).then((m) => (cacheable(m) ? store(cache, key, m) : undefined)));
          }
          return meta;
        }
      }
    } catch { /* an unreadable cache is a miss, not a failure */ }
  }

  // The visitor waits at most META_TIMEOUT_MS, as with the Worker. The fetch
  // itself is NOT aborted at that point: it finishes in the background and
  // fills the cache. Measured 2026-10-28: /post/:id takes ~1.7 s, so the
  // Worker's aborted fetch left every post page without its tags, every time.
  const pending = fetchMeta(url, FILL_TIMEOUT_MS);
  const fill = pending.then((m) => (cache && cacheable(m) ? store(cache, key, m) : undefined));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), META_TIMEOUT_MS); });
  const meta = await Promise.race([pending, late]);
  clearTimeout(timer);
  if (typeof waitUntil === "function") waitUntil(fill); else if (meta !== undefined) await fill;
  return meta ?? null;
}

function passthrough(res: Response, tag: string): Response {
  const out = new Response(res.body, res);
  out.headers.set("x-seo-render", `pages:${tag}`);
  return out;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);

  // One address: the bare domain forwards to www (the Worker's step 0).
  if (url.hostname === "50mmretina.com") { // isolation-allow: the production apex is matched in order to forward it; no other lane is ever named this
    url.hostname = "www.50mmretina.com"; // isolation-allow: the Worker's apex -> www 301, only reachable when the request IS for the production apex
    return Response.redirect(url.toString(), 301);
  }

  const res = await context.next();

  // The content-route functions fetch /index.html with x-seo-shell: 1; that
  // inner fetch is raw material, not a page, and must not cost a metadata call.
  if (request.headers.get("x-seo-shell") === "1") return res;

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (request.method !== "GET" || !ct.includes("text/html") || shouldSkip(url.pathname) || res.status >= 400) {
    return res;
  }
  if ((env?.SEO_INJECT || "").trim().toLowerCase() === "off") return passthrough(res, "off");

  const meta = await routeMeta(env, url.pathname, context.waitUntil?.bind(context));
  if (!meta || !meta.title) return passthrough(res, "fallback");

  try {
    let rw = new HTMLRewriter();
    const strip = { element(el: { remove(): void }) { el.remove(); } };
    for (const sel of STRIP_SELECTORS) rw = rw.on(sel, strip);
    const block = headBlock(meta);
    rw = rw.on("head", { element(el: { append(h: string, o: { html: boolean }): void }) { el.append(block, { html: true }); } });
    const out = new Response(rw.transform(res).body, res);
    out.headers.set("x-seo-edge", `injected:${meta.source || "ok"}`);
    out.headers.set("x-seo-render", "pages:injected");
    // Cache-Control is left as Pages set it (public/_headers: HTML is no-store,
    // so a shell never outlives the hashed assets it names). The Worker's
    // `s-maxage=60` is not copied: no Cloudflare cache holds this response.
    return out;
  } catch {
    return passthrough(res, "error");
  }
};
