// Shared SEO edge-rendering helpers for Cloudflare Pages Functions.
// These run only for content routes (functions/journal, functions/competitions);
// all other paths stay pure static assets (free/unlimited). Humans still get the
// full SPA — we only inject correct per-page <head> meta into the shell so crawlers
// and social unfurlers (which don't run JS) see complete, unique HTML.
export const SUPABASE_URL = "https://jtdtehuqtinjxropkkcn.supabase.co";
// Publishable (anon) key — public, already shipped in the client bundle.
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0ZHRlaHVxdGluanhyb3Bra2NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NzI3MjEsImV4cCI6MjA5OTE0ODcyMX0.qY8BI5LXb6uLzTwbpf8AleZ6UZyfeaOA0q4_TC5CEpo";
export const SITE = "https://50mmretina.com";
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
export async function sbGet(path: string): Promise<any | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_ANON, authorization: `Bearer ${SUPABASE_ANON}` },
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
