// Shared SEO edge-rendering helpers for Cloudflare Pages Functions.
// These run only for content routes (functions/journal, functions/competitions);
// all other paths stay pure static assets (free/unlimited). Humans still get the
// full SPA — we only inject correct per-page <head> meta into the shell so crawlers
// and social unfurlers (which don't run JS) see complete, unique HTML.
//
// ⚠ LANE-DERIVED AT RUNTIME SINCE 2026-08-22, NOT BAKED IN.
//
// These three were literals pointing at production. A Pages Function deployed
// to any other lane would have read production's database and emitted
// production canonical URLs into that lane's crawlable HTML — the worst place
// for a wrong origin, because search engines keep it.
//
// Pages Functions have no build step: `context.env` is the only lane signal
// they get. The same defaulting rule as src/lib/env.ts applies — unset means
// production, set-but-empty is a configuration error and throws rather than
// producing `https:///rest/v1/...`.
export interface SeoEnv {
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_ANON_KEY?: string;
  SITE_ORIGIN?: string;
}

const PRODUCTION_PROJECT_REF = "jtdtehuqtinjxropkkcn";
// Publishable (anon) key — public, already shipped in the client bundle.
const PRODUCTION_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0ZHRlaHVxdGluanhyb3Bra2NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NzI3MjEsImV4cCI6MjA5OTE0ODcyMX0.qY8BI5LXb6uLzTwbpf8AleZ6UZyfeaOA0q4_TC5CEpo";
const PRODUCTION_SITE_ORIGIN = "https://www.50mmretina.com";

function laneValue(name: string, raw: unknown, productionDefault: string): string {
  if (raw === undefined || raw === null) return productionDefault;
  const value = String(raw).trim();
  if (value === "") {
    throw new Error(
      `${name} is set but empty. An empty string is a configuration error, not a default.`,
    );
  }
  return value;
}

/** This lane's Supabase REST base, from the Pages environment. */
export function supabaseUrl(env: SeoEnv | undefined): string {
  return `https://${laneValue("SUPABASE_PROJECT_REF", env?.SUPABASE_PROJECT_REF, PRODUCTION_PROJECT_REF)}.supabase.co`;
}

/** This lane's anon key, from the Pages environment. */
export function supabaseAnon(env: SeoEnv | undefined): string {
  return laneValue("SUPABASE_ANON_KEY", env?.SUPABASE_ANON_KEY, PRODUCTION_ANON_KEY);
}

/** This lane's public origin — what canonical URLs and JSON-LD must name. */
export function site(env: SeoEnv | undefined): string {
  return laneValue("SITE_ORIGIN", env?.SITE_ORIGIN, PRODUCTION_SITE_ORIGIN).replace(/\/+$/, "");
}
export const DEFAULT_OG =
  "https://pub-f3e7af944f2746b7bb4fb6e679dd78de.r2.dev/site-assets/seo/1775321074863-k3b5rusybos.jpg";

export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function stripHtml(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Fetch a single row from Supabase REST (public data via anon key).
export async function sbGet(path: string, env?: SeoEnv): Promise<any | null> {
  try {
    const anon = supabaseAnon(env);
    const r = await fetch(`${supabaseUrl(env)}/rest/v1/${path}`, {
      headers: { apikey: anon, authorization: `Bearer ${anon}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? (j[0] ?? null) : j;
  } catch {
    return null;
  }
}

// Fetch the built SPA shell (index.html) reliably, independent of SPA-fallback config.
export async function getShell(request: Request): Promise<Response> {
  const u = new URL(request.url);
  u.pathname = "/index.html";
  u.search = "";
  return fetch(u.toString(), { headers: { "x-seo-shell": "1" } });
}

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  type?: string;
  jsonLd?: Record<string, unknown>;
}

// Inject per-page SEO into the SPA shell's <head> via streaming HTMLRewriter.
export function renderSeo(response: Response, meta: SeoMeta): Response {
  const title = meta.title;
  const desc = (meta.description || "").slice(0, 300);
  const image = meta.image || DEFAULT_OG;
  const canonical = meta.canonical;
  const jsonLd = meta.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`
    : "";
  const inject =
    `<meta property="og:title" content="${esc(title)}">` +
    `<meta property="og:description" content="${esc(desc)}">` +
    `<meta property="og:image" content="${esc(image)}">` +
    `<meta property="og:url" content="${esc(canonical)}">` +
    `<meta property="og:type" content="${esc(meta.type || "article")}">` +
    `<meta name="twitter:card" content="summary_large_image">` +
    `<meta name="twitter:title" content="${esc(title)}">` +
    `<meta name="twitter:description" content="${esc(desc)}">` +
    `<meta name="twitter:image" content="${esc(image)}">` +
    `<link rel="canonical" href="${esc(canonical)}">` +
    jsonLd;

  const rw = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", desc); } })
    // strip the static homepage og:/twitter: tags so the fresh ones don't duplicate
    .on('meta[property^="og:"]', { element(el) { el.remove(); } })
    .on('meta[name^="twitter:"]', { element(el) { el.remove(); } })
    .on("head", { element(el) { el.append(inject, { html: true }); } })
    .transform(response);

  const out = new Response(rw.body, rw);
  out.headers.set("Content-Type", "text/html; charset=utf-8");
  // Edge-cache the rewritten HTML (Phase 2 adds purge-on-publish for instant freshness).
  out.headers.set("Cache-Control", "public, max-age=0, s-maxage=1800, stale-while-revalidate=86400");
  return out;
}
